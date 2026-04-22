require('dotenv').config();
const express = require('express');
const path = require('path');
const { createSource } = require('./lib/source-factory');
const { pollAndIngest } = require('./lib/ingest');
const auth = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3100;

app.use(express.json());
app.use(auth.sessionMiddleware());
app.use(express.static(path.join(__dirname, 'public')));

// Auth
app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);
app.post('/api/auth/signup', auth.signup);
app.get('/api/auth/me', auth.requireAuth, auth.me);

// Role-scoped route groups
app.use('/api/admin', require('./routes/admin'));
app.use('/api/store', require('./routes/store'));
app.use('/api/supplier', require('./routes/supplier'));

// Background poller (admin-triggered or interval)
const source = createSource(process.env);
const pollInterval = parseInt(process.env.POLL_INTERVAL_MS || '120000', 10);

async function pollTick() {
  try {
    const result = await pollAndIngest(source);
    if (result.inserted > 0) {
      console.log(`[poll] fetched ${result.fetched}, inserted ${result.inserted}`);
    }
    return result;
  } catch (err) {
    console.error('[poll] error:', err.message);
    return { error: err.message };
  }
}

app.post('/api/admin/poll-now', auth.requireAuth, auth.requireRole('admin'), async (req, res) => {
  const result = await pollTick();
  res.json(result || { ok: true });
});

app.listen(PORT, () => {
  console.log(`Supplier Hub running on http://localhost:${PORT}`);
  console.log(`Data source: ${process.env.DATA_SOURCE || 'mock'}`);
  if ((process.env.DATA_SOURCE || 'mock') !== 'mock') {
    setInterval(pollTick, pollInterval);
    pollTick();
  }
});
