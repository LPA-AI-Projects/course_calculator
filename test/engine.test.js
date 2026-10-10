'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Core = require('../lib/core');
const { quote, validateConfig, validateFormulas, compile, run } = Core;

const seedRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/seed.json'), 'utf8'));
const seed = validateConfig(seedRaw).config;
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'));
const near = (a, b, label, tol = 0.011) => assert(Math.abs(a - b) < tol, `${label}: got ${a}, expected ${b}`);
const ev = (expr, vars = {}) => run(compile(expr).ast, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v])));

// 1. Expression language
assert.strictEqual(ev('2 + 3 * 4'), 14);
assert.strictEqual(ev('(2 + 3) * 4'), 20);
assert.strictEqual(ev('2 ^ 3 ^ 2'), 512);
assert.strictEqual(ev('-2 ^ 2'), -4);
assert.strictEqual(ev('10 - 4 - 3'), 3);
assert.strictEqual(ev('MROUND(2.5, 1)'), 3);
assert.strictEqual(ev('MROUND(7.5, 5)'), 10);
assert.strictEqual(ev('MIN(3, 1, 2) + MAX(1, 9)'), 10);
assert.strictEqual(ev('IF(hours > 4, 1, 2)', { hours: 5 }), 1);
assert.strictEqual(ev('IF(hours > 4, 1, 2)', { hours: 4 }), 2);
assert.strictEqual(ev('a * b', { a: 3, b: 4 }), 12);
for (const bad of ['2 +', 'foo(1)', '(1', 'x', 'process.exit()', '1; 2', 'constructor']) {
  assert.throws(() => ev(bad, {}), `"${bad}" must be rejected`);
}
console.log('expression language: ok');

// 2. Differential test against Excel (LibreOffice-recalculated) with the old compound formula
const compound = JSON.parse(JSON.stringify(seed.formulas)).filter((f) => !['baseFee', 'levelAddon', 'modeAddon'].includes(f.id));
compound.find((f) => f.id === 'courseFee').expr = 'MROUND(trainerPayout * markup * levelFactor * modeFactor, roundTo)';
let compared = 0;
for (const [i, f] of fixtures.entries()) {
  if (f.input.overrideHours != null) continue; // hours-mode uses the new tier rule, not comparable
  const cfg = validateConfig({
    ...seedRaw, settings: { multiplier: f.config.settings.multiplier, vatRate: f.config.settings.vatRate, roundTo: f.config.settings.roundTo },
    categories: f.config.categories, hoursPerDay: f.config.hoursPerDay,
    levels: f.config.levels, modes: f.config.modes, formulas: compound,
  });
  assert.deepStrictEqual(cfg.errors, [], `fixture ${i} config`);
  const r = quote(cfg.config, { course: f.input.course, level: f.input.level, mode: f.input.mode, durationMode: 'days', days: f.input.days, hoursPerDay: f.input.hoursPerDay });
  assert(r.ok, `fixture ${i}: ${r.message}`);
  assert.strictEqual(r.category, f.expected.category, `fixture ${i} category`);
  near(r.rate, f.expected.rate, `fixture ${i} rate`);
  near(r.hours, f.expected.hours, `fixture ${i} hours`);
  assert.strictEqual(r.courseFee, f.expected.courseFee, `fixture ${i} courseFee (${r.courseFee} vs ${f.expected.courseFee})`);
  near(r.vat, f.expected.vat, `fixture ${i} vat`);
  near(r.total, f.expected.total, `fixture ${i} total`);
  compared++;
}
console.log(`differential vs Excel: ${compared} cases match (${fixtures.length - compared} hours-override cases skipped)`);

