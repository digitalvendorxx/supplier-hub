// ==========================================================================
// API helpers
// ==========================================================================
const api = {
  async get(url) {
    const r = await fetch(url);
    if (r.status === 401) { location.href = '/login.html'; throw new Error('unauthorized'); }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  },
  async post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  },
  async patch(url, body) {
    const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  },
  async del(url) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(r.statusText);
    return r.json().catch(() => ({}));
  },
};

const STATUS_TR = {
  new: 'Bekliyor', assigned: 'Atandı', in_production: 'Üretimde',
  shipped: 'Kargoda', approved: 'Onaylandı', rejected: 'İptal',
};
const ROLE_TR = { admin: 'Admin', store_owner: 'Mağaza Sahibi', supplier: 'Tedarikçi' };

function fmtMoney(n, cur = 'USD') {
  if (n == null) return '—';
  return Number(n).toFixed(2) + ' ' + cur;
}
function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function initials(name, email) {
  const src = name || email || '?';
  const parts = src.split(/\s+|@|\./).filter(Boolean);
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}
function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
function closeDrawer() { document.getElementById('drawerHost').innerHTML = ''; }
function openDrawer(html) {
  document.getElementById('drawerHost').innerHTML = `
    <div class="drawer-backdrop" onclick="closeDrawer()"></div>
    <div class="drawer">
      <button class="close" onclick="closeDrawer()">×</button>
      ${html}
    </div>
  `;
}

// ==========================================================================
// State + routing
// ==========================================================================
let ME = null;
let NAV = [];
let CURRENT_ROUTE = null;

async function boot() {
  try { ME = await api.get('/api/auth/me'); }
  catch { location.href = '/login.html'; return; }

  // Header
  document.getElementById('userName').textContent = ME.name || ME.email;
  document.getElementById('userRole').textContent = ROLE_TR[ME.role] || ME.role;
  document.getElementById('userAvatar').textContent = initials(ME.name, ME.email);
  document.getElementById('brandSub').textContent = ROLE_TR[ME.role];
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api.post('/api/auth/logout');
    location.href = '/login.html';
  });

  // Wallet (store_owner only — supplier holds money offline, no wallet shown)
  if (ME.role === 'store_owner') {
    document.getElementById('walletChip').hidden = false;
    refreshWallet();
  }

  // Sidebar & default view
  NAV = NAV_BY_ROLE[ME.role] || [];
  renderSidebar();
  navigate(NAV.find((n) => !n.label)?.route || NAV[0]?.items?.[0]?.route || NAV[0]?.route);
}

async function refreshWallet() {
  if (ME.role !== 'store_owner') return;
  try {
    const { balance } = await api.get('/api/store/balance');
    document.getElementById('walletNum').textContent = fmtMoney(balance);
  } catch {}
}

function renderSidebar() {
  const nav = document.getElementById('sidebarNav');
  nav.innerHTML = NAV.map((group) => {
    if (group.route) {
      // Standalone item (no group)
      return `<button class="nav-item" data-route="${group.route}">${iconFor(group.icon)}<span>${group.name}</span></button>`;
    }
    return `
      <div class="nav-group">
        <div class="nav-label">${group.label}</div>
        ${group.items.map((i) => `<button class="nav-item" data-route="${i.route}">${iconFor(i.icon)}<span>${i.name}</span></button>`).join('')}
      </div>
    `;
  }).join('');
  nav.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });
}

function iconFor(name) {
  const paths = {
    dashboard:   '<path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>',
    products:    '<path d="M20 6h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4v14h16V6zm-10-2h4v2h-4V4z"/>',
    orders:      '<path d="M19 7h-3V6a4 4 0 0 0-8 0v1H5v14h14V7zm-9-1a2 2 0 0 1 4 0v1h-4V6zm6 4H8V9h8v1z"/>',
    production:  '<path d="M22 22H2v-2h20v2zM7 12l1.5-1.5L12 14l3.5-3.5L17 12l-5 5-5-5z"/>',
    finance:     '<path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>',
    settings:    '<path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.14.24.43.33.68.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65A.49.49 0 0 0 10 22h4a.49.49 0 0 0 .49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65zM12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5z"/>',
    users:       '<path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>',
    link:        '<path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4a5 5 0 0 0 0-10z"/>',
    wallet:      '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1.5h-9a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2H21zm-9 2h9v5h-9v-5zm3 3.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0z"/>',
    warn:        '<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">${paths[name] || paths.dashboard}</svg>`;
}

function setActiveNav(route) {
  document.querySelectorAll('.sidebar .nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.route === route);
  });
}

async function navigate(route) {
  if (!route) return;
  CURRENT_ROUTE = route;
  setActiveNav(route);
  const view = VIEWS[route];
  if (!view) {
    document.getElementById('content').innerHTML = `<div class="empty">Sayfa bulunamadı: ${route}</div>`;
    return;
  }
  document.getElementById('pageTitle').textContent = view.title;
  try { await view.render(); }
  catch (e) { toast(e.message, true); document.getElementById('content').innerHTML = `<div class="empty">Hata: ${e.message}</div>`; }
}

// ==========================================================================
// NAV DEFINITIONS
// ==========================================================================
const NAV_BY_ROLE = {
  store_owner: [
    { route: 'store/dashboard', name: 'Dashboard', icon: 'dashboard' },
    { route: 'store/products',  name: 'Ürünler',   icon: 'products' },
    {
      label: 'Siparişler',
      items: [
        { route: 'store/orders/pending',  name: 'Onay Gerektirenler', icon: 'orders' },
        { route: 'store/orders/all',      name: 'Siparişleriniz',     icon: 'orders' },
        { route: 'store/orders/shipped',  name: 'Sevk Edilenler',     icon: 'orders' },
        { route: 'store/orders/rejected', name: 'İptal Edilenler',    icon: 'orders' },
      ],
    },
    {
      label: 'Üretim',
      items: [{ route: 'store/issues', name: 'Sorunlular', icon: 'warn' }],
    },
    {
      label: 'Finans',
      items: [
        { route: 'store/wallet', name: 'Cüzdanım', icon: 'wallet' },
        { route: 'store/ledger', name: 'Defter',   icon: 'finance' },
      ],
    },
    {
      label: 'Bağlantılar',
      items: [{ route: 'store/stores', name: 'Mağazalar', icon: 'link' }],
    },
  ],
  supplier: [
    { route: 'supplier/dashboard', name: 'Dashboard', icon: 'dashboard' },
    { route: 'supplier/catalog',   name: 'Ürün Kataloğum', icon: 'products' },
    {
      label: 'Siparişler',
      items: [
        { route: 'supplier/orders/queue',    name: 'Üretim Kuyruğu',  icon: 'production' },
        { route: 'supplier/orders/all',      name: 'Tüm Siparişler',  icon: 'orders' },
        { route: 'supplier/orders/shipped',  name: 'Kargolanan',      icon: 'orders' },
      ],
    },
    {
      label: 'Mağaza Sahipleri',
      items: [
        { route: 'supplier/balance-mgmt', name: 'Bakiye Yönetimi', icon: 'wallet' },
        { route: 'supplier/owners',       name: 'Bağlı Sahipler',  icon: 'users' },
      ],
    },
  ],
  admin: [
    { route: 'admin/dashboard', name: 'Dashboard', icon: 'dashboard' },
    { route: 'admin/users',     name: 'Kullanıcılar', icon: 'users' },
    { route: 'admin/stores',    name: 'Mağazalar',    icon: 'link' },
    {
      label: 'Sipariş & Finans',
      items: [
        { route: 'admin/orders', name: 'Tüm Siparişler', icon: 'orders' },
        { route: 'admin/ledger', name: 'Defter',         icon: 'finance' },
      ],
    },
    {
      label: 'Sistem',
      items: [{ route: 'admin/sync', name: 'Senkronizasyon', icon: 'settings' }],
    },
  ],
};

