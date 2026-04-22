const db = require('./db');

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const insertEntry = db.prepare(
  'INSERT INTO ledger_entries (user_id, type, amount, order_id, note, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)',
);

function recordEntry({ userId, type, amount, orderId = null, note = null, createdBy }) {
  insertEntry.run(userId, type, amount, orderId, note, createdBy);
}

// Store_owner matches an order to a catalog product. Immediately deducts
// product.base_price from owner balance, auto-assigns to the product's supplier,
// moves order to 'in_production' so supplier can ship it. No separate approval step.
function matchOrderToProduct({ orderId, productId, actor }) {
  return transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new Error('order not found');
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(order.store_id);
    if (!store) throw new Error('store not found');
    if (actor.role === 'store_owner' && store.owner_user_id !== actor.id) {
      throw new Error('forbidden: not your store');
    }
    if (!['new', 'rejected'].includes(order.status)) {
      throw new Error(`cannot match from status "${order.status}"`);
    }
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(productId);
    if (!product) throw new Error('product not found or inactive');

    const ownerId = store.owner_user_id;
    const cost = Number(product.base_price);
    const balance = db
      .prepare('SELECT COALESCE(SUM(amount),0) AS b FROM ledger_entries WHERE user_id = ?')
      .get(ownerId).b;
    if (balance < cost) throw new Error(`insufficient balance (have ${balance}, need ${cost})`);

    recordEntry({
      userId: ownerId, type: 'payout', amount: -cost, orderId,
      note: `match: ${product.title}`, createdBy: actor.id,
    });

    db.prepare(
      `UPDATE orders SET product_id = ?, assigned_supplier_id = ?, supplier_cost = ?,
       status = 'in_production', assigned_at = datetime('now'),
       rejected_at = NULL, rejection_reason = NULL WHERE id = ?`,
    ).run(product.id, product.supplier_user_id, cost, orderId);

    return { ok: true, orderId, productId: product.id, cost };
  });
}

// Store_owner cancels an order that hasn't shipped yet. Refunds the payout.
function cancelOrder({ orderId, reason, actor }) {
  return transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new Error('order not found');
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(order.store_id);
    if (!store) throw new Error('store not found');
    if (actor.role === 'store_owner' && store.owner_user_id !== actor.id) {
      throw new Error('forbidden: not your store');
    }
    if (!['in_production'].includes(order.status)) {
      throw new Error(`cannot cancel from status "${order.status}"`);
    }
    if (!(order.supplier_cost > 0)) throw new Error('order has no deducted cost');

    recordEntry({
      userId: store.owner_user_id, type: 'adjustment',
      amount: +order.supplier_cost, orderId,
      note: `refund on cancel: ${reason || ''}`.trim(), createdBy: actor.id,
    });

    db.prepare(
      `UPDATE orders SET status = 'rejected', rejected_at = datetime('now'),
       rejection_reason = ? WHERE id = ?`,
    ).run(reason || null, orderId);

    return { ok: true, orderId };
  });
}

// --- legacy (no longer used by UI, kept for backward compat) ---
function assignOrder({ orderId, supplierId, cost, actor }) {
  if (!(cost > 0)) throw new Error('cost must be positive');
  return transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new Error('order not found');
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(order.store_id);
    if (!store) throw new Error('store not found');

    if (actor.role === 'store_owner' && store.owner_user_id !== actor.id) {
      throw new Error('forbidden: not your store');
    }
    if (!['new', 'rejected'].includes(order.status)) {
      throw new Error(`cannot assign from status "${order.status}"`);
    }

    const link = db
      .prepare('SELECT 1 FROM store_suppliers WHERE store_id = ? AND supplier_user_id = ?')
      .get(store.id, supplierId);
    if (!link) throw new Error('supplier not linked to this store');

    const ownerId = store.owner_user_id;
    const balance = db
      .prepare('SELECT COALESCE(SUM(amount),0) AS b FROM ledger_entries WHERE user_id = ?')
      .get(ownerId).b;
    if (balance < cost) throw new Error(`insufficient balance (have ${balance}, need ${cost})`);

    recordEntry({
      userId: ownerId,
      type: 'hold',
      amount: -cost,
      orderId,
      note: `hold for order #${orderId}`,
      createdBy: actor.id,
    });

    db.prepare(
      `UPDATE orders SET assigned_supplier_id = ?, supplier_cost = ?, status = 'assigned',
       assigned_at = datetime('now'), rejected_at = NULL, rejection_reason = NULL WHERE id = ?`,
    ).run(supplierId, cost, orderId);

    return { ok: true, orderId, supplierId, cost };
  });
}

