// Seed product categories and a starter catalog (~20 printable items)
// assigned to the default supplier. Safe to re-run.
require('dotenv').config();
const db = require('../lib/db');

const CATEGORIES = [
  { slug: 'drinkware',   name: 'Drinkware' },
  { slug: 'mens',        name: "Men's Clothing" },
  { slug: 'womens',      name: "Women's Clothing" },
  { slug: 'kids',        name: "Kid's-Youth Clothing" },
  { slug: 'home-living', name: 'Home & Living' },
  { slug: 'yard-signs',  name: 'Yard Signs' },
  { slug: 'wood-signs',  name: 'Wood Signs' },
  { slug: 'ornament',    name: 'Ornament' },
  { slug: 'dtf',         name: 'DTF-Gangsheet' },
];

// Image URLs point to public placeholders so there's something to show.
const PRODUCTS = [
  { cat: 'drinkware',   sku: 'WG-248-LAS',   title: '10 Oz Straight Whiskey Glass',    price: 6.50,  top: 1, img: 'https://images.unsplash.com/photo-1527169402691-feff5539e52c?w=400&h=400&fit=crop' },
  { cat: 'drinkware',   sku: 'MUG-11OZ',     title: '11 Oz Ceramic Mug',                price: 4.25,  top: 0, img: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=400&h=400&fit=crop' },
  { cat: 'drinkware',   sku: 'TMB-20OZ',     title: '20 Oz Stainless Tumbler',          price: 12.00, top: 0, img: 'https://images.unsplash.com/photo-1610632380989-680fe40816c6?w=400&h=400&fit=crop' },
  { cat: 'mens',        sku: 'BC-3001',      title: 'Bella Canvas 3001 Unisex Shirt',   price: 7.80,  top: 1, img: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=400&fit=crop' },
  { cat: 'mens',        sku: 'GILDAN-18500', title: 'Gildan 18500 Adult Unisex Hoodie', price: 19.50, top: 1, img: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=400&fit=crop' },
  { cat: 'mens',        sku: 'GILDAN-18000', title: 'Gildan 18000 Crewneck Sweatshirt', price: 16.20, top: 0, img: 'https://images.unsplash.com/photo-1556821833-c86a900d9d20?w=400&h=400&fit=crop' },
  { cat: 'womens',      sku: 'BC-6004',      title: "Bella Canvas 6004 Women's Tee",    price: 8.20,  top: 0, img: 'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=400&h=400&fit=crop' },
  { cat: 'womens',      sku: 'LAT-2616',     title: "LAT 2616 V-Neck",                  price: 9.00,  top: 0, img: 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400&h=400&fit=crop' },
  { cat: 'kids',        sku: 'RABBIT-3301T', title: 'Rabbit Skins 3301T Toddler Tee',   price: 5.80,  top: 0, img: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?w=400&h=400&fit=crop' },
  { cat: 'kids',        sku: 'GILDAN-Y',     title: 'Gildan Youth Softstyle Tee',       price: 6.40,  top: 0, img: 'https://images.unsplash.com/photo-1503944583220-79d8926ad5e2?w=400&h=400&fit=crop' },
  { cat: 'home-living', sku: 'PILLOW-18',    title: '18"×18" Throw Pillow Cover',        price: 11.00, top: 0, img: 'https://images.unsplash.com/photo-1540932239986-30128078f3c5?w=400&h=400&fit=crop' },
  { cat: 'home-living', sku: 'BLANKET-50',   title: '50"×60" Sherpa Blanket',            price: 28.00, top: 0, img: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&h=400&fit=crop' },
  { cat: 'home-living', sku: 'TOTE-15',      title: '15" Canvas Tote Bag',              price: 6.90,  top: 0, img: 'https://images.unsplash.com/photo-1591561954557-26941169b49e?w=400&h=400&fit=crop' },
  { cat: 'yard-signs',  sku: 'YS-18X24',     title: '18×24 Corrugated Yard Sign',       price: 9.50,  top: 0, img: 'https://images.unsplash.com/photo-1605117013793-0c50c4fb2e5a?w=400&h=400&fit=crop' },
  { cat: 'yard-signs',  sku: 'YS-24X36',     title: '24×36 Corrugated Yard Sign',       price: 14.75, top: 0, img: 'https://images.unsplash.com/photo-1561447084-5b3b1c0e5d89?w=400&h=400&fit=crop' },
  { cat: 'wood-signs',  sku: 'WS-12RND',     title: '12" Round Wood Sign',              price: 13.50, top: 0, img: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=400&h=400&fit=crop' },
  { cat: 'wood-signs',  sku: 'WS-16RECT',    title: '16×20 Rectangular Wood Sign',      price: 17.20, top: 0, img: 'https://images.unsplash.com/photo-1532012197267-da84d127e765?w=400&h=400&fit=crop' },
  { cat: 'ornament',    sku: 'ORN-3CERA',    title: '3" Ceramic Round Ornament',        price: 3.20,  top: 0, img: 'https://images.unsplash.com/photo-1482517967863-00e15c9b44be?w=400&h=400&fit=crop' },
  { cat: 'ornament',    sku: 'ORN-WOOD',     title: 'Wooden Slice Ornament',            price: 2.90,  top: 0, img: 'https://images.unsplash.com/photo-1512909006721-3d6018887383?w=400&h=400&fit=crop' },
  { cat: 'dtf',         sku: 'DTF-GANG-22',  title: 'DTF Gang Sheet 22×28"',            price: 16.00, top: 0, img: 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=400&h=400&fit=crop' },
];

const VARIANTS_BY_CAT = {
  mens:   ['S', 'M', 'L', 'XL', '2XL'],
  womens: ['XS', 'S', 'M', 'L', 'XL'],
  kids:   ['2T', '3T', '4T', '5T', 'Youth S', 'Youth M'],
};

function run() {
  // Pick the first supplier to own this catalog.
  const supplier = db.prepare("SELECT id FROM users WHERE role = 'supplier' ORDER BY id LIMIT 1").get();
  if (!supplier) {
    console.error('No supplier user found. Run seed-users.js first.');
    process.exit(1);
  }

  const insertCat = db.prepare('INSERT OR IGNORE INTO product_categories (slug, name, display_order) VALUES (?, ?, ?)');
  CATEGORIES.forEach((c, i) => insertCat.run(c.slug, c.name, (i + 1) * 10));

  const catBySlug = {};
  for (const c of db.prepare('SELECT id, slug FROM product_categories').all()) catBySlug[c.slug] = c.id;

  const insertProd = db.prepare(`
    INSERT OR IGNORE INTO products
      (supplier_user_id, category_id, sku, title, description, image_url, base_price, currency, is_active, is_top_pick)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', 1, ?)
  `);
  const insertVar = db.prepare(
    'INSERT OR IGNORE INTO product_variants (product_id, sku, name, price_delta) VALUES (?, ?, ?, ?)',
  );
  const getProd = db.prepare('SELECT id FROM products WHERE sku = ?');

  let added = 0;
  for (const p of PRODUCTS) {
    const catId = catBySlug[p.cat];
    if (!catId) continue;
    insertProd.run(
      supplier.id, catId, p.sku, p.title,
      `Premium ${p.title.toLowerCase()} — ready for custom print.`,
      p.img, p.price, p.top,
    );
    const prod = getProd.get(p.sku);
    if (!prod) continue;
    added++;
    const variants = VARIANTS_BY_CAT[p.cat];
    if (variants) {
      for (const v of variants) {
        insertVar.run(prod.id, `${p.sku}-${v}`, v, v === '2XL' ? 2 : 0);
      }
    }
  }

  const totalCats = db.prepare('SELECT COUNT(*) c FROM product_categories').get().c;
  const totalProds = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  const totalVars = db.prepare('SELECT COUNT(*) c FROM product_variants').get().c;
  console.log(`Categories: ${totalCats}, Products: ${totalProds} (+${added} touched), Variants: ${totalVars}`);
}

run();