// ==========================================================================
// VIEWS
// ==========================================================================
const VIEWS = {};

// --------------------- STORE OWNER ----------------------------------------
VIEWS['store/dashboard'] = {
  title: 'Dashboard',
  async render() {
    const [stats, topPicks, categories] = await Promise.all([
      api.get('/api/store/dashboard'),
      api.get('/api/store/products?top_pick=1&limit=4'),
      api.get('/api/store/categories'),
    ]);
    document.getElementById('content').innerHTML = `
      <div class="hero">
        <div class="welcome-to">Welcome to Supplier Hub</div>
        <h2>İyi günler, ${ME.name || ME.email.split('@')[0]}!</h2>
        <p>Siparişlerini yönet, ürünleri keşfet ve işini büyüt. Tek panelden her şey.</p>
        <div class="actions">
          <button class="btn primary" onclick="navigate('store/products')">📦 Ürünlere Göz At</button>
          <button class="btn secondary" onclick="navigate('store/orders/all')">🛒 Siparişlerim</button>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="icon">⏳</div>
          <div><div class="num">${stats.pending_count || 0}</div><div class="label">Bekleyen Siparişler</div></div></div>
        <div class="stat-card warn"><div class="icon">🚚</div>
          <div><div class="num">${stats.in_progress_count || 0}</div><div class="label">In Progress</div></div></div>
        <div class="stat-card ok"><div class="icon">✓</div>
          <div><div class="num">${stats.shipped_count || 0}</div><div class="label">Sevk Edilenler</div></div></div>
      </div>

      <div class="panel-card">
        <div class="panel-head">
          <div>
            <h3>Top Picks</h3>
            <small>Senin için öne çıkan ürünler</small>
          </div>
          <a href="#" onclick="navigate('store/products');return false">Tüm Ürünler →</a>
        </div>
        <div class="panel-body">
          ${topPicks.length ? `<div class="product-grid">${topPicks.map(productCardHTML).join('')}</div>` : '<p class="muted">Henüz top pick yok.</p>'}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;align-items:start">
        <div class="panel-card">
          <div class="panel-head"><h3>Kategorilere Göz At</h3></div>
          <div class="panel-body">
            <div class="cat-grid">
              ${categories.map((c) => `
                <div class="cat-card" data-slug="${c.slug}">
                  <div class="dot"></div>
                  <div class="name">${c.name}</div>
                  <div class="count">${c.product_count}</div>
                </div>`).join('')}
            </div>
          </div>
        </div>
        <div class="panel-card">
          <div class="panel-head"><h3>Başlangıç</h3></div>
          <div class="panel-body">
            <ul class="checklist">
              <li><span class="dot">🔗</span>Mağazanı bağla</li>
              <li><span class="dot">📦</span>Ürün kataloğuna göz at</li>
              <li><span class="dot">🛒</span>Siparişlerini yönet</li>
              <li><span class="dot">🚚</span>Kargo takibini gör</li>
              <li><span class="dot">💳</span>Cüzdanına bakiye yükle</li>
            </ul>
          </div>
        </div>
      </div>
    `;
    document.querySelectorAll('.product-card').forEach((c) =>
      c.addEventListener('click', () => openProductDrawer(Number(c.dataset.id))));
    document.querySelectorAll('.cat-card').forEach((c) =>
      c.addEventListener('click', () => { navigate('store/products'); sessionStorage.setItem('_cat', c.dataset.slug); }));
  },
};

function productCardHTML(p) {
  const bg = p.image_url ? `background-image:url('${p.image_url}')` : '';
  return `
    <div class="product-card" data-id="${p.id}">
      <div class="img" style="${bg}"></div>
      <div class="body">
        <div class="title">${p.title}</div>
        <div class="price">${fmtMoney(p.base_price, p.currency)}</div>
        <div class="sku">${p.sku}</div>
      </div>
    </div>
  `;
}

async function openProductDrawer(id) {
  const p = await api.get(`/api/store/products/${id}`);
  openDrawer(`
    <h2>${p.title}</h2>
    <div class="meta">${p.category_name || '—'} • SKU: ${p.sku}</div>
    ${p.image_url ? `<div style="background:var(--bg);border-radius:10px;overflow:hidden;margin-bottom:14px"><img src="${p.image_url}" style="width:100%;display:block" alt=""></div>` : ''}
    <div class="group"><label>Açıklama</label><div style="color:var(--text-muted);font-size:13px">${p.description || '—'}</div></div>
    <div class="group"><label>Fiyat</label><div style="font-size:18px;font-weight:700;color:var(--primary-dark)">${fmtMoney(p.base_price, p.currency)}</div></div>
    ${p.variants && p.variants.length ? `
      <div class="group"><label>Varyantlar</label>
        <div class="item-list">${p.variants.map((v) =>
          `<div class="item"><span>${v.name}</span><span>${v.price_delta > 0 ? '+' + v.price_delta.toFixed(2) : (v.price_delta < 0 ? v.price_delta.toFixed(2) : '—')}</span></div>`
        ).join('')}</div>
      </div>` : ''}
    <div class="group"><label>Tedarikçi</label><div>${p.supplier_email || '—'}</div></div>
  `);
}

