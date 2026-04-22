const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'hub.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','store_owner','supplier')),
    name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'etsy',
    external_id TEXT,
    owner_user_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS store_suppliers (
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    supplier_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (store_id, supplier_user_id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    source TEXT NOT NULL,
    external_order_id TEXT NOT NULL,
    buyer_name TEXT,
    buyer_email TEXT,
    ship_name TEXT,
    ship_address1 TEXT,
    ship_address2 TEXT,
    ship_city TEXT,
    ship_state TEXT,
    ship_postal TEXT,
    ship_country TEXT,
    total_amount REAL,
    currency TEXT DEFAULT 'USD',
    note TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    tracking_carrier TEXT,
    tracking_number TEXT,
    shipped_at TEXT,
    received_at TEXT NOT NULL,
    raw_json TEXT,
    provider_shipment_id TEXT,
    assigned_supplier_id INTEGER REFERENCES users(id),
    supplier_cost REAL,
    assigned_at TEXT,
    approved_at TEXT,
    paid_at TEXT,
    rejected_at TEXT,
    rejection_reason TEXT,
    UNIQUE(source, external_order_id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sku TEXT,
    title TEXT,
    quantity INTEGER DEFAULT 1,
    price REAL,
    image_url TEXT
  );

  CREATE TABLE IF NOT EXISTS product_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    display_order INTEGER DEFAULT 100,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_user_id INTEGER REFERENCES users(id),
    category_id INTEGER REFERENCES product_categories(id),
    sku TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    base_price REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER NOT NULL DEFAULT 1,
    is_top_pick INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku TEXT,
    name TEXT NOT NULL,
    price_delta REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN ('deposit','hold','release','payout','adjustment')),
    amount REAL NOT NULL,
    order_id INTEGER REFERENCES orders(id),
    note TEXT,
    created_by_user_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_received ON orders(received_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_supplier ON orders(assigned_supplier_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_order ON ledger_entries(order_id);
  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
  CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_user_id);
  CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
`);

// Lightweight migrations for existing DBs
const migrations = [
  'ALTER TABLE orders ADD COLUMN provider_shipment_id TEXT',
  'ALTER TABLE orders ADD COLUMN assigned_supplier_id INTEGER REFERENCES users(id)',
  'ALTER TABLE orders ADD COLUMN supplier_cost REAL',
  'ALTER TABLE orders ADD COLUMN assigned_at TEXT',
  'ALTER TABLE orders ADD COLUMN approved_at TEXT',
  'ALTER TABLE orders ADD COLUMN paid_at TEXT',
  'ALTER TABLE orders ADD COLUMN rejected_at TEXT',
  'ALTER TABLE orders ADD COLUMN rejection_reason TEXT',
  'ALTER TABLE stores ADD COLUMN owner_user_id INTEGER REFERENCES users(id)',
  'ALTER TABLE order_items ADD COLUMN product_id INTEGER REFERENCES products(id)',
  'ALTER TABLE order_items ADD COLUMN variant_id INTEGER REFERENCES product_variants(id)',
  'ALTER TABLE orders ADD COLUMN product_id INTEGER REFERENCES products(id)',
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

// Ledger uses signed amounts: +credit, -debit. Balance = SUM(amount).
// Conventions per type:
//   deposit    (store_owner): +amount  — supplier credits store_owner after receiving money
//   hold       (store_owner): -amount  — reserved when order assigned
//   release    (store_owner): +amount  — hold reversed on reject or on approve (paired with payout)
//   payout     (store_owner): -amount  — money spent on approved order
//   payout     (supplier):    +amount  — earnings from approved order
//   adjustment (any):         ±amount  — manual correction by admin
function balanceFor(userId) {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount),0) AS balance FROM ledger_entries WHERE user_id = ?')
    .get(userId);
  return row ? row.balance : 0;
}

module.exports = db;
module.exports.balanceFor = balanceFor;
