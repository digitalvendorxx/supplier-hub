const express = require('express');
const db = require('../lib/db');
const { requireAuth, requireRole } = require('../lib/auth');
const ledger = require('../lib/ledger');

// Optional Easyship tracking push. If the order originated from Easyship,
// updating tracking here also pushes back to Easyship so it syncs to Etsy.
const { createSource } = require('../lib/source-factory');
let sourceForPush = null;
function getSource() {
  if (!sourceForPush && process.env.DATA_SOURCE === 'easyship') {
    sourceForPush = createSource(process.env);
  }
  return sourceForPush;
}

const router = express.Router();
router.use(requireAuth, requireRole('supplier'));

router.get('/balance', (req, res) => {
  res.json({ balance: db.balanceFor(req.user.id) });
});

router.get('/stores', (req, res) => {
  const rows = db
    .prepare(`
      SELECT s.*, u.email AS owner_email, u.name AS owner_name
      FROM store_suppliers ss
      JOIN stores s ON s.id = ss.store_id
      JOIN users u ON u.id = s.owner_user_id
      WHERE ss.supplier_user_id = ?
      ORDER BY s.name
    `)
    .all(req.user.id);
  res.json(rows);
});

router.get('/owners', (req, res) => {
  // Store owners this supplier is connected to — for deposit dropdown.
  const rows = db
    .prepare(`
      SELECT DISTINCT u.id, u.email, u.name
      FROM store_suppliers ss
      JOIN stores s ON s.id = ss.store_id
      JOIN users u ON u.id = s.owner_user_id
      WHERE ss.supplier_user_id = ? AND u.is_active = 1
      ORDER BY u.name
    `)
    .all(req.user.id);
  for (const o of rows) o.balance = db.balanceFor(o.id);
  res.json(rows);
});

