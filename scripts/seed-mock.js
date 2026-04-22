// Seed mock orders so the dashboard is visually testable before real API key arrives.
require('dotenv').config();
const db = require('../lib/db');
const { insertOrder } = require('../lib/ingest');

const STORES = [
  'HandmadeIstanbul',
  'BosphorusCrafts',
  'AnatolianThreads',
  'IstanbulCeramics',
  'TurkishTextiles',
  'GoldenHornDesigns',
  'OttomanCreations',
  'CappadociaHome',
];

const FIRST_NAMES = ['Emily', 'Sarah', 'Michael', 'Jessica', 'David', 'Ashley', 'James', 'Amanda', 'Olivia', 'Ryan'];
const LAST_NAMES = ['Johnson', 'Smith', 'Williams', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson'];
const CITIES = ['Brooklyn, NY', 'Los Angeles, CA', 'Austin, TX', 'Seattle, WA', 'Portland, OR', 'Chicago, IL', 'Miami, FL', 'Denver, CO'];
const PRODUCTS = [
  { title: 'Handwoven Ceramic Bowl', price: 34.5 },
  { title: 'Turkish Cotton Bath Towel Set', price: 58.0 },
  { title: 'Anatolian Evil Eye Necklace', price: 22.0 },
  { title: 'Kilim Pattern Throw Pillow', price: 41.5 },
  { title: 'Hand-stamped Copper Coffee Set', price: 89.0 },
  { title: 'Iznik Tile Coaster (Set of 4)', price: 28.0 },
  { title: 'Silk Scarf — Ottoman Motif', price: 46.5 },
  { title: 'Hammered Brass Tea Tray', price: 67.0 },
];
const STATUSES = ['new', 'new', 'new', 'in_production', 'in_production', 'shipped', 'shipped', 'completed'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pad(n, w = 4) { return String(n).padStart(w, '0'); }

function generate() {
  console.log('Clearing existing data...');
  db.exec('DELETE FROM order_items; DELETE FROM orders; DELETE FROM stores;');

  let orderSeq = 1000;
  const now = Date.now();

  STORES.forEach((storeName, storeIdx) => {
    const orderCount = 5 + Math.floor(Math.random() * 8); // 5-12 orders per store
    for (let i = 0; i < orderCount; i++) {
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const city = pick(CITIES);
      const [cityName, state] = city.split(', ');
      const product = pick(PRODUCTS);
      const qty = 1 + Math.floor(Math.random() * 3);
      const status = pick(STATUSES);
      const daysAgo = Math.floor(Math.random() * 30);
      const received = new Date(now - daysAgo * 24 * 3600 * 1000 - Math.random() * 12 * 3600 * 1000);

      const orderId = orderSeq++;
      const order = {
        source: 'mock',
        external_order_id: `ET${pad(orderId, 6)}`,
        store_external_id: `etsy:${storeName}`,
        store_name: storeName,
        buyer_name: `${first} ${last}`,
        buyer_email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
        ship_address: {
          name: `${first} ${last}`,
          address1: `${100 + Math.floor(Math.random() * 900)} ${pick(['Main', 'Oak', 'Maple', 'Elm'])} St`,
          address2: null,
          city: cityName,
          state,
          postal: String(10000 + Math.floor(Math.random() * 89999)),
          country: 'US',
        },
        total_amount: +(product.price * qty).toFixed(2),
        currency: 'USD',
        items: [{ sku: `SKU-${100 + Math.floor(Math.random() * 900)}`, title: product.title, quantity: qty, price: product.price }],
        received_at: received.toISOString(),
      };

      const { id, inserted } = insertOrder(order);
      if (inserted && status !== 'new') {
        const tracking = status === 'shipped' || status === 'completed'
          ? '77' + Math.floor(100000000 + Math.random() * 899999999)
          : null;
        db.prepare(
          `UPDATE orders SET status = ?, tracking_carrier = ?, tracking_number = ?,
           shipped_at = CASE WHEN ? IN ('shipped','completed') THEN datetime(?) ELSE NULL END WHERE id = ?`,
        ).run(status, tracking ? 'FedEx' : null, tracking, status, received.toISOString(), id);
      }
    }
  });

  const total = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  console.log(`Seeded ${STORES.length} stores with ${total} mock orders.`);
}

generate();