// 3. Pricing rules
const course = seed.courses.find((c) => c.name === 'Microsoft Excel').name;
const base = { course, level: 'Beginner', mode: 'Classroom', durationMode: 'days', days: 2, hoursPerDay: 4 };
const q0 = quote(seed, base);
assert(q0.ok, q0.message);
const step = (q, id) => q.steps.find((s) => s.id === id).value;
// trainer payout is decided from hours first
near(q0.hours, 8, 'hours'); near(q0.durationFactor, 1.2, 'duration factor 4h/day');
near(q0.trainerPayout, q0.rate * 8 * 1.2, 'payout = rate x hours x duration factor');
near(step(q0, 'baseFee'), q0.trainerPayout * 2.8, 'base fee');
// levels are add-ons: Beginner 1x, Intermediate 1.2x, Advanced 1.4x of the base
const qi = quote(seed, { ...base, level: 'Intermediate' }), qa = quote(seed, { ...base, level: 'Advanced' });
near(step(qi, 'levelAddon'), step(q0, 'baseFee') * 0.2, 'intermediate add-on');
near(step(qa, 'levelAddon'), step(q0, 'baseFee') * 0.4, 'advanced add-on');
near(qi.courseFee, Math.round(q0.trainerPayout * 2.8 * 1.2), 'intermediate = 1.2x', 1);
near(qa.courseFee, Math.round(q0.trainerPayout * 2.8 * 1.4), 'advanced = 1.4x', 1);
// no regions, no cab, no onsite
assert(!('regions' in seed), 'regions are gone');
assert(!q0.steps.some((s) => /travel|cab/i.test(s.id)), 'no travel step');
assert(!seed.modes.some((m) => /onsite/i.test(m.name)), 'onsite removed');
assert.deepStrictEqual(seed.modes.map((m) => m.name), ['Online', 'Classroom']);
assert(/weekend/i.test(seed.modes.find((m) => m.name === 'Classroom').note), 'classroom note mentions weekends');
assert.strictEqual(quote(seed, { ...base, mode: 'Onsite' }).ok, false, 'onsite no longer selectable');
// offline rate card for Classroom, online for Online
const qo = quote(seed, { ...base, mode: 'Online' });
assert(qo.ok && qo.rate !== q0.rate, 'online and classroom use different rate cards');
// duration factors: 2h/day 1.5x, 4h/day 1.2x, 8h/day 1x
for (const [hpd, f] of [[2, 1.5], [4, 1.2], [8, 1]]) near(quote(seed, { ...base, hoursPerDay: hpd }).durationFactor, f, `${hpd}h/day factor`);
// hours mode ignores days entirely
const h1 = quote(seed, { ...base, durationMode: 'hours', totalHours: 6, days: 1, hoursPerDay: 8 });
const h2 = quote(seed, { ...base, durationMode: 'hours', totalHours: 6, days: 90, hoursPerDay: 2 });
assert(h1.ok && h1.total === h2.total && h1.hours === 6, 'days must not matter when hours are given');
// days mode ignores total hours
const d1 = quote(seed, { ...base, totalHours: 999 });
assert.strictEqual(d1.total, q0.total, 'total hours must not matter in days mode');
assert(!quote(seed, { ...base, durationMode: 'hours', totalHours: 0 }).ok, 'zero hours rejected');
near(q0.vat, q0.courseFee * 0.05, 'vat'); near(q0.total, q0.courseFee * 1.05, 'total');
for (const [k, v] of [['course', ''], ['course', 'Nope'], ['level', null], ['mode', ''], ['days', null], ['hoursPerDay', null]]) {
  const r = quote(seed, { ...base, [k]: v });
  assert(!r.ok && r.message, `blank ${k} must not produce a price`);
}
console.log('pricing rules: ok');