VIEWS['store/products'] = {
  title: 'Ürünler',
  async render() {
    const savedCat = sessionStorage.getItem('_cat') || '';
    sessionStorage.removeItem('_cat');
    document.getElementById('content').innerHTML = `
      <div class="section-head">
        <div><h2>Ürünler</h2><p>Tedarikçinin kataloğuna göz at</p></div>
        <div class="filters">
          <select id="catFilter"><option value="">Tüm kategoriler</option></select>
          <input id="prodSearch" type="search" placeholder="Ürün veya SKU ara..." />
        </div>
      </div>
      <div id="prodGrid"></div>
    `;
    const categories = await api.get('/api/store/categories');
    const catSel = document.getElementById('catFilter');
    catSel.innerHTML += categories.map((c) => `<option value="${c.slug}" ${c.slug === savedCat ? 'selected' : ''}>${c.name} (${c.product_count})</option>`).join('');

    const draw = async () => {
      const p = new URLSearchParams();
      if (catSel.value) p.set('category_slug', catSel.value);
      const q = document.getElementById('prodSearch').value;
      if (q) p.set('q', q);
      const list = await api.get('/api/store/products?' + p);
      const grid = document.getElementById('prodGrid');
      if (!list.length) { grid.innerHTML = '<div class="empty">Ürün bulunamadı</div>'; return; }
      grid.innerHTML = `<div class="product-grid">${list.map(productCardHTML).join('')}</div>`;
      grid.querySelectorAll('.product-card').forEach((c) =>
        c.addEventListener('click', () => openProductDrawer(Number(c.dataset.id))));
    };
    catSel.addEventListener('change', draw);
    document.getElementById('prodSearch').addEventListener('input', () => {
      clearTimeout(window._pt); window._pt = setTimeout(draw, 250);
    });
    draw();
  },
};

// Store owner orders — single view with subtabs
async function storeOrdersView(statusFilter, titleHint) {
  const [orders] = await Promise.all([fetchStoreOrders(statusFilter)]);
  const counts = await fetchStoreStatusCounts();

  document.getElementById('content').innerHTML = `
    <div class="section-head">
      <div><h2>${titleHint}</h2></div>
    </div>
    <div class="subtabs">
      <button data-tab="pending"  ${CURRENT_ROUTE === 'store/orders/pending' ? 'class="active"' : ''}>Onay Gerektirenler <span class="count">${counts.new || 0}</span></button>
      <button data-tab="all"      ${CURRENT_ROUTE === 'store/orders/all' ? 'class="active"' : ''}>Tümü <span class="count">${counts.total || 0}</span></button>
      <button data-tab="shipped"  ${CURRENT_ROUTE === 'store/orders/shipped' ? 'class="active"' : ''}>Sevk Edilenler <span class="count">${counts.shipped || 0}</span></button>
      <button data-tab="rejected" ${CURRENT_ROUTE === 'store/orders/rejected' ? 'class="active"' : ''}>İptal Edilenler <span class="count">${counts.rejected || 0}</span></button>
    </div>
    <div id="orderList"></div>
  `;
  document.querySelectorAll('.subtabs button').forEach((b) => {
    b.addEventListener('click', () => navigate('store/orders/' + b.dataset.tab));
  });
  renderStoreOrdersTable(orders);
}

async function fetchStoreOrders(status) {
  const p = new URLSearchParams();
  if (status) p.set('status', status);
  return api.get('/api/store/orders?' + p);
}
async function fetchStoreStatusCounts() {
  const dash = await api.get('/api/store/dashboard');
  const all = await api.get('/api/store/orders');
  return {
    new: dash.pending_count || 0,
    in_progress: dash.in_progress_count || 0,
    shipped: dash.shipped_count || 0,
    rejected: dash.rejected_count || 0,
    total: all.length,
  };
}

function renderStoreOrdersTable(orders) {
  const body = document.getElementById('orderList');
  if (!orders.length) { body.innerHTML = '<div class="empty">Bu kategoride sipariş yok</div>'; return; }
  body.innerHTML = `
    <table><thead><tr>
      <th>Tarih</th><th>Mağaza</th><th>Sipariş No</th><th>Müşteri</th>
      <th>Tutar</th><th>Durum</th><th>Tedarikçi</th><th>Maliyet</th>
    </tr></thead><tbody>
    ${orders.map((o) => `
      <tr data-id="${o.id}">
        <td>${fmtDate(o.received_at)}</td>
        <td>${o.store_name}</td>
        <td><code>${o.external_order_id}</code></td>
        <td>${o.buyer_name || '—'}</td>
        <td>${fmtMoney(o.total_amount, o.currency)}</td>
        <td><span class="pill ${o.status}">${STATUS_TR[o.status] || o.status}</span></td>
        <td>${o.supplier_email || '—'}</td>
        <td>${o.supplier_cost ? fmtMoney(o.supplier_cost, o.currency) : '—'}</td>
      </tr>`).join('')}
    </tbody></table>
  `;
  body.querySelectorAll('tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => openStoreOrderDrawer(Number(tr.dataset.id))));
}

async function openStoreOrderDrawer(id) {
  const [o, products] = await Promise.all([
    api.get(`/api/store/orders/${id}`),
    api.get('/api/store/products'),
  ]);
  const items = (o.items || []).map((i) =>
    `<div class="item"><span>${i.quantity}× ${i.title || i.sku || '—'}</span><span>${fmtMoney(i.price, o.currency)}</span></div>`).join('');

  const canMatch  = ['new', 'rejected'].includes(o.status);
  const canCancel = o.status === 'in_production';
  const matched = o.product_id ? products.find((p) => p.id === o.product_id) : null;

  openDrawer(`
    <h2>#${o.external_order_id}</h2>
    <div class="meta">${o.store_name} • ${fmtDate(o.received_at)} • <span class="pill ${o.status}">${STATUS_TR[o.status] || o.status}</span></div>
    <div class="group"><label>Müşteri</label><div>${o.buyer_name || '—'}</div></div>
    <div class="group"><label>Kargo Adresi</label>
      <div>${[o.ship_name, o.ship_address1, o.ship_city, o.ship_country].filter(Boolean).join(', ')}</div></div>
    <div class="group"><label>Etsy Ürünleri</label><div class="item-list">${items || '—'}</div></div>
    ${matched ? `
      <div class="group"><label>Eşleştirilen Tedarikçi Ürünü</label>
        <div style="display:flex;gap:10px;align-items:center;background:var(--bg);padding:10px;border-radius:8px">
          ${matched.image_url ? `<img src="${matched.image_url}" style="width:48px;height:48px;border-radius:6px;object-fit:cover">` : ''}
          <div>
            <div style="font-weight:600">${matched.title}</div>
            <div style="font-size:12px;color:var(--muted)">${fmtMoney(matched.base_price)} • ${o.supplier_email}</div>
          </div>
        </div>
      </div>` : ''}
    ${o.tracking_number ? `<div class="group"><label>Kargo</label><div>${o.tracking_carrier || ''} ${o.tracking_number}</div></div>` : ''}
    ${o.rejection_reason ? `<div class="group"><label>İptal sebebi</label><div>${o.rejection_reason}</div></div>` : ''}

    ${canMatch ? `
      <hr class="divider">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:10px">Tedarikçi ürünü seç</h3>
      <p class="muted" style="margin-bottom:12px">Seçtiğin ürünün fiyatı bakiyenden düşer ve tedarikçiye otomatik gider.</p>
      ${products.length ? `
        <div id="prodPickGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-height:320px;overflow-y:auto">
          ${products.map((p) => `
            <div class="prod-pick" data-id="${p.id}" style="border:2px solid var(--line);border-radius:8px;padding:8px;cursor:pointer;display:flex;gap:8px;align-items:center">
              ${p.image_url ? `<img src="${p.image_url}" style="width:40px;height:40px;border-radius:6px;object-fit:cover">` : '<div style="width:40px;height:40px;border-radius:6px;background:var(--bg)"></div>'}
              <div style="min-width:0">
                <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.title}</div>
                <div style="font-size:13px;font-weight:700;color:var(--primary-dark)">${fmtMoney(p.base_price)}</div>
              </div>
            </div>`).join('')}
        </div>
        <button class="save" id="matchBtn" disabled style="opacity:0.5">Bir ürün seç</button>
      ` : '<div class="empty">Tedarikçinin kataloğunda henüz ürün yok. Tedarikçiye haber ver.</div>'}
    ` : ''}
    ${canCancel ? `
      <hr class="divider">
      <div class="group"><label>İptal sebebi</label><input id="rjReason" /></div>
      <button class="save" id="cnlBtn" style="background:var(--err)">İptal Et (ödemeyi iade al)</button>
    ` : ''}
  `);

  if (canMatch && products.length) {
    let selectedId = null;
    const matchBtn = document.getElementById('matchBtn');
    document.querySelectorAll('.prod-pick').forEach((el) => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.prod-pick').forEach((x) => x.style.borderColor = 'var(--line)');
        el.style.borderColor = 'var(--primary)';
        selectedId = Number(el.dataset.id);
        matchBtn.disabled = false; matchBtn.style.opacity = 1;
        matchBtn.textContent = `Seç ve ödemeyi yap (${fmtMoney(products.find((p) => p.id === selectedId).base_price)})`;
      });
    });
    matchBtn.addEventListener('click', async () => {
      if (!selectedId) return;
      try {
        await api.post(`/api/store/orders/${id}/match`, { product_id: selectedId });
        toast('Üretime gönderildi'); closeDrawer(); navigate(CURRENT_ROUTE); refreshWallet();
      } catch (e) { toast(e.message, true); }
    });
  }
  if (canCancel) document.getElementById('cnlBtn').addEventListener('click', async () => {
    try {
      await api.post(`/api/store/orders/${id}/cancel`, { reason: document.getElementById('rjReason').value });
      toast('İptal edildi, bakiye iade edildi'); closeDrawer(); navigate(CURRENT_ROUTE); refreshWallet();
    } catch (e) { toast(e.message, true); }
  });
}

