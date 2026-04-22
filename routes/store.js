const express = require('express');
const db = require('../lib/db');
const { requireAuth, requireRole } = require('../lib/auth');
const ledger = require('../lib/ledger');

const router = express.Router();
router.use(requireAuth, requireRole('store_owner'));

router.get('/balance', (req, res) => {
  res.json({ balance: db.balanceFor(req.user.id) });
});

router.get('/stores', (req, res) => {
  const rows = db
    .prepare(`
      SELECT s.*, (SELECT COUNT(*) FROM orders o WHERE o.store_id = s.id) AS order_count
      FROM stores s WHERE s.owner_user_id = ? ORDER BY s.name
    `)
    .all(req.user.id);
  res.json(rows);
});

router.get('/suppliers', (req, res) => {
  const rows = db
    .prepare(`
      SELECT DISTINCT u.id, u.email, u.name
      FROM store_suppliers ss
      JOIN users u ON u.id = ss.supplier_user_id
      JOIN stores s ON s.id = ss.store_id
      WHERE s.owner_user_id = ? AND u.is_active = 1
      ORDER BY u.name
    `)
    .all(req.user.id);
  res.json(rows);
});

router.get('/orders', (req, res) => {
  const { status, store_id, q } = req.query;
  const where = ['s.owner_user_id = ?'];
  const params = [req.user.id];
  if (status) { where.push('o.status = ?'); params.push(status); }
  if (store_id) { where.push('o.store_id = ?'); params.push(store_id); }
  if (q) {
    where.push('(o.buyer_name LIKE ? OR o.external_order_id LIKE ? OR o.ship_city LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const rows = db
    .prepare(`
      SELECT o.*, s.name AS store_name, su.email AS supplier_email
      FROM orders o
      JOIN stores s ON s.id = o.store_id
      LEFT JOIN users su ON su.id = o.assigned_supplier_id
      WHERE ${where.join(' AND ')}
      ORDER BY o.received_at DESC LIMIT 500
    `)
    .all(...params);
  res.json(rows);
});

router.get('/orders/:id', (req, res) => {
  const order = db
    .prepare(`
      SELECT o.*, s.name AS store_name, su.email AS supplier_email
      FROM orders o
      JOIN stores s ON s.id = o.store_id
      LEFT JOIN users su ON su.id = o.assigned_supplier_id
      WHERE o.id = ? AND s.owner_user_id = ?
    `)
    .get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'not found' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json({ ...order, items });
});

// Match an incoming order to a catalog product. Deducts base_price from balance,
// auto-assigns to the product's supplier, moves to in_production.
router.post('/orders/:id/match', (req, res) => {
  const { product_id } = req.body || {};
  if (!product_id) return res.status(400).json({ error: 'product_id required' });
  try {
    const result = ledger.matchOrderToProduct({
      orderId: Number(req.params.id),
      productId: Number(product_id),
      actor: req.user,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Cancel an order before it ships. Refunds the deducted cost.
router.post('/orders/:id/cancel', (req, res) => {
  const { reason } = req.body || {};
  try {
    const result = ledger.cancelOrder({
      orderId: Number(req.params.id),
      reason,
      actor: req.user,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Catalog browsing ----------------------------------------------------
router.get('/categories', (req, res) => {
  const rows = db
    .prepare(`
      SELECT c.id, c.slug, c.name,
        (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) AS product_count
      FROM product_categories c
      ORDER BY c.display_order, c.name
    `)
    .all();
  res.json(rows);
});

router.get('/products', (req, res) => {
  const { category_id, category_slug, q, top_pick, limit = 100 } = req.query;
  const where = ['p.is_active = 1'];
  const params = [];
  if (category_id) { where.push('p.category_id = ?'); params.push(category_id); }
  if (category_slug) { where.push('c.slug = ?'); params.push(category_slug); }
  if (top_pick === '1') where.push('p.is_top_pick = 1');
  if (q) {
    where.push('(p.title LIKE ? OR p.sku LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like);
  }
  const rows = db
    .prepare(`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN product_categories c ON c.id = p.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.is_top_pick DESC, p.title
      LIMIT ?
    `)
    .all(...params, Number(limit));
  res.json(rows);
});

router.get('/products/:id', (req, res) => {
  const p = db
    .prepare(`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug,
        u.email AS supplier_email, u.name AS supplier_name
      FROM products p
      LEFT JOIN product_categories c ON c.id = p.category_id
      LEFT JOIN users u ON u.id = p.supplier_user_id
      WHERE p.id = ? AND p.is_active = 1
    `)
    .get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY id').all(p.id);
  res.json({ ...p, variants });
});

// --- Dashboard -----------------------------------------------------------
router.get('/dashboard', (req, res) => {
  const stats = db
    .prepare(`
      SELECT
        SUM(CASE WHEN o.status = 'new' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN o.status IN ('assigned','in_production') THEN 1 ELSE 0 END) AS in_progress_count,
        SUM(CASE WHEN o.status = 'shipped' THEN 1 ELSE 0 END) AS shipped_count,
        SUM(CASE WHEN o.status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
        SUM(CASE WHEN o.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
      FROM orders o JOIN stores s ON s.id = o.store_id
      WHERE s.owner_user_id = ?
    `)
    .get(req.user.id);
  res.json(stats);
});

router.get('/ledger', (req, res) => {
  const rows = db
    .prepare(`
      SELECT le.*, o.external_order_id
      FROM ledger_entries le
      LEFT JOIN orders o ON o.id = le.order_id
      WHERE le.user_id = ?
      ORDER BY le.created_at DESC LIMIT 200
    `)
    .all(req.user.id);
  res.json(rows);
});

module.exports = router;
