// Seed initial admin + a test store_owner (with one store) + a test supplier.
// Safe to re-run: uses INSERT OR IGNORE on email and skips duplicate links.
require('dotenv').config();
const db = require('../lib/db');
const { hashPassword } = require('../lib/auth');

const USERS = [
  { email: 'admin@hub.local',    password: 'admin123',    role: 'admin',       name: 'Admin' },
  { email: 'owner@hub.local',    password: 'owner123',    role: 'store_owner', name: 'Test Store Owner' },
  { email: 'supplier@hub.local', password: 'supplier123', role: 'supplier',    name: 'Test Supplier' },
];

async function run() {
  const insertUser = db.prepare(
    'INSERT OR IGNORE INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)',
  );
  const getUser = db.prepare('SELECT id, email, role FROM users WHERE email = ?');

  const created = [];
  for (const u of USERS) {
    const existing = getUser.get(u.email);
    if (existing) {
      created.push({ ...existing, created: false });
      continue;
    }
    const hash = await hashPassword(u.password);
    insertUser.run(u.email, hash, u.role, u.name);
    const row = getUser.get(u.email);
    created.push({ ...row, created: true });
  }

  const owner = created.find((u) => u.role === 'store_owner');
  const supplier = created.find((u) => u.role === 'supplier');

  // Attach the owner to existing stores that have no owner, or create a demo store.
  const unownedStores = db.prepare('SELECT id, name FROM stores WHERE owner_user_id IS NULL').all();
  if (unownedStores.length) {
    const link = db.prepare('UPDATE stores SET owner_user_id = ? WHERE id = ?');
    for (const s of unownedStores) link.run(owner.id, s.id);
    console.log(`Linked ${unownedStores.length} unowned store(s) to ${owner.email}`);
  } else {
    const anyStore = db.prepare('SELECT id FROM stores LIMIT 1').get();
    if (!anyStore) {
      db.prepare(
        "INSERT INTO stores (name, platform, external_id, owner_user_id) VALUES (?, 'etsy', ?, ?)",
      ).run('Demo Store', 'demo:1', owner.id);
      console.log(`Created demo store owned by ${owner.email}`);
    }
  }

  // Link supplier to every store owned by our test owner (so it sees incoming orders).
  const ownerStores = db.prepare('SELECT id FROM stores WHERE owner_user_id = ?').all(owner.id);
  const linkSupplier = db.prepare(
    'INSERT OR IGNORE INTO store_suppliers (store_id, supplier_user_id) VALUES (?, ?)',
  );
  for (const s of ownerStores) linkSupplier.run(s.id, supplier.id);

  console.log('\nUsers:');
  for (const u of created) {
    const seed = USERS.find((x) => x.email === u.email);
    console.log(`  [${u.created ? 'new' : 'exists'}] ${u.role.padEnd(12)} ${u.email}  pw=${seed.password}`);
  }
  console.log(`\nStores owned by ${owner.email}: ${ownerStores.length}`);
  console.log(`Supplier ${supplier.email} linked to all of them.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