VIEWS['store/orders/pending']  = { title: 'Onay Gerektirenler', render: () => storeOrdersView('new',      'Onay Gerektirenler') };
VIEWS['store/orders/all']      = { title: 'Siparişleriniz',     render: () => storeOrdersView(null,       'Siparişleriniz') };
VIEWS['store/orders/shipped']  = { title: 'Sevk Edilenler',     render: () => storeOrdersView('shipped',  'Sevk Edilenler') };
VIEWS['store/orders/rejected'] = { title: 'İptal Edilenler',    render: () => storeOrdersView('rejected', 'İptal Edilenler') };

VIEWS['store/issues'] = {
  title: 'Sorunlular',
  async render() {
    const orders = await api.get('/api/store/orders?status=rejected');
    document.getElementById('content').innerHTML = `
      <div class="section-head"><div><h2>Sorunlular</h2><p>Red edilen ya da hatalı siparişler</p></div></div>
      <div id="orderList"></div>
    `;
    renderStoreOrdersTable(orders);
  },
};

VIEWS['store/wallet'] = {
  title: 'Cüzdanım',
  async render() {
    const { balance } = await api.get('/api/store/balance');
    const ledger = await api.get('/api/store/ledger');
    document.getElementById('content').innerHTML = `
      <div class="section-head"><div><h2>Cüzdanım</h2></div></div>
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card ok"><div class="icon">💰</div>
          <div><div class="num">${fmtMoney(balance)}</div><div class="label">Mevcut Bakiye</div></div></div>
      </div>
      <div class="panel-card">
        <div class="panel-head"><h3>Son hareketler</h3></div>
        <div class="panel-body" style="padding:0">
          ${renderLedgerTable(ledger)}
        </div>
      </div>
      <div class="muted" style="margin-top:16px">
        Bakiye yüklemek için tedarikçine banka/EFT ile ödeme yap. Tedarikçi parayı aldığında sistemden bakiyene ekleyecek.
      </div>
    `;
  },
};

VIEWS['store/ledger'] = {
  title: 'Defter',
  async render() {
    const ledger = await api.get('/api/store/ledger');
    document.getElementById('content').innerHTML = `
      <div class="section-head"><div><h2>Defter</h2><p>Tüm bakiye hareketlerin</p></div></div>
      ${renderLedgerTable(ledger)}
    `;
  },
};

