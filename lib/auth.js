const bcrypt = require('bcryptjs');
const session = require('express-session');
const db = require('./db');

function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET env var required');
  return session({
    name: 'hub.sid',
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 14,
    },
  });
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const user = db
    .prepare('SELECT id, email, role, name, is_active FROM users WHERE id = ?')
    .get(req.session.userId);
  if (!user || !user.is_active) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = db
    .prepare('SELECT id, email, password_hash, role, name, is_active FROM users WHERE email = ?')
    .get(String(email).toLowerCase().trim());
  if (!user || !user.is_active) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  req.session.userId = user.id;
  res.json({ id: user.id, email: user.email, role: user.role, name: user.name });
}

function logout(req, res) {
  req.session.destroy(() => {
    res.clearCookie('hub.sid');
    res.json({ ok: true });
  });
}

function me(req, res) {
  res.json({ id: req.user.id, email: req.user.email, role: req.user.role, name: req.user.name });
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

// Public self-signup. Accepts role: 'store_owner' | 'supplier'. Admin role
// can only be created by an existing admin (via /api/admin/users).
async function signup(req, res) {
  const { email, password, name, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  const chosenRole = role === 'supplier' ? 'supplier' : 'store_owner';
  const normalized = String(email).toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
  if (existing) return res.status(409).json({ error: 'email already registered' });
  const hash = await hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)')
    .run(normalized, hash, chosenRole, name || null);
  const id = Number(info.lastInsertRowid);
  req.session.userId = id;
  res.json({ id, email: normalized, role: chosenRole, name: name || null });
}

module.exports = {
  sessionMiddleware,
  requireAuth,
  requireRole,
  login,
  logout,
  signup,
  me,
  hashPassword,
};
