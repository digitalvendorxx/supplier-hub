const express = require('express');
const db = require('../lib/db');
const { hashPassword, requireAuth, requireRole } = require('../lib/auth');
const ledger = require('../lib/ledger');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/users', (req, res) => {
  const rows = db
    .prepare('SELECT id, email, role, name, is_active, created_at FROM users ORDER BY created_at DESC')
    .all();
  for (const u of rows) u.balance = db.balanceFor(u.id);
  res.json(rows);
});

router.post('/users', async (req, res) => {
  const { email, password, role, name } = req.body || {};
  if (!email || !password || !role) return res.status(400).json({ error: 'email, password, role required' });
  if (!['admin', 'store_owner', 'supplier'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  try {
    const hash = await hashPassword(password);
    const info = db
      .prepare('INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)')
      .run(String(email).toLowerCase().trim(), hash, role, name || null);
    res.json({ id: info.lastInsertRowid, email, role, name });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/users/:id', async (req, res) => {
  const { name, role, is_active, password } = req.body || {};
  const fields = [];
  const params = [];
  if (name !== undefined) { fields.push('name = ?'); params.push(name); }
  if (role !== undefined) {
    if (!['admin', 'store_owner', 'supplier'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    fields.push('role = ?'); params.push(role);
  }
  if (is_active !== undefined) { fields.push('is_active = ?'); params.push(is_active ? 1 : 0); }
  if (password) { fields.push('password_hash = ?'); params.push(await hashPassword(password)); }
  if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
  params.push(req.params.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

router.get('/stores', (req, res) => {
  const rows = db
    .prepare(`
      SELECT s.*, u.email AS owner_email,
        (SELECT COUNT(*) FROM orders o WHERE o.store_id = s.id) AS order_count
      FROM stores s LEFT JOIN users u ON u.id = s.owner_user_id
      ORDER BY s.name
    `)
    .all();
  res.json(rows);
});

router.post('/stores', (req, res) => {
  const { name, platform, external_id, owner_user_id } = req.body || {};
  if (!name || !owner_user_id) return res.status(400).json({ error: 'name and owner_user_id required' });
  const info = db
    .prepare('INSERT INTO stores (name, platform, external_id, owner_user_id) VALUES (?, ?, ?, ?)')
    .run(name, platform || 'etsy', external_id || null, owner_user_id);
  res.json({ id: info.lastInsertRowid });
});

router.patch('/stores/:id', (req, res) => {
  const { name, owner_user_id } = req.body || {};
  const fields = [];
  const params = [];
  if (name !== undefined) { fields.push('name = ?'); params.push(name); }
  if (owner_user_id !== undefined) { fields.push('owner_user_id = ?'); params.push(owner_user_id); }
  if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
  params.push(req.params.id);
  db.prepare(`UPDATE stores SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

router.post('/store-suppliers', (req, res) => {
  const { store_id, supplier_user_id } = req.body || {};
  if (!store_id || !supplier_user_id) return res.status(400).json({ error: 'store_id and supplier_user_id required' });
  const supplier = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'supplier'").get(supplier_user_id);
  if (!supplier) return res.status(400).json({ error: 'user is not a supplier' });
  try {
    db.prepare('INSERT INTO store_suppliers (store_id, supplier_user_id) VALUES (?, ?)').run(store_id, supplier_user_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/store-suppliers/:storeId/:supplierId', (req, res) => {
  db.prepare('DELETE FROM store_suppliers WHERE store_id = ? AND supplier_user_id = ?').run(
    req.params.storeId, req.params.supplierId,
  );
  res.json({ ok: true });
});

router.get('/ledger', (req, res) => {
  const { user_id, limit = 200 } = req.query;
  const where = user_id ? 'WHERE le.user_id = ?' : '';
  const params = user_id ? [user_id] : [];
  const rows = db
    .prepare(`
      SELECT le.*, u.email AS user_email, cu.email AS created_by_email
      FROM ledger_entries le
      JOIN users u ON u.id = le.user_id
      LEFT JOIN users cu ON cu.id = le.created_by_user_id
      ${where}
      ORDER BY le.created_at DESC LIMIT ?
    `)
    .all(...params, Number(limit));
  res.json(rows);
});

router.post('/adjustment', (req, res) => {
  const { user_id, amount, note } = req.body || {};
  try {
    const result = ledger.adjustment({ userId: user_id, amount: Number(amount), note, actor: req.user });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/stats', (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count,
      SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) AS assigned_count,
      SUM(CASE WHEN status = 'in_production' THEN 1 ELSE 0 END) AS production_count,
      SUM(CASE WHEN status = 'shipped' THEN 1 ELSE 0 END) AS shipped_count,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
    FROM orders
  `).get();
  res.json(stats);
});

module.exports = router;