VIEWS['store/stores'] = {
  title: 'Mağazalar',
  async render() {
    const stores = await api.get('/api/store/stores');
    document.getElementById('content').innerHTML = `
      <div class="section-head"><div><h2>Mağazalarım</h2></div></div>
      ${stores.length ? `
        <table><thead><tr><th>Ad</th><th>Platform</th><th>External ID</th><th>Sipariş</th></tr></thead><tbody>
        ${stores.map((s) => `<tr><td>${s.name}</td><td>${s.platform}</td><td><code>${s.external_id || '—'}</code></td><td>${s.order_count}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Henüz mağaza yok. Admin seni bir mağazaya bağladığında burada görünür.</div>'}
    `;
  },
};

// --------------------- SUPPLIER -------------------------------------------
VIEWS['supplier/dashboard'] = {
  title: 'Dashboard',
  async render() {
    const orders = await api.get('/api/supplier/orders');
    const counts = orders.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {});
    document.getElementById('content').innerHTML = `
      <div class="hero">
        <h2>Hoş geldin, ${ME.name || ME.email.split('@')[0]}!</h2>
        <p>Gelen siparişleri üret, kargola. Müşterinin seçtiği ürünün ücreti otomatik düşülüyor.</p>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="icon">🧾</div>
          <div><div class="num">${counts.in_production || 0}</div><div class="label">Üretim Kuyruğunda</div></div></div>
        <div class="stat-card ok"><div class="icon">🚚</div>
          <div><div class="num">${counts.shipped || 0}</div><div class="label">Kargolanan</div></div></div>
        <div class="stat-card warn"><div class="icon">✕</div>
          <div><div class="num">${counts.rejected || 0}</div><div class="label">İptal Edilen</div></div></div>
      </div>
    `;
  },
};

VIEWS['supplier/catalog'] = {
  title: 'Ürün Kataloğum',
  async render() {
    const products = await api.get('/api/supplier/products');
    document.getElementById('content').innerHTML = `
      <div class="section-head">
        <div><h2>Ürün Kataloğum</h2><p>Mağaza sahipleri bu ürünleri sipariş için seçecek</p></div>
        <button class="btn btn-primary" id="addProdBtn">+ Ürün Ekle</button>
      </div>
      <div id="prodList"></div>
    `;
    document.getElementById('addProdBtn').addEventListener('click', () => openSupplierProductDrawer(null));
    if (!products.length) {
      document.getElementById('prodList').innerHTML = '<div class="empty">Henüz ürün yok. Sağ üstteki <b>+ Ürün Ekle</b> butonuyla başla.</div>';
      return;
    }
    document.getElementById('prodList').innerHTML = `
      <div class="product-grid">
        ${products.map((p) => `
          <div class="product-card" data-id="${p.id}">
            <div class="img" style="${p.image_url ? `background-image:url('${p.image_url}')` : ''}"></div>
            <div class="body">
              <div class="title">${p.title}</div>
              <div class="price">${fmtMoney(p.base_price, p.currency)}</div>
              <div class="sku">${p.is_active ? '' : '⚠ Pasif '}<code>${p.sku}</code></div>
            </div>
          </div>`).join('')}
      </div>
    `;
    document.querySelectorAll('.product-card').forEach((c) =>
      c.addEventListener('click', () => openSupplierProductDrawer(Number(c.dataset.id))));
  },
};

async function openSupplierProductDrawer(id) {
  const isNew = id == null;
  const p = isNew
    ? { sku: '', title: '', description: '', image_url: '', base_price: 0, is_active: 1 }
    : await api.get(`/api/supplier/products/${id}`);

  openDrawer(`
    <h2>${isNew ? 'Yeni ürün' : p.title}</h2>
    <div class="meta">${isNew ? 'Kataloğa yeni ürün ekle' : 'SKU: ' + p.sku}</div>
    ${p.image_url ? `<div style="background:var(--bg);border-radius:10px;overflow:hidden;margin-bottom:14px"><img src="${p.image_url}" style="width:100%;display:block" alt=""></div>` : ''}
    <div class="group"><label>Ürün Başlığı</label><input id="pTitle" value="${p.title || ''}" placeholder="Ör: Gildan 18500 Hoodie" /></div>
    ${isNew ? `<div class="group"><label>SKU (iç kod)</label><input id="pSku" placeholder="Ör: HOODIE-18500" /></div>` : ''}
    <div class="group"><label>Görsel URL</label><input id="pImg" value="${p.image_url || ''}" placeholder="https://..." /></div>
    <div class="group"><label>Base Fiyat (USD)</label><input id="pPrice" type="number" step="0.01" value="${p.base_price || ''}" placeholder="19.50" /></div>
    <div class="group"><label>Açıklama (opsiyonel)</label><textarea id="pDesc" rows="3">${p.description || ''}</textarea></div>
    ${!isNew ? `
      <div class="group"><label>Durum</label>
        <select id="pActive">
          <option value="1" ${p.is_active ? 'selected' : ''}>Aktif (mağaza sahipleri görür)</option>
          <option value="0" ${!p.is_active ? 'selected' : ''}>Pasif (gizli)</option>
        </select></div>
    ` : ''}
    <button class="save" id="pSave">${isNew ? 'Oluştur' : 'Kaydet'}</button>
  `);

  document.getElementById('pSave').addEventListener('click', async () => {
    const body = {
      title: document.getElementById('pTitle').value,
      description: document.getElementById('pDesc').value,
      image_url: document.getElementById('pImg').value,
      base_price: Number(document.getElementById('pPrice').value),
    };
    if (!body.title || !body.base_price) { toast('Başlık ve fiyat zorunlu', true); return; }
    try {
      if (isNew) {
        body.sku = document.getElementById('pSku').value || ('P-' + Date.now());
        await api.post('/api/supplier/products', body);
      } else {
        body.is_active = document.getElementById('pActive').value === '1';
        await api.patch(`/api/supplier/products/${id}`, body);
      }
      toast('Kaydedildi'); closeDrawer(); navigate('supplier/catalog');
    } catch (e) { toast(e.message, true); }
  });
}

async function supplierOrdersView(statusFilter, titleHint) {
  const p = new URLSearchParams();
  if (statusFilter) p.set('status', statusFilter);
  const orders = await api.get('/api/supplier/orders?' + p);
  const all = await api.get('/api/supplier/orders');
  const counts = all.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {});

  document.getElementById('content').innerHTML = `
    <div class="section-head"><div><h2>${titleHint}</h2></div></div>
    <div class="subtabs">
      <button data-tab="queue"   ${CURRENT_ROUTE === 'supplier/orders/queue' ? 'class="active"' : ''}>Üretim Kuyruğu <span class="count">${(counts.assigned || 0) + (counts.in_production || 0)}</span></button>
      <button data-tab="all"     ${CURRENT_ROUTE === 'supplier/orders/all' ? 'class="active"' : ''}>Tümü <span class="count">${all.length}</span></button>
      <button data-tab="shipped" ${CURRENT_ROUTE === 'supplier/orders/shipped' ? 'class="active"' : ''}>Kargolanan <span class="count">${counts.shipped || 0}</span></button>
    </div>
    <div id="orderList"></div>
  `;
  document.querySelectorAll('.subtabs button').forEach((b) => {
    b.addEventListener('click', () => navigate('supplier/orders/' + b.dataset.tab));
  });
  if (!orders.length) { document.getElementById('orderList').innerHTML = '<div class="empty">Sipariş yok</div>'; return; }
  document.getElementById('orderList').innerHTML = `
    <table><thead><tr>
      <th>Mağaza</th><th>Sipariş No</th><th>Müşteri</th><th>Adres</th><th>Maliyet</th><th>Durum</th><th>Kargo</th>
    </tr></thead><tbody>
    ${orders.map((o) => `
      <tr data-id="${o.id}">
        <td>${o.store_name}</td>
        <td><code>${o.external_order_id}</code></td>
        <td>${o.buyer_name || '—'}</td>
        <td>${[o.ship_city, o.ship_country].filter(Boolean).join(', ') || '—'}</td>
        <td>${fmtMoney(o.supplier_cost, o.currency)}</td>
        <td><span class="pill ${o.status}">${STATUS_TR[o.status] || o.status}</span></td>
        <td>${o.tracking_number || '—'}</td>
      </tr>`).join('')}
    </tbody></table>
  `;
  document.querySelectorAll('#orderList tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => openSupplierOrderDrawer(Number(tr.dataset.id))));
}

async function openSupplierOrderDrawer(id) {
  const o = await api.get(`/api/supplier/orders/${id}`);
  const items = (o.items || []).map((i) =>
    `<div class="item"><span>${i.quantity}× ${i.title || i.sku || '—'}</span><span>${fmtMoney(i.price, o.currency)}</span></div>`).join('');
  const editable = ['assigned', 'in_production'].includes(o.status);

  openDrawer(`
    <h2>#${o.external_order_id}</h2>
    <div class="meta">${o.store_name} • <span class="pill ${o.status}">${STATUS_TR[o.status] || o.status}</span></div>
    <div class="group"><label>Müşteri / Adres</label>
      <div>${o.buyer_name || '—'}<br>${[o.ship_address1, o.ship_city, o.ship_state, o.ship_postal, o.ship_country].filter(Boolean).join(', ')}</div></div>
    <div class="group"><label>Ürünler</label><div class="item-list">${items || '—'}</div></div>
    <div class="group"><label>Maliyet (sana ödenecek)</label><div style="font-size:16px;font-weight:700;color:var(--primary-dark)">${fmtMoney(o.supplier_cost, o.currency)}</div></div>
    ${editable ? `
      <hr class="divider">
      <div class="group"><label>Durum</label>
        <select id="spStatus">
          <option value="in_production" ${o.status === 'in_production' ? 'selected' : ''}>Üretimde</option>
          <option value="shipped">Kargoda</option>
        </select></div>
      <div class="group"><label>Kargo</label>
        <div class="row">
          <input id="spCarrier" placeholder="Carrier" value="${o.tracking_carrier || 'FedEx'}" />
          <input id="spTrack" placeholder="Takip no" value="${o.tracking_number || ''}" />
        </div></div>
      <button class="save" id="spSave">Kaydet</button>
    ` : `<div class="group"><label>Kargo</label><div>${o.tracking_carrier || ''} ${o.tracking_number || '—'}</div></div>`}
  `);
  if (editable) document.getElementById('spSave').addEventListener('click', async () => {
    try {
      await api.patch(`/api/supplier/orders/${id}`, {
        status: document.getElementById('spStatus').value,
        tracking_carrier: document.getElementById('spCarrier').value,
        tracking_number: document.getElementById('spTrack').value,
      });
      toast('Kaydedildi'); closeDrawer(); navigate(CURRENT_ROUTE);
    } catch (e) { toast(e.message, true); }
  });
}

VIEWS['supplier/orders/queue']   = { title: 'Üretim Kuyruğu', render: () => supplierOrdersView('assigned', 'Üretim Kuyruğu') };
VIEWS['supplier/orders/all']     = { title: 'Tüm Siparişler', render: () => supplierOrdersView(null, 'Tüm Siparişler') };
VIEWS['supplier/orders/shipped'] = { title: 'Kargolanan',     render: () => supplierOrdersView('shipped', 'Kargolanan') };

VIEWS['supplier/balance-mgmt'] = {
  title: 'Bakiye Yönetimi',
  async render() {
    const [owners, history] = await Promise.all([
      api.get('/api/supplier/owners'),
      api.get('/api/supplier/balance-changes'),
    ]);
    document.getElementById('content').innerHTML = `
      <div class="section-head">
        <div><h2>Bakiye Yönetimi</h2><p>Mağaza sahiplerinin bakiyesine ekle veya kesinti yap</p></div>
        <button class="btn btn-primary" id="addBcBtn">+ Yeni Hareket</button>
      </div>
      <div id="bcList"></div>
    `;
    document.getElementById('addBcBtn').addEventListener('click', () => openBalanceChangeDrawer(owners));
    if (!history.length) { document.getElementById('bcList').innerHTML = '<div class="empty">Henüz hareket yok</div>'; return; }
    document.getElementById('bcList').innerHTML = `
      <table><thead><tr><th>Tarih</th><th>Mağaza Sahibi</th><th>İşlem</th><th>Tutar</th><th>Not</th></tr></thead><tbody>
      ${history.map((d) => {
        const positive = d.amount >= 0;
        return `<tr>
          <td>${fmtDate(d.created_at)}</td>
          <td>${d.owner_email}</td>
          <td><span class="pill ${positive ? 'deposit' : 'adjustment'}">${positive ? 'Ekleme' : 'Kesinti'}</span></td>
          <td class="${positive ? 'pos' : 'neg'}">${positive ? '+' : ''}${Number(d.amount).toFixed(2)}</td>
          <td>${d.note || '—'}</td>
        </tr>`;
      }).join('')}
      </tbody></table>
    `;
  },
};

function openBalanceChangeDrawer(owners) {
  openDrawer(`
    <h2>Yeni bakiye hareketi</h2>
    <div class="meta">Ekleme için pozitif, kesinti için negatif tutar gir</div>
    <div class="group"><label>Mağaza sahibi</label>
      <select id="bcOwner">${owners.map((o) => `<option value="${o.id}">${o.email} (mevcut: ${fmtMoney(o.balance)})</option>`).join('')}</select></div>
    <div class="group"><label>İşlem tipi</label>
      <select id="bcType">
        <option value="add">Ekleme (para yatırdı)</option>
        <option value="deduct">Kesinti (benden alacağı vardı)</option>
      </select></div>
    <div class="group"><label>Tutar (pozitif yaz)</label><input id="bcAmt" type="number" step="0.01" min="0" /></div>
    <div class="group"><label>Not (referans no, sebep)</label><input id="bcNote" /></div>
    <button class="save" id="bcSave">Kaydet</button>
  `);
  document.getElementById('bcSave').addEventListener('click', async () => {
    const amt = Math.abs(Number(document.getElementById('bcAmt').value));
    const signed = document.getElementById('bcType').value === 'add' ? amt : -amt;
    if (!signed) { toast('Tutar gir', true); return; }
    try {
      await api.post('/api/supplier/balance-changes', {
        owner_id: Number(document.getElementById('bcOwner').value),
        amount: signed,
        note: document.getElementById('bcNote').value,
      });
      toast('Kaydedildi'); closeDrawer(); navigate('supplier/balance-mgmt');
    } catch (e) { toast(e.message, true); }
  });
}

VIEWS['supplier/owners'] = {
  title: 'Mağaza Sahipleri',
  async render() {
    const owners = await api.get('/api/supplier/owners');
    document.getElementById('content').innerHTML = `
      <div class="section-head"><div><h2>Bağlı Mağaza Sahipleri</h2></div></div>
      ${owners.length ? `
        <table><thead><tr><th>Ad</th><th>E-posta</th><th>Bakiye</th></tr></thead><tbody>
        ${owners.map((o) => `<tr><td>${o.name || '—'}</td><td>${o.email}</td><td>${fmtMoney(o.balance)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Bağlı mağaza sahibi yok</div>'}
    `;
  },
};

// --------------------- ADMIN ----------------------------------------------
VIEWS['admin/dashboard'] = {
  title: 'Dashboard',
  async render() {
    const [users, stores, stats] = await Promise.all([
      api.get('/api/admin/users'),
      api.get('/api/admin/stores'),
      api.get('/api/admin/stats'),
    ]);
    document.getElementById('content').innerHTML = `
      <div class="hero"><h2>Admin Paneli</h2><p>Sistem genel durumu</p></div>
      <div class="stat-grid">
        <div class="stat-card"><div class="icon">👥</div><div><div class="num">${users.length}</div><div class="label">Kullanıcı</div></div></div>
        <div class="stat-card ok"><div class="icon">🏪</div><div><div class="num">${stores.length}</div><div class="label">Mağaza</div></div></div>
        <div class="stat-card warn"><div class="icon">📦</div><div><div class="num">${stats.total || 0}</div><div class="label">Toplam Sipariş</div></div></div>
        <div class="stat-card"><div class="icon">✓</div><div><div class="num">${stats.approved_count || 0}</div><div class="label">Onaylanan</div></div></div>
      </div>
    `;
  },
};

VIEWS['admin/users'] = {
  title: 'Kullanıcılar',
  async render() {
    const users = await api.get('/api/admin/users');
    document.getElementById('content').innerHTML = `
      <div class="section-head">
        <div><h2>Kullanıcılar</h2></div>
        <button class="btn btn-primary" id="addUserBtn">+ Kullanıcı Ekle</button>
      </div>
      <table><thead><tr>
        <th>E-posta</th><th>Ad</th><th>Rol</th><th>Durum</th><th>Bakiye</th><th>Kayıt</th><th></th>
      </tr></thead><tbody>
      ${users.map((u) => `
        <tr data-id="${u.id}">
          <td>${u.email}</td><td>${u.name || '—'}</td>
          <td>${ROLE_TR[u.role] || u.role}</td>
          <td>${u.is_active ? '<span class="pill active">Aktif</span>' : '<span class="pill inactive">Pasif</span>'}</td>
          <td>${fmtMoney(u.balance)}</td>
          <td>${fmtDate(u.created_at)}</td>
          <td><button class="btn-link">Düzenle</button></td>
        </tr>`).join('')}
      </tbody></table>
    `;
    document.getElementById('addUserBtn').addEventListener('click', () => openAddUserDrawer());
    document.querySelectorAll('tr[data-id]').forEach((tr) =>
      tr.addEventListener('click', () => openEditUserDrawer(users.find((u) => u.id == tr.dataset.id))));
  },
};

function openAddUserDrawer() {
  openDrawer(`
    <h2>Yeni kullanıcı</h2>
    <div class="group"><label>E-posta</label><input id="nuEmail" type="email" /></div>
    <div class="group"><label>Ad</label><input id="nuName" /></div>
    <div class="group"><label>Rol</label>
      <select id="nuRole">
        <option value="admin">Admin</option>
        <option value="store_owner" selected>Mağaza Sahibi</option>
        <option value="supplier">Tedarikçi</option>
      </select></div>
    <div class="group"><label>Şifre</label><input id="nuPw" type="password" /></div>
    <button class="save" id="nuSave">Oluştur</button>
  `);
  document.getElementById('nuSave').addEventListener('click', async () => {
    try {
      await api.post('/api/admin/users', {
        email: document.getElementById('nuEmail').value,
        name: document.getElementById('nuName').value,
        role: document.getElementById('nuRole').value,
        password: document.getElementById('nuPw').value,
      });
      toast('Oluşturuldu'); closeDrawer(); navigate('admin/users');
    } catch (e) { toast(e.message, true); }
  });
}

function openEditUserDrawer(u) {
  openDrawer(`
    <h2>${u.email}</h2>
    <div class="group"><label>Ad</label><input id="euName" value="${u.name || ''}" /></div>
    <div class="group"><label>Rol</label>
      <select id="euRole">
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        <option value="store_owner" ${u.role === 'store_owner' ? 'selected' : ''}>Mağaza Sahibi</option>
        <option value="supplier" ${u.role === 'supplier' ? 'selected' : ''}>Tedarikçi</option>
      </select></div>
    <div class="group"><label>Durum</label>
      <select id="euActive">
        <option value="1" ${u.is_active ? 'selected' : ''}>Aktif</option>
        <option value="0" ${!u.is_active ? 'selected' : ''}>Pasif</option>
      </select></div>
    <div class="group"><label>Yeni şifre (boş = değiştirme)</label><input id="euPw" type="password" /></div>
    <button class="save" id="euSave">Kaydet</button>
    <hr class="divider">
    <div class="group"><label>Manuel bakiye düzeltmesi</label>
      <div class="row">
        <input id="euAdj" type="number" step="0.01" placeholder="50 veya -25" />
        <input id="euAdjNote" placeholder="Not" />
      </div>
      <button class="save" id="euAdjBtn" style="background:var(--info);margin-top:8px">Bakiye Uygula</button>
    </div>
  `);
  document.getElementById('euSave').addEventListener('click', async () => {
    const body = {
      name: document.getElementById('euName').value,
      role: document.getElementById('euRole').value,
      is_active: document.getElementById('euActive').value === '1',
    };
    const pw = document.getElementById('euPw').value;
    if (pw) body.password = pw;
    try { await api.patch(`/api/admin/users/${u.id}`, body); toast('Güncellendi'); closeDrawer(); navigate('admin/users'); }
    catch (e) { toast(e.message, true); }
  });
  document.getElementById('euAdjBtn').addEventListener('click', async () => {
    const amount = Number(document.getElementById('euAdj').value);
    if (!amount) { toast('Tutar gerekli', true); return; }
    try {
      await api.post('/api/admin/adjustment', { user_id: u.id, amount, note: document.getElementById('euAdjNote').value });
      toast('Uygulandı'); closeDrawer(); navigate('admin/users');
    } catch (e) { toast(e.message, true); }
  });
}

VIEWS['admin/stores'] = {
  title: 'Mağazalar',
  async render() {
    const [stores, users] = await Promise.all([api.get('/api/admin/stores'), api.get('/api/admin/users')]);
    const suppliers = users.filter((u) => u.role === 'supplier');
    const owners = users.filter((u) => u.role === 'store_owner');
    document.getElementById('content').innerHTML = `
      <div class="section-head">
        <div><h2>Mağazalar</h2></div>
        <button class="btn btn-primary" id="addStoreBtn">+ Mağaza Ekle</button>
      </div>
      <table><thead><tr><th>Ad</th><th>Platform</th><th>Sahip</th><th>Sipariş</th><th></th></tr></thead><tbody>
      ${stores.map((s) => `
        <tr data-id="${s.id}"><td>${s.name}</td><td>${s.platform}</td><td>${s.owner_email || '—'}</td><td>${s.order_count}</td>
        <td><button class="btn-link">Tedarikçi Bağla</button></td></tr>`).join('')}
      </tbody></table>
    `;
    document.getElementById('addStoreBtn').addEventListener('click', () => openAddStoreDrawer(owners));
    document.querySelectorAll('tr[data-id]').forEach((tr) =>
      tr.addEventListener('click', () => openStoreSupplierDrawer(stores.find((s) => s.id == tr.dataset.id), suppliers)));
  },
};

function openAddStoreDrawer(owners) {
  openDrawer(`
    <h2>Yeni mağaza</h2>
    <div class="group"><label>Ad</label><input id="nsName" /></div>
    <div class="group"><label>Platform</label><input id="nsPlat" value="etsy" /></div>
    <div class="group"><label>External ID</label><input id="nsExt" /></div>
    <div class="group"><label>Sahip</label>
      <select id="nsOwner">${owners.map((o) => `<option value="${o.id}">${o.email}</option>`).join('')}</select></div>
    <button class="save" id="nsSave">Oluştur</button>
  `);
  document.getElementById('nsSave').addEventListener('click', async () => {
    try {
      await api.post('/api/admin/stores', {
        name: document.getElementById('nsName').value,
        platform: document.getElementById('nsPlat').value,
        external_id: document.getElementById('nsExt').value || null,
        owner_user_id: Number(document.getElementById('nsOwner').value),
      });
      toast('Oluşturuldu'); closeDrawer(); navigate('admin/stores');
    } catch (e) { toast(e.message, true); }
  });
}

function openStoreSupplierDrawer(store, suppliers) {
  openDrawer(`
    <h2>${store.name}</h2>
    <div class="meta">Bu mağazaya tedarikçi bağla</div>
    <div class="group"><label>Tedarikçi</label>
      <select id="ssSup">${suppliers.map((s) => `<option value="${s.id}">${s.email}</option>`).join('')}</select></div>
    <button class="save" id="ssAdd">Bağla</button>
  `);
  document.getElementById('ssAdd').addEventListener('click', async () => {
    try {
      await api.post('/api/admin/store-suppliers', { store_id: store.id, supplier_user_id: Number(document.getElementById('ssSup').value) });
      toast('Bağlandı'); closeDrawer();
    } catch (e) { toast(e.message, true); }
  });
}

VIEWS['admin/orders'] = {
  title: 'Tüm Siparişler',
  async render() {
    const stats = await api.get('/api/admin/stats');
    document.getElementById('content').innerHTML = `
      <div class="section-head"><div><h2>Tüm Siparişler</h2></div></div>
      <div class="stat-grid">
        ${['new','assigned','in_production','shipped','approved','rejected'].map((s) =>
          `<div class="stat-card"><div class="icon">📦</div><div><div class="num">${stats[s + '_count'] || 0}</div><div class="label">${STATUS_TR[s]}</div></div></div>`).join('')}
      </div>
      <p class="muted">Sipariş detayları mağaza/tedarikçi panellerinde görünür. Bu görünüm özet gösterir.</p>
    `;
  },
};

VIEWS['admin/ledger'] = {
  title: 'Defter',
  async render() {
    const entries = await api.get('/api/admin/ledger?limit=500');
    document.getElementById('content').innerHTML = `
      <div class="section-head"><div><h2>Defter</h2><p>Tüm kullanıcıların tüm hareketleri</p></div></div>
      <table><thead><tr>
        <th>Tarih</th><th>Kullanıcı</th><th>Tür</th><th>Tutar</th><th>Sipariş</th><th>Not</th><th>Kayıt Eden</th>
      </tr></thead><tbody>
      ${entries.map((e) => `
        <tr>
          <td>${fmtDate(e.created_at)}</td><td>${e.user_email}</td>
          <td><span class="pill ${e.type}">${e.type}</span></td>
          <td class="${e.amount >= 0 ? 'pos' : 'neg'}">${e.amount >= 0 ? '+' : ''}${Number(e.amount).toFixed(2)}</td>
          <td>${e.order_id || '—'}</td><td>${e.note || '—'}</td>
          <td>${e.created_by_email || '—'}</td>
        </tr>`).join('')}
      </tbody></table>
    `;
  },
};

VIEWS['admin/sync'] = {
  title: 'Senkronizasyon',
  async render() {
    document.getElementById('content').innerHTML = `
      <div class="section-head"><div><h2>Senkronizasyon</h2><p>Dış kaynaklardan sipariş çek</p></div></div>
      <div class="panel-card">
        <div class="panel-body">
          <p style="margin-bottom:14px">Easyship API'sinden yeni siparişleri manuel çek.</p>
          <button class="btn btn-primary" id="pollBtn">🔄 Şimdi Çek</button>
          <div id="pollResult" style="margin-top:14px;font-size:13px;color:var(--muted)"></div>
        </div>
      </div>
    `;
    document.getElementById('pollBtn').addEventListener('click', async () => {
      try {
        const r = await api.post('/api/admin/poll-now');
        document.getElementById('pollResult').textContent = `Çekildi: ${r.fetched || 0}, eklendi: ${r.inserted || 0}`;
        toast('Çekildi');
      } catch (e) { toast(e.message, true); }
    });
  },
};

// --------------------- shared helpers -------------------------------------
function renderLedgerTable(entries) {
  if (!entries.length) return '<div class="empty">Henüz hareket yok</div>';
  return `
    <table><thead><tr><th>Tarih</th><th>Tür</th><th>Tutar</th><th>Sipariş</th><th>Not</th></tr></thead><tbody>
    ${entries.map((e) => `
      <tr>
        <td>${fmtDate(e.created_at)}</td>
        <td><span class="pill ${e.type}">${e.type}</span></td>
        <td class="${e.amount >= 0 ? 'pos' : 'neg'}">${e.amount >= 0 ? '+' : ''}${Number(e.amount).toFixed(2)}</td>
        <td>${e.external_order_id || (e.order_id ? '#' + e.order_id : '—')}</td>
        <td>${e.note || '—'}</td>
      </tr>`).join('')}
    </tbody></table>
  `;
}

boot();
