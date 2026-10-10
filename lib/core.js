/* Core: formula engine, pricing pipeline, config validation. Runs in Node and in the browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ================= expression language ================= */
  const FUNCS = {
    ROUND: (x, n = 0) => { const f = Math.pow(10, n); return (Math.sign(x) * Math.floor(Math.abs(x) * f + 0.5 + 1e-9)) / f; },
    MROUND: (x, m) => (m > 0 ? Number((Math.sign(x) * Math.floor(Math.abs(x / m) + 0.5 + 1e-9) * m).toFixed(6)) : NaN),
    CEIL: (x, m = 1) => Math.ceil(x / m - 1e-9) * m,
    FLOOR: (x, m = 1) => Math.floor(x / m + 1e-9) * m,
    ABS: (x) => Math.abs(x),
    MIN: (...a) => Math.min(...a),
    MAX: (...a) => Math.max(...a),
    IF: (c, a, b) => (c ? a : b),
  };
  const FUNC_DOCS = [
    ['ROUND(x, n)', 'Round x to n decimals'],
    ['MROUND(x, m)', 'Round x to the nearest multiple of m'],
    ['CEIL(x, m)', 'Round up to a multiple of m (default 1)'],
    ['FLOOR(x, m)', 'Round down to a multiple of m (default 1)'],
    ['MIN(a, b, …)', 'Smallest value'],
    ['MAX(a, b, …)', 'Largest value'],
    ['ABS(x)', 'Absolute value'],
    ['IF(test, a, b)', 'a when test is true, otherwise b. Tests: < > <= >= = !='],
  ];

  const TOKEN = /\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|<>|[-+*\/^(),<>=]))/y;

  function tokenize(src) {
    const out = [];
    TOKEN.lastIndex = 0;
    let pos = 0;
    while (pos < src.length) {
      if (/^\s*$/.test(src.slice(pos))) break;
      TOKEN.lastIndex = pos;
      const m = TOKEN.exec(src);
      if (!m) throw new Error(`Unexpected character "${src.slice(pos).trim()[0]}"`);
      if (m[1] !== undefined) out.push({ t: 'num', v: parseFloat(m[1]) });
      else if (m[2] !== undefined) out.push({ t: 'id', v: m[2] });
      else out.push({ t: 'op', v: m[3] });
      pos = TOKEN.lastIndex;
    }
    return out;
  }

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const compileCache = new Map();
  function compile(src) {
    src = String(src || '').trim();
    if (compileCache.has(src)) return compileCache.get(src);
    if (!src) throw new Error('Formula is empty');
    if (src.length > 400) throw new Error('Formula is too long');
    const toks = tokenize(src);
    let i = 0;
    const ids = new Set();
    const peek = () => toks[i];
    const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
    const eat = (v) => { if (!isOp(v)) throw new Error(`Expected "${v}"`); i++; };

    function cmp() {
      let a = add();
      while (peek() && peek().t === 'op' && ['<', '>', '<=', '>=', '==', '=', '!=', '<>'].includes(peek().v)) {
        const op = toks[i++].v; a = { k: 'bin', op: op === '=' ? '==' : op === '<>' ? '!=' : op, a, b: add() };
      }
      return a;
    }
    function add() {
      let a = mul();
      while (isOp('+') || isOp('-')) { const op = toks[i++].v; a = { k: 'bin', op, a, b: mul() }; }
      return a;
    }
    function mul() {
      let a = unary();
      while (isOp('*') || isOp('/')) { const op = toks[i++].v; a = { k: 'bin', op, a, b: unary() }; }
      return a;
    }
    function unary() {
      if (isOp('-')) { i++; return { k: 'neg', a: unary() }; }
      if (isOp('+')) { i++; return unary(); }
      return pow();
    }
    function pow() {
      const a = primary();
      if (isOp('^')) { i++; return { k: 'bin', op: '^', a, b: unary() }; }
      return a;
    }
    function primary() {
      const t = toks[i++];
      if (!t) throw new Error('Formula ends unexpectedly');
      if (t.t === 'num') return { k: 'num', v: t.v };
      if (t.t === 'id') {
        if (isOp('(')) {
          const name = t.v.toUpperCase();
          if (!Object.prototype.hasOwnProperty.call(FUNCS, name)) throw new Error(`Unknown function ${t.v}`);
          i++;
          const args = [];
          if (!isOp(')')) { args.push(cmp()); while (isOp(',')) { i++; args.push(cmp()); } }
          eat(')');
          return { k: 'call', name, args };
        }
        ids.add(t.v.toLowerCase());
        return { k: 'var', name: t.v.toLowerCase(), raw: t.v };
      }
      if (t.v === '(') { const e = cmp(); eat(')'); return e; }
      throw new Error(`Unexpected "${t.v}"`);
    }
    const ast = cmp();
    if (i < toks.length) throw new Error(`Unexpected "${toks[i].v}"`);
    const c = { ast, ids, src };
    compileCache.set(src, c);
    return c;
  }

  function run(node, env) {
    switch (node.k) {
      case 'num': return node.v;
      case 'var': { if (!Object.prototype.hasOwnProperty.call(env, node.name)) throw new Error(`Unknown name "${node.raw}"`); return env[node.name]; }
      case 'neg': return -run(node.a, env);
      case 'call': return FUNCS[node.name](...node.args.map((a) => run(a, env)));
      case 'bin': {
        const a = run(node.a, env), b = run(node.b, env);
        switch (node.op) {
          case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '^': return Math.pow(a, b);
          case '<': return +(a < b); case '>': return +(a > b); case '<=': return +(a <= b); case '>=': return +(a >= b);
          case '==': return +(a === b); case '!=': return +(a !== b);
        }
      }
    }
    throw new Error('Bad formula');
  }

  /* ================= pricing pipeline ================= */
  const BASE_VARS = [
    ['rate', 'Trainer rate per hour for the course and mode (AED)'],
    ['hours', 'Total training hours'],
    ['days', 'Number of days (0 when total hours were entered)'],
    ['sessionHours', 'Hours per day (days entered), or total hours (hours entered)'],
    ['durationFactor', 'Session-length factor, e.g. 2 hrs = 1.5, 4 hrs = 1.2'],
    ['levelFactor', 'Level multiplier (Beginner = 1, Intermediate = 1.2 …)'],
    ['modeFactor', 'Mode of training multiplier'],
    ['markup', 'Fee multiplier from Fee settings (2.8)'],
    ['vatRate', 'VAT as a fraction (0.05)'],
    ['vatPercent', 'VAT as a percentage (5)'],
    ['roundTo', 'Rounding step from Fee settings'],
  ];
  const BASE_IDS = new Set(BASE_VARS.map((v) => v[0].toLowerCase()));
  const REQUIRED_STEPS = ['trainerPayout', 'courseFee', 'vat', 'total'];
  const STAGES = [['payout', 'Trainer payout'], ['addon', 'Add-ons'], ['total', 'Fee']];

  function defaultFormulas() {
    return [
      { id: 'trainerPayout', label: 'Trainer payout', stage: 'payout', unit: 'aed', expr: 'rate * hours * durationFactor' },
      { id: 'baseFee', label: 'Base course fee (payout × {markup})', stage: 'payout', unit: 'aed', expr: 'trainerPayout * markup' },
      { id: 'levelAddon', label: 'Level add-on: {level} (×{levelFactor})', stage: 'addon', unit: 'aed', expr: 'baseFee * (levelFactor - 1)' },
      { id: 'modeAddon', label: 'Mode add-on: {mode} (×{modeFactor})', stage: 'addon', unit: 'aed', expr: 'baseFee * (modeFactor - 1)' },
      { id: 'courseFee', label: 'Course fee before VAT', stage: 'total', unit: 'aed', expr: 'MROUND(baseFee + levelAddon + modeAddon, roundTo)' },
      { id: 'vat', label: 'VAT ({vatPercent}%)', stage: 'total', unit: 'aed', expr: 'courseFee * vatRate' },
      { id: 'total', label: 'Course fee incl. VAT', stage: 'total', unit: 'aed', expr: 'courseFee + vat' },
    ];
  }
  const idxCache = new WeakMap();
  function buildIndex(cfg, fresh) {
    let idx = !fresh && idxCache.get(cfg);
    if (idx) return idx;
    idx = {
      courses: new Map(cfg.courses.map((c) => [c.name, c])),
      categories: new Map(cfg.categories.map((c) => [c.name, c])),
      modes: new Map(cfg.modes.map((m) => [m.name, m])),
      levels: new Map(cfg.levels.map((l) => [l.name, l])),
      durations: [...cfg.hoursPerDay].map((h) => ({ hours: Number(h.hours), multiplier: Number(h.multiplier) })).sort((a, b) => a.hours - b.hours),
    };
    if (!fresh) idxCache.set(cfg, idx);
    return idx;
  }

  const money = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const toNum = (v) => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  function fmt(n) {
    const d = Number.isInteger(n) ? 0 : 2;
    return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const fmtNum = (n) => (typeof n === 'number' && Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : String(n));
  const categoryRate = (cat, card) => (card === 'Online' ? (cat.onlineLow + cat.onlineHigh) / 2 : (cat.offlineLow + cat.offlineHigh) / 2);
  /* Trainer rate per hour for a course on a rate card: the course's own rate if set, otherwise its category's average. */
  function courseRate(course, card, categories) {
    const own = toNum(card === 'Online' ? course.onlineRate : course.offlineRate);
    if (own !== null) return own;
    const cat = course.category && (categories instanceof Map ? categories.get(course.category) : categories.find((c) => c.name === course.category));
    return cat ? categoryRate(cat, card) : null;
  }

  /*
   input: { course (or category when the course is not listed), level, mode, durationMode: 'days'|'hours', days, hoursPerDay, totalHours }
   Days mode: hours = days x hours-per-day.  Hours mode: hours as entered; days are not used.
  */
  function quote(cfg, input, opts) {
    const idx = buildIndex(cfg, opts && opts.fresh);
    const missing = [];
    const out = { ok: false, missing };

    let course = idx.courses.get(input.course);
    // Course not in the list: price it from a chosen category's rate card instead.
    if (!course && !input.course && input.category && idx.categories.has(input.category)) {
      course = { name: `Other course (${input.category})`, category: input.category, onlineRate: null, offlineRate: null };
    }
    if (!course) missing.push('Course'); else out.category = course.category || 'Manual pricing';
    const level = idx.levels.get(input.level); if (!level) missing.push('Level');
    const mode = idx.modes.get(input.mode); if (!mode) missing.push('Mode of training');

    const byHours = input.durationMode === 'hours';
    let hours = null, days = 0, sessionHours = null, dur = null;
    if (byHours) {
      const t = toNum(input.totalHours);
      if (t === null) missing.push('Total hours');
      else if (t <= 0) out.message = 'Total hours must be greater than 0.';
      else { hours = t; sessionHours = t; }
    } else {
      const d = toNum(input.days), hpd = toNum(input.hoursPerDay);
      if (!(d > 0)) missing.push('Number of days');
      if (hpd === null || !idx.durations.some((x) => x.hours === hpd)) missing.push('Hours per day');
      else if (d > 0) { days = d; sessionHours = hpd; hours = d * hpd; }
    }
    if (sessionHours !== null) {
      dur = idx.durations.find((x) => x.hours === sessionHours) || idx.durations.find((x) => x.hours >= sessionHours) || idx.durations[idx.durations.length - 1];
    }
    if (hours !== null) out.hours = hours;
    out.durationMode = byHours ? 'hours' : 'days';

    let rate = null;
    if (course && mode) {
      rate = courseRate(course, mode.rateCard, idx.categories);
      if (rate === null) out.message = `"${course.name}" has no ${mode.rateCard.toLowerCase()} rate. Set one in Admin → Rates.`;
    }
    if (rate !== null) out.rate = rate;
    if (dur) out.durationFactor = dur.multiplier;
    out.markup = cfg.settings.multiplier;

    if (missing.length || hours === null || rate === null || !dur) {
      if (!out.message && missing.length) out.message = 'Fill in: ' + [...new Set(missing)].join(', ');
      return out;
    }

    const env = {
      rate, hours, days, sessionhours: sessionHours, durationfactor: dur.multiplier, levelfactor: level.multiplier, modefactor: mode.multiplier,
      markup: cfg.settings.multiplier, vatrate: cfg.settings.vatRate, vatpercent: Math.round(cfg.settings.vatRate * 10000) / 100, roundto: cfg.settings.roundTo,
    };
    const names = { level: input.level, mode: input.mode, course: course.name };
    const steps = [];
    try {
      for (const f of cfg.formulas) {
        const c = compile(f.expr);
        const v = run(c.ast, env);
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`"${f.label || f.id}" did not produce a valid number`);
        env[f.id.toLowerCase()] = v;
        steps.push({ id: f.id, stage: f.stage, unit: f.unit || 'aed', value: v, label: String(f.label || f.id).replace(/\{(\w+)\}/g, (m, n) => (has(names, n) ? names[n] : has(env, n.toLowerCase()) ? fmtNum(env[n.toLowerCase()]) : m)) });
      }
    } catch (e) {
      out.message = 'Formula problem: ' + e.message;
      return out;
    }
    for (const id of REQUIRED_STEPS) if (!has(env, id.toLowerCase())) { out.message = `Formula "${id}" is missing.`; return out; }

    Object.assign(out, {
      ok: true,
      factors: { duration: dur.multiplier, level: level.multiplier, mode: mode.multiplier },
      steps: steps.map((s) => ({ ...s, value: money(s.value) })),
      trainerPayout: money(env.trainerpayout), courseFee: money(env.coursefee), vat: money(env.vat), total: money(env.total),
      vars: { ...env },
      summary: `${course.name} – ${input.level} – ${input.mode} – ${fmtNum(hours)} hrs – AED ${fmt(money(env.coursefee))} excl. VAT / AED ${fmt(money(env.total))} incl. VAT`,
    });
    return out;
  }

  /* ================= validation ================= */
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const str = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

  function validateConfig(input) {
    const errors = [];
    const e = (m) => errors.push(m);
    if (!input || typeof input !== 'object') return { errors: ['Config must be an object'] };

    const s = input.settings || {};
    const settings = { multiplier: Number(s.multiplier), vatRate: Number(s.vatRate), roundTo: Number(s.roundTo) };
    if (!(settings.multiplier > 0 && settings.multiplier <= 50)) e('Fee multiplier must be between 0 and 50.');
    if (!(settings.vatRate >= 0 && settings.vatRate <= 1)) e('VAT rate must be between 0% and 100%.');
    if (!(settings.roundTo > 0 && settings.roundTo <= 10000)) e('Rounding step must be greater than 0.');

    const uniq = (list, key, label) => {
      const seen = new Set();
      for (const x of list) {
        const k = String(x[key]).toLowerCase();
        if (!x[key]) e(`${label}: name cannot be empty.`);
        else if (seen.has(k)) e(`${label}: duplicate "${x[key]}".`);
        seen.add(k);
      }
    };
    const arr = (v) => (Array.isArray(v) ? v : []);

    const categories = arr(input.categories).map((c) => ({ name: str(c.name), onlineLow: Number(c.onlineLow), onlineHigh: Number(c.onlineHigh), offlineLow: Number(c.offlineLow), offlineHigh: Number(c.offlineHigh) }));
    uniq(categories, 'name', 'Category');
    for (const c of categories) {
      for (const f of ['onlineLow', 'onlineHigh', 'offlineLow', 'offlineHigh']) if (!(isNum(c[f]) && c[f] >= 0)) e(`Category "${c.name}": ${f} must be a number ≥ 0.`);
      if (c.onlineLow > c.onlineHigh) e(`Category "${c.name}": online low is above online high.`);
      if (c.offlineLow > c.offlineHigh) e(`Category "${c.name}": offline low is above offline high.`);
    }

    const modes = arr(input.modes).map((m) => {
      const rateCard = m.rateCard === 'Online' ? 'Online' : m.rateCard === 'Offline' ? 'Offline' : '';
      return { name: str(m.name), rateCard, multiplier: Number(m.multiplier), note: typeof m.note === 'string' ? m.note.trim().slice(0, 400) : '' };
    });
    if (!modes.length) e('At least one mode of training is required.');
    uniq(modes, 'name', 'Mode');
    for (const m of modes) {
      if (!m.rateCard) e(`Mode "${m.name}": rate card must be Online or Offline.`);
      if (!(m.multiplier > 0)) e(`Mode "${m.name}": multiplier must be greater than 0.`);
    }

    const levels = arr(input.levels).map((l) => ({ name: str(l.name), multiplier: Number(l.multiplier) }));
    if (!levels.length) e('At least one level is required.');
    uniq(levels, 'name', 'Level');
    for (const l of levels) if (!(l.multiplier > 0)) e(`Level "${l.name}": multiplier must be greater than 0.`);

    const hoursPerDay = arr(input.hoursPerDay).map((h) => ({ hours: Number(h.hours), multiplier: Number(h.multiplier) }));
    if (!hoursPerDay.length) e('At least one session-length option is required.');
    const seenH = new Set();
    for (const h of hoursPerDay) {
      if (!(h.hours > 0 && h.hours <= 24)) e('Session length must be between 0 and 24 hours.');
      if (seenH.has(h.hours)) e(`Session length: duplicate ${h.hours}.`);
      seenH.add(h.hours);
      if (!(h.multiplier > 0)) e(`Session length ${h.hours}: factor must be greater than 0.`);
    }
    hoursPerDay.sort((a, b) => a.hours - b.hours);

    const daysOptions = [...new Set(arr(input.daysOptions).map(Number))];
    if (!daysOptions.length) e('At least one "number of days" option is required.');
    for (const d of daysOptions) if (!(Number.isInteger(d) && d > 0 && d <= 1000)) e(`Days option "${d}" must be a whole number between 1 and 1000.`);
    daysOptions.sort((a, b) => a - b);

    const formulas = (input.formulas === undefined ? defaultFormulas() : arr(input.formulas)).map((f) => ({
      id: str(f.id), label: str(f.label), stage: ['payout', 'addon', 'total'].includes(f.stage) ? f.stage : 'addon',
      unit: ['aed', 'x', 'num'].includes(f.unit) ? f.unit : 'aed', expr: String(f.expr === undefined ? '' : f.expr).trim(),
    }));
    errors.push(...validateFormulas(formulas, settings));

    const catNames = new Set(categories.map((c) => c.name));
    const rateOf = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    const courses = arr(input.courses).map((c) => ({ name: str(c.name), category: str(c.category), basis: str(c.basis) || 'Admin added', onlineRate: rateOf(c.onlineRate), offlineRate: rateOf(c.offlineRate) }));
    if (courses.length > 20000) e('Too many courses (max 20,000).');
    const seenC = new Set();
    let courseErrs = 0;
    for (const c of courses) {
      const k = c.name.toLowerCase();
      let msg = null;
      const bad = (v) => v !== null && !(isNum(v) && v >= 0 && v <= 100000);
      if (!c.name) msg = 'A course has an empty name.';
      else if (c.name.length > 300) msg = `Course name too long: "${c.name.slice(0, 40)}…"`;
      else if (seenC.has(k)) msg = `Duplicate course: "${c.name}"`;
      else if (c.category && !catNames.has(c.category)) msg = `Course "${c.name}" uses unknown category "${c.category}".`;
      else if (bad(c.onlineRate) || bad(c.offlineRate)) msg = `Course "${c.name}": rates must be numbers between 0 and 100000.`;
      else if (!c.category && !(c.onlineRate > 0 && c.offlineRate > 0)) msg = `Course "${c.name}" has no category, so it needs both an online and an offline rate.`;
      seenC.add(k);
      if (msg && courseErrs++ < 15) e(msg);
    }
    if (courseErrs > 15) e(`…and ${courseErrs - 15} more course problems.`);
    courses.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

    return { errors, config: { version: 3, settings, categories, modes, levels, hoursPerDay, daysOptions, formulas, courses } };
  }

  function validateFormulas(formulas, settings) {
    const errors = [];
    if (!formulas.length) return ['At least one formula step is required.'];
    const seen = new Set(BASE_IDS);
    const env = { rate: 150, hours: 8, days: 2, sessionhours: 4, durationfactor: 1.2, levelfactor: 1.2, modefactor: 1, markup: settings.multiplier || 2.8, vatrate: settings.vatRate || 0.05, vatpercent: (settings.vatRate || 0.05) * 100, roundto: settings.roundTo || 1 };
    const have = new Set();
    for (const f of formulas) {
      const tag = `Formula "${f.id || '(no id)'}"`;
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(f.id)) { errors.push(`${tag}: id must start with a letter and use only letters, digits and _.`); continue; }
      const k = f.id.toLowerCase();
      if (seen.has(k)) { errors.push(`${tag}: id is already used (by a built-in variable or another step).`); continue; }
      if (FUNCS[f.id.toUpperCase()]) { errors.push(`${tag}: id clashes with a function name.`); continue; }
      seen.add(k);
      try {
        const c = compile(f.expr);
        for (const id of c.ids) if (!has(env, id)) throw new Error(`"${id}" is not available here (only built-in variables and steps above this one)`);
        const v = run(c.ast, env);
        if (!Number.isFinite(v)) throw new Error('does not produce a valid number (check for division by zero)');
        env[k] = v; have.add(f.id);
      } catch (err) { errors.push(`${tag}: ${err.message}.`); }
    }
    for (const r of REQUIRED_STEPS) if (!formulas.some((f) => f.id === r)) errors.push(`Required formula "${r}" is missing.`);
    return errors;
  }

  return { quote, validateConfig, validateFormulas, compile, run, defaultFormulas, courseRate, categoryRate, BASE_VARS, FUNC_DOCS, REQUIRED_STEPS, STAGES, fmt, fmtNum, money };
});