router.get('/orders', (req, res) => {
  const { status, q } = req.query;
  const where = ['o.assigned_supplier_id = ?'];
  const params = [req.user.id];
  if (status) { where.push('o.status = ?'); params.push(status); }
  if (q) {
    where.push('(o.buyer_name LIKE ? OR o.external_order_id LIKE ? OR o.ship_city LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const rows = db
    .prepare(`
      SELECT o.*, s.name AS store_name
      FROM orders o JOIN stores s ON s.id = o.store_id
      WHERE ${where.join(' AND ')}
      ORDER BY o.assigned_at DESC LIMIT 500
    `)
    .all(...params);
  res.json(rows);
});

router.get('/orders/:id', (req, res) => {
  const order = db
    .prepare(`
      SELECT o.*, s.name AS store_name
      FROM orders o JOIN stores s ON s.id = o.store_id
      WHERE o.id = ? AND o.assigned_supplier_id = ?
    `)
    .get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'not found' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json({ ...order, items });
});

// Supplier can move order to in_production / shipped and set tracking.
router.patch('/orders/:id', async (req, res) => {
  const order = db
    .prepare('SELECT * FROM orders WHERE id = ? AND assigned_supplier_id = ?')
    .get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'not found' });

  const { status, tracking_carrier, tracking_number, note } = req.body || {};
  const allowed = ['in_production', 'shipped'];
  const fields = [];
  const params = [];

  if (status !== undefined) {
    if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });
    if (!['assigned', 'in_production'].includes(order.status) && status === 'in_production') {
      return res.status(400).json({ error: `cannot move to in_production from ${order.status}` });
    }
    if (!['assigned', 'in_production'].includes(order.status) && status === 'shipped') {
      return res.status(400).json({ error: `cannot ship from ${order.status}` });
    }
    fields.push('status = ?'); params.push(status);
    if (status === 'shipped') fields.push("shipped_at = datetime('now')");
  }
  if (tracking_carrier !== undefined) { fields.push('tracking_carrier = ?'); params.push(tracking_carrier); }
  if (tracking_number !== undefined) { fields.push('tracking_number = ?'); params.push(tracking_number); }
  if (note !== undefined) { fields.push('note = ?'); params.push(note); }
  if (!fields.length) return res.status(400).json({ error: 'nothing to update' });

  params.push(order.id);
  db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`).run(...params);

  let pushResult = null;
  const shouldPush =
    status === 'shipped' && tracking_number &&
    order.provider_shipment_id && order.source === 'easyship';
  if (shouldPush) {
    const src = getSource();
    if (src) {
      try {
        pushResult = await src.pushTracking(
          order.provider_shipment_id,
          tracking_carrier || order.tracking_carrier || 'FedEx',
          tracking_number,
        );
      } catch (err) {
        console.error('[push tracking]', err.message);
        pushResult = { error: err.message };
      }
    }
  }

  res.json({ ok: true, tracking_push: pushResult });
});

// Apply a balance change (positive = deposit, negative = deduction) on an owner.
router.post('/balance-changes', (req, res) => {
  const { owner_id, amount, note } = req.body || {};
  if (!owner_id || !amount) return res.status(400).json({ error: 'owner_id and amount required' });
  try {
    const result = ledger.changeOwnerBalance({
      supplierId: req.user.id,
      ownerId: Number(owner_id),
      amount: Number(amount),
      note,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

// All balance changes this supplier has applied to owners (deposits + deductions).
router.get('/balance-changes', (req, res) => {
  const rows = db
    .prepare(`
      SELECT le.*, u.email AS owner_email, u.name AS owner_name
      FROM ledger_entries le
      JOIN users u ON u.id = le.user_id
      WHERE le.type IN ('deposit','adjustment') AND le.created_by_user_id = ?
      ORDER BY le.created_at DESC LIMIT 200
    `)
    .all(req.user.id);
  res.json(rows);
});

// --- Catalog management --------------------------------------------------
router.get('/categories', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM product_categories ORDER BY display_order, name')
    .all();
  res.json(rows);
});

router.get('/products', (req, res) => {
  const rows = db
    .prepare(`
      SELECT p.*, c.name AS category_name,
        (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) AS variant_count
      FROM products p
      LEFT JOIN product_categories c ON c.id = p.category_id
      WHERE p.supplier_user_id = ?
      ORDER BY p.created_at DESC
    `)
    .all(req.user.id);
  res.json(rows);
});

router.get('/products/:id', (req, res) => {
  const p = db
    .prepare(`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN product_categories c ON c.id = p.category_id
      WHERE p.id = ? AND p.supplier_user_id = ?
    `)
    .get(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY id').all(p.id);
  res.json({ ...p, variants });
});

router.post('/products', (req, res) => {
  const { category_id, sku, title, description, image_url, base_price, is_top_pick } = req.body || {};
  if (!sku || !title || base_price == null) return res.status(400).json({ error: 'sku, title, base_price required' });
  try {
    const info = db
      .prepare(`
        INSERT INTO products (supplier_user_id, category_id, sku, title, description, image_url, base_price, is_top_pick)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(req.user.id, category_id || null, sku, title, description || null, image_url || null, Number(base_price), is_top_pick ? 1 : 0);
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/products/:id', (req, res) => {
  const existing = db
    .prepare('SELECT id FROM products WHERE id = ? AND supplier_user_id = ?')
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const { category_id, title, description, image_url, base_price, is_active, is_top_pick } = req.body || {};
  const fields = [];
  const params = [];
  if (category_id !== undefined) { fields.push('category_id = ?'); params.push(category_id); }
  if (title !== undefined) { fields.push('title = ?'); params.push(title); }
  if (description !== undefined) { fields.push('description = ?'); params.push(description); }
  if (image_url !== undefined) { fields.push('image_url = ?'); params.push(image_url); }
  if (base_price !== undefined) { fields.push('base_price = ?'); params.push(Number(base_price)); }
  if (is_active !== undefined) { fields.push('is_active = ?'); params.push(is_active ? 1 : 0); }
  if (is_top_pick !== undefined) { fields.push('is_top_pick = ?'); params.push(is_top_pick ? 1 : 0); }
  if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
  params.push(req.params.id);
  db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

router.delete('/products/:id', (req, res) => {
  const existing = db
    .prepare('SELECT id FROM products WHERE id = ? AND supplier_user_id = ?')
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  // Soft-delete to preserve order_items.product_id references.
  db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/products/:id/variants', (req, res) => {
  const owns = db
    .prepare('SELECT id FROM products WHERE id = ? AND supplier_user_id = ?')
    .get(req.params.id, req.user.id);
  if (!owns) return res.status(404).json({ error: 'product not found' });
  const { sku, name, price_delta } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db
    .prepare('INSERT INTO product_variants (product_id, sku, name, price_delta) VALUES (?, ?, ?, ?)')
    .run(req.params.id, sku || null, name, Number(price_delta) || 0);
  res.json({ id: info.lastInsertRowid });
});

router.delete('/variants/:id', (req, res) => {
  const row = db
    .prepare(`
      SELECT v.id FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.id = ? AND p.supplier_user_id = ?
    `)
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM product_variants WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
