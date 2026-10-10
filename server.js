'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const store = require('./lib/store');
const { quote, validateConfig } = require('./lib/core');

const ADMIN_CODE = String(process.env.ADMIN_CODE || '8866');
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;

store.init();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
  });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

// ---------- admin sessions ----------
const sessions = new Map(); // token -> expiry
const fails = new Map(); // ip -> { n, resetAt, lockedUntil }

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const codeMatches = (given) => crypto.timingSafeEqual(digest(given), digest(ADMIN_CODE));

function requireAdmin(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const exp = sessions.get(token);
  if (!token || !exp || exp < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Admin session expired. Please sign in again.' });
  }
  req.token = token;
  next();
}

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  let f = fails.get(ip);
  if (f && f.lockedUntil > now) {
    const mins = Math.ceil((f.lockedUntil - now) / 60000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${mins} min.` });
  }
  if (!codeMatches(req.body && req.body.code)) {
    if (!f || f.resetAt < now) f = { n: 0, resetAt: now + LOCK_MS, lockedUntil: 0 };
    f.n++;
    if (f.n >= MAX_FAILS) f.lockedUntil = now + LOCK_MS;
    fails.set(ip, f);
    return res.status(401).json({ error: 'Incorrect admin code.' });
  }
  fails.delete(ip);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, now + SESSION_MS);
  res.json({ token });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  sessions.delete(req.token);
  res.json({ ok: true });
});

app.get('/api/admin/config', requireAdmin, (req, res) => res.json(store.get()));

app.put('/api/admin/config', requireAdmin, (req, res) => {
  const { errors, config } = validateConfig(req.body);
  if (errors.length) return res.status(400).json({ error: 'Not saved.', details: errors });
  try { store.set(config); } catch (e) { console.error(e); return res.status(500).json({ error: 'Could not write to disk: ' + e.message + '. Check the DATA_DIR volume.' }); }
  res.json({ ok: true, config });
});

app.post('/api/admin/reset', requireAdmin, (req, res) => {
  try { store.reset(); } catch (e) { console.error(e); return res.status(500).json({ error: 'Could not write to disk: ' + e.message }); }
  res.json({ ok: true, config: store.get() });
});

setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
  for (const [ip, f] of fails) if (f.resetAt < now && f.lockedUntil < now) fails.delete(ip);
}, 10 * 60 * 1000).unref();

// ---------- public ----------
app.get('/api/meta', (req, res) => {
  const c = store.get();
  res.json({
    rev: store.getRev(),
    courses: c.courses.map((x) => x.name),
    categories: c.categories.map((x) => x.name),
    levels: c.levels.map((x) => x.name),
    modes: c.modes.map((x) => ({ name: x.name, note: x.note || '' })),
    hoursPerDay: c.hoursPerDay.map((x) => x.hours),
    daysOptions: c.daysOptions,
    vatPercent: Math.round(c.settings.vatRate * 10000) / 100,
  });
});

// Customers only ever get the fee, never the rate, payout or add-on breakdown.
app.post('/api/quote', (req, res) => {
  const b = req.body || {};
  const r = quote(store.get(), {
    course: b.course, category: b.category, level: b.level, mode: b.mode,
    durationMode: b.durationMode, days: b.days, hoursPerDay: b.hoursPerDay, totalHours: b.totalHours,
  });
  const out = { ok: r.ok, missing: r.missing, message: r.message, hours: r.hours, durationMode: r.durationMode };
  if (r.ok) Object.assign(out, { courseFee: r.courseFee, vat: r.vat, total: r.total, summary: r.summary });
  res.json(out);
});

// Shared engine for the admin formula tester (contains no pricing data)
app.get('/core.js', (req, res) => res.type('js').sendFile(path.join(__dirname, 'lib', 'core.js')));

app.get('/health', (req, res) => res.json({ ok: true, persistent: store.isPersistent() }));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large.' });
  if (err instanceof SyntaxError) return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => console.log(`Course calculator on :${PORT}  (data: ${store.DATA_DIR}, persistent: ${store.isPersistent()})`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
module.exports = app;