// 3b. Per-course rates and the "None" category
const withCourses = (extra) => validateConfig({ ...seedRaw, courses: [...seedRaw.courses, ...extra] });
const cat = seed.categories.find((c) => c.name === seed.courses.find((c2) => c2.name === course).category);
const catOnline = (cat.onlineLow + cat.onlineHigh) / 2, catOffline = (cat.offlineLow + cat.offlineHigh) / 2;
near(qo.rate, catOnline, 'online uses the category online average'); near(q0.rate, catOffline, 'classroom uses the offline average');
// own rate overrides the category
const own = withCourses([{ name: 'Own Rate Course', category: cat.name, basis: 'x', onlineRate: 500, offlineRate: null }]);
assert.deepStrictEqual(own.errors, []);
const qOwn = (m) => quote(own.config, { ...base, course: 'Own Rate Course', mode: m });
near(qOwn('Online').rate, 500, 'own online rate wins'); near(qOwn('Classroom').rate, catOffline, 'missing own rate falls back to the category');
// no category: manual rates are required and used
assert(withCourses([{ name: 'Manual A', category: '', basis: 'x' }]).errors.length > 0, 'none without rates rejected');
assert(withCourses([{ name: 'Manual A', category: '', basis: 'x', onlineRate: 100 }]).errors.length > 0, 'none with one rate rejected');
const man = withCourses([{ name: 'Manual A', category: '', basis: 'x', onlineRate: 260, offlineRate: 320 }]);
assert.deepStrictEqual(man.errors, []);
const qm = quote(man.config, { ...base, course: 'Manual A', mode: 'Classroom' });
assert(qm.ok && qm.rate === 320 && qm.category === 'Manual pricing', 'manual course priced from its own rate');
near(quote(man.config, { ...base, course: 'Manual A', mode: 'Online' }).rate, 260, 'manual online rate');
assert(withCourses([{ name: 'Bad Cat', category: 'Nope', basis: 'x' }]).errors.length > 0, 'unknown category rejected');
assert(withCourses([{ name: 'Neg', category: cat.name, basis: 'x', onlineRate: -5 }]).errors.length > 0, 'negative rate rejected');
// course not listed: priced from the chosen category
const cq = quote(seed, { ...base, course: '', category: cat.name });
assert(cq.ok, cq.message); near(cq.rate, catOffline, 'category quote uses the category rate card');
assert(/Other course \(/.test(cq.summary) && cq.category === cat.name, 'summary names the category');
assert.strictEqual(cq.total, quote(seed, { ...base, course }).total, 'same category, same price as a listed course in it');
assert(!quote(seed, { ...base, course: '', category: 'Nope' }).ok, 'unknown category rejected');
assert(!quote(seed, { ...base, course: '', category: '' }).ok, 'no course and no category rejected');
assert.strictEqual(quote(seed, { ...base, course, category: 'Marketing & Growth' }).total, q0.total, 'a listed course wins over a stray category');
console.log('per-course rates: ok');

// 4. Custom formulas
const custom = JSON.parse(JSON.stringify(seedRaw));
custom.formulas.find((f) => f.id === 'levelAddon').expr = 'baseFee * (levelFactor - 1) * 2';
const cc = validateConfig(custom);
assert.deepStrictEqual(cc.errors, []);
near(step(quote(cc.config, { ...base, level: 'Advanced' }), 'levelAddon'), step(q0, 'baseFee') * 0.8, 'edited formula takes effect');
const broken = JSON.parse(JSON.stringify(seedRaw));
broken.formulas.find((f) => f.id === 'vat').expr = 'courseFee * unknownVar';
assert(validateConfig(broken).errors.some((e) => /unknownVar|vat/i.test(e)), 'unknown variable rejected');
broken.formulas = broken.formulas.filter((f) => f.id !== 'total');
assert(validateConfig(broken).errors.some((e) => /total/.test(e)), 'required step missing rejected');
const circ = JSON.parse(JSON.stringify(seedRaw));
circ.formulas.find((f) => f.id === 'trainerPayout').expr = 'courseFee * 2';
assert(validateConfig(circ).errors.length > 0, 'a step cannot use a later step');
const inf = JSON.parse(JSON.stringify(seedRaw));
inf.formulas.find((f) => f.id === 'vat').expr = 'courseFee / 0';
const qinf = quote(validateConfig(inf).config, base);
assert(!qinf.ok, 'a formula that divides by zero must not produce a price');
const oldCab = JSON.parse(JSON.stringify(seedRaw));
oldCab.formulas.find((f) => f.id === 'courseFee').expr = 'MROUND(baseFee + cab, roundTo)';
assert(validateConfig(oldCab).errors.length > 0, 'cab no longer exists as a variable');
console.log('custom formulas: ok');

// 5. Validation
assert.deepStrictEqual(validateConfig(seedRaw).errors, []);
const bad = JSON.parse(JSON.stringify(seedRaw));
bad.courses[0].category = 'Does not exist'; bad.settings.roundTo = 0; bad.categories[0].onlineLow = 999;
assert(validateConfig(bad).errors.length >= 3, 'validation catches bad config');
console.log('validation: ok');
console.log('ALL TESTS PASSED');