// Store_owner approves a shipped order. Releases hold, debits owner payout, credits supplier.
function approveOrder({ orderId, actor }) {
  return transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new Error('order not found');
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(order.store_id);
    if (!store) throw new Error('store not found');

    if (actor.role === 'store_owner' && store.owner_user_id !== actor.id) {
      throw new Error('forbidden: not your store');
    }
    if (order.status !== 'shipped') {
      throw new Error(`can only approve shipped orders (current: ${order.status})`);
    }
    if (!order.assigned_supplier_id || !(order.supplier_cost > 0)) {
      throw new Error('order missing supplier assignment or cost');
    }

    const ownerId = store.owner_user_id;
    const cost = order.supplier_cost;

    // Release the hold (+cost) and debit payout (-cost) on owner.
    // Supplier side is NOT tracked — money is already physically with supplier
    // (collected via offline deposits that credit the owner's balance).
    recordEntry({ userId: ownerId, type: 'release', amount: +cost, orderId, note: 'release hold on approve', createdBy: actor.id });
    recordEntry({ userId: ownerId, type: 'payout', amount: -cost, orderId, note: 'payout to supplier', createdBy: actor.id });

    db.prepare(
      `UPDATE orders SET status = 'approved', approved_at = datetime('now'),
       paid_at = datetime('now') WHERE id = ?`,
    ).run(orderId);

    return { ok: true, orderId, paid: cost };
  });
}

// Store_owner rejects (before or after shipping). Releases hold; order returns to 'rejected' state.
function rejectOrder({ orderId, reason, actor }) {
  return transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new Error('order not found');
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(order.store_id);
    if (!store) throw new Error('store not found');

    if (actor.role === 'store_owner' && store.owner_user_id !== actor.id) {
      throw new Error('forbidden: not your store');
    }
    if (!['assigned', 'in_production', 'shipped'].includes(order.status)) {
      throw new Error(`cannot reject from status "${order.status}"`);
    }
    if (!(order.supplier_cost > 0)) throw new Error('order has no held cost');

    recordEntry({
      userId: store.owner_user_id,
      type: 'release',
      amount: +order.supplier_cost,
      orderId,
      note: `release hold on reject: ${reason || ''}`.trim(),
      createdBy: actor.id,
    });

    db.prepare(
      `UPDATE orders SET status = 'rejected', rejected_at = datetime('now'),
       rejection_reason = ? WHERE id = ?`,
    ).run(reason || null, orderId);

    return { ok: true, orderId };
  });
}

// Supplier changes a store_owner's balance offline-reconciled money flow.
// Positive amount = deposit (adds credit), negative = deduction (subtracts).
// Validates: the supplier is linked to at least one store owned by that owner.
function changeOwnerBalance({ supplierId, ownerId, amount, note }) {
  if (!amount) throw new Error('amount required');
  return transaction(() => {
    const owner = db.prepare("SELECT id, role FROM users WHERE id = ? AND role = 'store_owner'").get(ownerId);
    if (!owner) throw new Error('recipient is not a store_owner');
    const link = db
      .prepare(`
        SELECT 1 FROM store_suppliers ss
        JOIN stores s ON s.id = ss.store_id
        WHERE ss.supplier_user_id = ? AND s.owner_user_id = ?
        LIMIT 1
      `)
      .get(supplierId, ownerId);
    if (!link) throw new Error('no store relationship between supplier and owner');

    // For deductions, make sure owner has enough available balance.
    if (amount < 0) {
      const current = db
        .prepare('SELECT COALESCE(SUM(amount),0) AS b FROM ledger_entries WHERE user_id = ?')
        .get(ownerId).b;
      if (current + amount < 0) throw new Error(`insufficient balance (have ${current}, deducting ${-amount})`);
    }

    recordEntry({
      userId: ownerId,
      type: amount > 0 ? 'deposit' : 'adjustment',
      amount,
      orderId: null,
      note: note || null,
      createdBy: supplierId,
    });
    return { ok: true, ownerId, amount };
  });
}

// Admin-only balance tweak.
function adjustment({ userId, amount, note, actor }) {
  if (!amount) throw new Error('amount required');
  return transaction(() => {
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('user not found');
    recordEntry({ userId, type: 'adjustment', amount, note: note || null, createdBy: actor.id });
    return { ok: true };
  });
}

module.exports = {
  transaction,
  recordEntry,
  matchOrderToProduct,
  cancelOrder,
  assignOrder,      // legacy
  approveOrder,     // legacy
  rejectOrder,      // legacy
  changeOwnerBalance,
  adjustment,
};
