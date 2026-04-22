const db = require('./db');

function upsertStoreByExternal(externalId, name) {
  const existing = db
    .prepare('SELECT id FROM stores WHERE external_id = ?')
    .get(externalId);
  if (existing) return existing.id;
  // Optional: auto-assign an owner to newly-discovered stores so they are
  // immediately visible to the store_owner panel. If unset, store stays
  // unowned and admin must assign it via /api/admin/stores.
  const defaultOwner = process.env.DEFAULT_STORE_OWNER_ID
    ? Number(process.env.DEFAULT_STORE_OWNER_ID)
    : null;
  const info = db
    .prepare('INSERT INTO stores (name, external_id, owner_user_id) VALUES (?, ?, ?)')
    .run(name || externalId, externalId, defaultOwner);
  return Number(info.lastInsertRowid);
}

function insertOrder(order) {
  const storeId = upsertStoreByExternal(order.store_external_id, order.store_name);

  const existing = db
    .prepare('SELECT id FROM orders WHERE source = ? AND external_order_id = ?')
    .get(order.source, order.external_order_id);
  if (existing) return { id: existing.id, inserted: false };

  const info = db
    .prepare(
      `INSERT INTO orders (
        store_id, source, external_order_id, buyer_name, buyer_email,
        ship_name, ship_address1, ship_address2, ship_city, ship_state,
        ship_postal, ship_country, total_amount, currency, note,
        received_at, raw_json, provider_shipment_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      storeId,
      order.source,
      order.external_order_id,
      order.buyer_name ?? null,
      order.buyer_email ?? null,
      order.ship_address?.name ?? null,
      order.ship_address?.address1 ?? null,
      order.ship_address?.address2 ?? null,
      order.ship_address?.city ?? null,
      order.ship_address?.state ?? null,
      order.ship_address?.postal ?? null,
      order.ship_address?.country ?? null,
      order.total_amount ?? null,
      order.currency ?? null,
      order.note ?? null,
      order.received_at,
      order.raw ? JSON.stringify(order.raw) : null,
      order.easyship_shipment_id ?? order.provider_shipment_id ?? null,
    );

  const orderId = Number(info.lastInsertRowid);
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, sku, title, quantity, price, image_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const item of order.items || []) {
    insertItem.run(
      orderId,
      item.sku ?? null,
      item.title ?? null,
      item.quantity || 1,
      item.price ?? null,
      item.image_url ?? null,
    );
  }

  return { id: orderId, inserted: true };
}

async function pollAndIngest(source) {
  const row = db
    .prepare("SELECT MAX(received_at) AS last FROM orders")
    .get();
  const since = row.last || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { orders } = await source.fetchNewOrders(since);
  let inserted = 0;
  for (const o of orders) {
    const res = insertOrder(o);
    if (res.inserted) inserted++;
  }
  return { fetched: orders.length, inserted };
}

module.exports = { insertOrder, pollAndIngest, upsertStoreByExternal };
