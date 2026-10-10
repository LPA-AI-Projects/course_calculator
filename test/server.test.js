'use strict';
// End-to-end checks against the real server process: startup, API, admin auth, persistence, shutdown.
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3917;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-calc-'));
const ADMIN = '4321';

function start(env = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, ADMIN_CODE: ADMIN, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  child.log = () => log;
  return child;
}
async function ready() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/health'); if (r.ok) return r.json(); } catch (e) { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('server did not start');
}
const call = async (method, url, body, token) => {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (e) { /* not json */ }
  return { status: r.status, json };
};
const stop = (child) => new Promise((res) => { child.on('exit', (code, sig) => res({ code, sig })); child.kill('SIGTERM'); });

(async () => {
  let child = start();
  try {
    const health = await ready();
    assert.strictEqual(health.ok, true); assert.strictEqual(health.persistent, true);

    // static + shared files
    for (const p of ['/', '/ui.js', '/style.css', '/core.js', '/adapter-server.js', '/logo.png', '/favicon.png', '/vendor/xlsx.full.min.js']) {
      const r = await fetch(BASE + p); assert.strictEqual(r.status, 200, p + ' should be served'); await r.arrayBuffer();
    }
    const html = await (await fetch(BASE + '/')).text();
    assert(/logo\.png/.test(html) && /core\.js/.test(html) && /ui\.js/.test(html), 'index wires up logo and scripts');

    // public meta + quote
    const meta = (await call('GET', '/api/meta')).json;
    assert(meta.courses.length > 1000); assert(!('regions' in meta));
    assert(meta.categories.length >= 10 && meta.categories.every((c) => typeof c === 'string'), 'meta lists category names only');
    assert.deepStrictEqual(meta.modes.map((m) => m.name), ['Online', 'Classroom']);
    assert(/weekend/i.test(meta.modes[1].note));
    const input = { course: 'Microsoft Excel', level: 'Intermediate', mode: 'Classroom', durationMode: 'days', days: 2, hoursPerDay: 4 };
    const q = (await call('POST', '/api/quote', input)).json;
    assert(q.ok && q.total > q.courseFee && q.hours === 8);
    for (const leaked of ['rate', 'trainerPayout', 'steps', 'vars', 'category', 'markup', 'factors', 'cab']) assert(!(leaked in q), `public quote must not expose ${leaked}`);
    const byCat = (await call('POST', '/api/quote', { ...input, course: '', category: meta.categories[0] })).json;
    assert(byCat.ok && byCat.total > 0, 'category quote works for unlisted courses');
    for (const leaked of ['rate', 'steps', 'category']) assert(!(leaked in byCat), `category quote must not expose ${leaked}`);
    const bad = (await call('POST', '/api/quote', { ...input, course: 'Nope' })).json;
    assert(!bad.ok && bad.message);
    assert.strictEqual((await call('POST', '/api/quote', { ...input, mode: 'Onsite' })).json.ok, false);
    const hrs = (await call('POST', '/api/quote', { ...input, durationMode: 'hours', totalHours: 6, days: 90 })).json;
    assert(hrs.ok && hrs.hours === 6);
    assert.strictEqual((await call('POST', '/api/quote', {})).status, 200);
    assert.strictEqual((await fetch(BASE + '/api/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })).status, 400);

    // admin is protected
    for (const [m, u] of [['GET', '/api/admin/config'], ['PUT', '/api/admin/config'], ['POST', '/api/admin/reset'], ['POST', '/api/admin/logout']]) assert.strictEqual((await call(m, u, {})).status, 401, u);
    assert.strictEqual((await call('GET', '/api/admin/config', null, 'made-up')).status, 401);

    // login: the default code does not work when ADMIN_CODE is set; wrong codes are limited; right code works
    const wrong = await call('POST', '/api/admin/login', { code: '8866' });
    assert.strictEqual(wrong.status, 401);
    const login = await call('POST', '/api/admin/login', { code: ADMIN });
    assert.strictEqual(login.status, 200); const token = login.json.token; assert(token && token.length >= 32);

    // read, edit, save
    const cfg = (await call('GET', '/api/admin/config', null, token)).json;
    assert.strictEqual(cfg.version, 3); assert(!('regions' in cfg));
    const edited = JSON.parse(JSON.stringify(cfg));
    edited.courses.push({ name: 'Server Test – Manual Course', category: '', basis: 'Admin added', onlineRate: 300, offlineRate: 400 });
    edited.courses.find((c) => c.name === 'Microsoft Excel').offlineRate = 999;
    edited.modes.find((m) => m.name === 'Classroom').note = 'Weekdays only, no weekend batches.';
    const put = await call('PUT', '/api/admin/config', edited, token);
    assert.strictEqual(put.status, 200, JSON.stringify(put.json));
    const mq = (await call('POST', '/api/quote', { ...input, course: 'Server Test – Manual Course' })).json;
    assert(mq.ok, mq.message);
    const q2 = (await call('POST', '/api/quote', input)).json;
    assert(q2.total > q.total, 'own offline rate raises the quote');
    assert.strictEqual((await call('GET', '/api/meta')).json.modes[1].note, 'Weekdays only, no weekend batches.');

    // invalid saves are rejected and change nothing
    const broken = JSON.parse(JSON.stringify(edited)); broken.formulas.find((f) => f.id === 'vat').expr = 'courseFee * nothing';
    const r400 = await call('PUT', '/api/admin/config', broken, token);
    assert.strictEqual(r400.status, 400); assert(r400.json.details.length);
    const noCat = JSON.parse(JSON.stringify(edited)); noCat.courses.push({ name: 'No Rates', category: '', basis: 'x' });
    assert.strictEqual((await call('PUT', '/api/admin/config', noCat, token)).status, 400);
    assert.strictEqual((await call('POST', '/api/quote', input)).json.total, q2.total);

    // persisted to disk with the right version
    const onDisk = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8'));
    assert.strictEqual(onDisk.version, 3); assert(onDisk.courses.some((c) => c.name === 'Server Test – Manual Course'));

    // brute force protection: 5 wrong codes lock the IP out, even for the right code
    for (let i = 0; i < 5; i++) assert.strictEqual((await call('POST', '/api/admin/login', { code: 'bad' + i })).status, 401);
    assert.strictEqual((await call('POST', '/api/admin/login', { code: ADMIN })).status, 429);

    // sign out kills the session
    assert.strictEqual((await call('POST', '/api/admin/logout', {}, token)).status, 200);
    assert.strictEqual((await call('GET', '/api/admin/config', null, token)).status, 401);

    // clean shutdown, then a restart keeps the edits
    const ex = await stop(child);
    assert.strictEqual(ex.code, 0, 'SIGTERM should exit cleanly');
    child = start(); await ready();
    const again = (await call('POST', '/api/quote', { ...input, course: 'Server Test – Manual Course' })).json;
    assert(again.ok, 'edits survive a restart');

    // reset restores defaults
    const t2 = (await call('POST', '/api/admin/login', { code: ADMIN })).json.token;
    assert.strictEqual((await call('POST', '/api/admin/reset', {}, t2)).status, 200);
    assert.strictEqual((await call('POST', '/api/quote', { ...input, course: 'Server Test – Manual Course' })).json.ok, false);
    await stop(child);

    // an old config file is backed up, not trusted
    fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify({ version: 2, regions: [] }));
    child = start(); await ready();
    assert((await call('GET', '/api/meta')).json.courses.length > 1000, 'old config replaced by defaults');
    assert(fs.readdirSync(DATA).some((f) => f.startsWith('config.bak-')), 'old config kept as a backup');
    await stop(child);

    // default admin code is 8866 when ADMIN_CODE is not set
    child = start({ ADMIN_CODE: '' }); await ready();
    assert.strictEqual((await call('POST', '/api/admin/login', { code: '8866' })).status, 200);
    await stop(child);

    console.log('server tests: ok');
  } catch (e) {
    console.error(e); console.error(child.log && child.log()); child.kill('SIGKILL'); process.exitCode = 1;
  } finally { fs.rmSync(DATA, { recursive: true, force: true }); }
})();
