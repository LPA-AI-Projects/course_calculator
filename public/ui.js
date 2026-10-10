/* Course Fee Calculator UI. Talks to a backend adapter (window.Backend): server API on Railway, or in-page storage inside Claude. */
(function () {
  'use strict';
  const B = window.Backend, Core = window.Core;
  const $top = document.getElementById('top'), $app = document.getElementById('app'), $foot = document.getElementById('foot');
  const $modal = document.getElementById('modalRoot'), $toast = document.getElementById('toast');

  const aed = (n) => 'AED ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 });
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  function fill(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false)); }

  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M9 15l2 2 4-4"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  function icon(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ico'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[name];
    return s;
  }
  const logo = (cls) => h('img', { class: 'logo ' + (cls || ''), src: B.logo, alt: 'Learners Point' });

  let toastTimer;
  function toast(msg) {
    $toast.textContent = msg; $toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $toast.classList.remove('show'), 2800);
  }

  /* In-page dialogs (confirm()/prompt() are unavailable in some hosts). */
  function ask({ title, body, input, ok = 'OK', danger = false, cancel = 'Cancel' }) {
    return new Promise((resolve) => {
      const field = input ? h('input', { type: 'text', 'aria-label': input, placeholder: input }) : null;
      const done = (v) => { fill($modal); resolve(v); };
      const okBtn = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'submit' }, ok);
      const form = h('form', { class: 'modal', onsubmit: (e) => { e.preventDefault(); done(field ? field.value : true); } },
        logo(), h('h3', {}, title), body ? h('p', {}, body) : null, field,
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => done(field ? null : false) }, cancel), okBtn));
      const scrim = h('div', { class: 'scrim', onmousedown: (e) => { if (e.target === scrim) done(field ? null : false); } }, form);
      scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(field ? null : false); });
      fill($modal, scrim);
      (field || okBtn).focus();
    });
  }

  /* ---------------- shell ---------------- */
  let view = 'calc', admin = null, meta = null;

  function renderShell() {
    fill($top, h('div', { class: 'top-in' },
      h('div', { class: 'brand' }, logo(), h('span', { class: 'sep' }), h('span', { class: 'prod' }, 'Course Fee Calculator')),
      h('nav', { class: 'nav', 'aria-label': 'Main' },
        h('button', { class: 'navbtn', 'aria-current': view === 'calc' ? 'page' : null, onclick: () => go('calc') }, icon('calc'), 'Calculator'),
        h('button', { class: 'navbtn', 'aria-current': view === 'admin' ? 'page' : null, onclick: () => go('admin') }, icon('lock'), 'Admin'))));
    fill($foot, logo(), h('span', {}, 'Learners Point Academy · Prices in AED'));
  }
  async function go(v) {
    if (v === view) return;
    if (view === 'admin' && admin && admin.dirty() && !(await ask({ title: 'Leave without saving?', body: 'Your unsaved changes will be lost.', ok: 'Leave', danger: true }))) return;
    if (v === 'admin' && !B.isAdmin()) return openLogin();
    view = v; renderShell(); v === 'admin' ? renderAdmin() : renderCalc();
  }
  function openLogin() {
    const err = h('div', { class: 'err', role: 'alert' });
    const code = h('input', { class: 'code', id: 'adminCode', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '32', 'aria-label': 'Admin code', placeholder: '••••' });
    const close = () => fill($modal);
    const go2 = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
    const f = h('form', { class: 'modal', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; go2.disabled = true;
      try { await B.login(code.value); close(); view = 'admin'; renderShell(); renderAdmin(); }
      catch (ex) { err.textContent = ex.message; code.select(); }
      go2.disabled = false;
    } }, logo(), h('h3', {}, 'Admin sign-in'), h('p', {}, 'Enter the admin code to manage rates, formulas and courses.'), code, err,
      h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), go2));
    const scrim = h('div', { class: 'scrim', onmousedown: (e) => { if (e.target === scrim) close(); } }, f);
    scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    fill($modal, scrim); code.focus();
  }

  /* ======================= CALCULATOR ======================= */
  const form = { course: '', category: '', catOpen: false, level: 'Intermediate', mode: 'Classroom', durationMode: 'days', days: '1', hoursPerDay: '4', totalHours: '' };
  try { Object.assign(form, JSON.parse(sessionStorage.getItem('calcForm3') || '{}')); } catch (e) {}
  const save = () => { try { sessionStorage.setItem('calcForm3', JSON.stringify(form)); } catch (e) {} };

  async function renderCalc() {
    if (!meta) fill($app, h('div', { class: 'loading' }, logo(), h('span', {}, 'Loading calculator…')));
    try { meta = await B.meta(); } catch (e) { fill($app, h('div', { class: 'errs' }, 'Could not load calculator data. ' + e.message)); return; }
    fixForm();
    fill($app,
      h('div', { class: 'page-title rise' }, h('h1', {}, 'Course fee calculator'), h('p', {}, 'Pick a course and how it will be delivered. Your fee updates as you go.')),
      h('div', { class: 'work' }, h('div', { class: 'card rise', id: 'builder', style: '--d:60ms' }), h('div', { class: 'quote rise', style: '--d:140ms' }, h('div', { class: 'card', id: 'result' }))));
    drawInputs(); quoteNow();
  }
  function fixForm() {
    const modes = meta.modes.map((m) => m.name);
    if (!meta.levels.includes(form.level)) form.level = meta.levels[0];
    if (!modes.includes(form.mode)) form.mode = modes[0];
    if (!meta.daysOptions.map(String).includes(String(form.days))) form.days = String(meta.daysOptions[0]);
    if (!meta.hoursPerDay.map(String).includes(String(form.hoursPerDay))) form.hoursPerDay = String(meta.hoursPerDay[0]);
    if (form.course && !meta.courses.includes(form.course)) form.course = '';
    if (form.category && !(meta.categories || []).includes(form.category)) form.category = '';
    if (form.course) form.category = '';
  }
  const modeInfo = () => meta.modes.find((m) => m.name === form.mode);
  function update(k, v) { form[k] = v; save(); quoteNow(); }

  function modeNote() {
    const m = modeInfo();
    return m && m.note ? h('div', { class: 'callout', role: 'note', key: m.name }, h('span', { class: 'ci' }, icon('cal')), h('div', {}, h('b', {}, 'Good to know'), h('p', {}, m.note))) : null;
  }

  function drawInputs() {
    const el = document.getElementById('builder'); if (!el) return;
    const hoursNote = h('p', { class: 'note', id: 'hoursNote' });
    const paintNote = () => { const t = Number(form.days) * Number(form.hoursPerDay); hoursNote.textContent = `${num(form.days)} day${Number(form.days) === 1 ? '' : 's'} × ${num(form.hoursPerDay)} hrs = ${num(t)} training hours`; };
    paintNote();
    const noteSlot = h('div', { class: 'noteslot' }, modeNote());
    const helpSlot = h('div', { class: 'cathelp' });
    let miss = null;
    const drawHelp = () => {
      const open = form.catOpen || !!form.category || !!miss;
      fill(helpSlot,
        miss ? h('div', { class: 'callout info', role: 'status' }, h('span', { class: 'ci' }, icon('search')),
          h('div', {}, h('b', {}, 'We couldn’t find that course'), h('p', {}, `“${miss}” isn’t on our list. Choose the category that fits it best below and we’ll quote from that.`))) : null,
        open
          ? h('div', { class: 'cats' }, h('span', { class: 'lbl' }, 'Not listed? Choose a category instead'),
            h('div', { class: 'chips', role: 'group', 'aria-label': 'Course category' }, (meta.categories || []).map((c) => h('button', { type: 'button', class: 'cchip', 'aria-pressed': String(form.category === c && !form.course), onclick: () => {
              form.course = ''; form.category = c; form.catOpen = true; miss = null; save(); combo.sync(); drawHelp(); quoteNow();
            } }, c))),
            form.category ? h('p', { class: 'note' }, `Quoted from the ${form.category} category. Send our team the exact course name to confirm the final price.`) : null)
          : h('button', { class: 'linkbtn', type: 'button', onclick: () => { form.catOpen = true; save(); drawHelp(); } }, 'Can’t find your course? Choose a category instead'));
    };
    const combo = combobox({
      onPick: () => { form.category = ''; miss = null; drawHelp(); },
      onMiss: (text) => { if (text !== miss) { miss = text; drawHelp(); } },
    });
    drawHelp();
    fill(el,
      h('div', { class: 'sect' }, h('h2', {}, 'Course'),
        h('div', { class: 'field' }, h('label', { for: 'course' }, 'Course ', h('span', { class: 'hint' }, `${meta.courses.length.toLocaleString()} available, type to search`)), combo),
        helpSlot),
      h('div', { class: 'sect' }, h('h2', {}, 'Delivery'),
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Level'), seg('level', meta.levels, false)),
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Mode of training'), seg('mode', meta.modes.map((m) => m.name), false, () => fill(noteSlot, modeNote())), noteSlot)),
      h('div', { class: 'sect' }, h('h2', {}, 'Duration'),
        h('div', { class: 'toggle', role: 'group', 'aria-label': 'Duration type' },
          h('button', { type: 'button', 'aria-pressed': String(form.durationMode === 'days'), onclick: () => { form.durationMode = 'days'; save(); drawInputs(); quoteNow(); } }, 'By days'),
          h('button', { type: 'button', 'aria-pressed': String(form.durationMode === 'hours'), onclick: () => { form.durationMode = 'hours'; save(); drawInputs(); quoteNow(); } }, 'By total hours')),
        form.durationMode === 'days'
          ? h('div', { class: 'swap' },
            h('div', { class: 'field' }, h('label', { for: 'days' }, 'Number of days'),
              h('select', { id: 'days', onchange: (e) => { update('days', e.target.value); paintNote(); } }, meta.daysOptions.map((d) => h('option', { value: d, selected: String(d) === String(form.days) }, d)))),
            h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Hours per day'), seg('hoursPerDay', meta.hoursPerDay.map(String), false, () => paintNote()), hoursNote))
          : h('div', { class: 'field swap' }, h('label', { for: 'hrs' }, 'Total training hours'),
            h('input', { id: 'hrs', type: 'number', min: '0', step: 'any', inputmode: 'decimal', placeholder: 'e.g. 12', value: form.totalHours, oninput: (e) => update('totalHours', e.target.value) }),
            h('p', { class: 'note' }, 'Days and hours per day are not used when you enter total hours.'))));
  }

  function seg(key, options, redraw, after) {
    const wrap = h('div', { class: 'seg', role: 'group' });
    const draw = () => fill(wrap, options.map((o) => h('button', { type: 'button', 'aria-pressed': String(String(form[key]) === String(o)), onclick: () => {
      form[key] = o; save();
      if (redraw) { drawInputs(); quoteNow(); } else { draw(); quoteNow(); }
      after && after(key, o);
    } }, key === 'hoursPerDay' ? o + ' hrs' : o)));
    draw();
    return wrap;
  }

  function combobox(hooks) {
    const input = h('input', { id: 'course', type: 'text', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', placeholder: 'Search course name…', value: form.course });
    const list = h('ul', { role: 'listbox', hidden: true });
    const clr = h('button', { class: 'clr', type: 'button', 'aria-label': 'Clear course', hidden: !form.course, onclick: () => { input.value = ''; select(''); input.focus(); } }, '×');
    let items = [], active = -1;
    function filter(q) {
      const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!toks.length) return meta.courses.slice(0, 60);
      const hits = [];
      for (const n of meta.courses) { const l = n.toLowerCase(); if (toks.every((t) => l.includes(t))) hits.push([l.startsWith(toks[0]) ? 0 : 1, n]); }
      hits.sort((a, b) => a[0] - b[0]);
      return hits.map((x) => x[1]);
    }
    function open() {
      const all = filter(input.value === form.course ? '' : input.value);
      const t = input.value === form.course ? '' : input.value.trim();
      hooks.onMiss(!all.length && t ? t : null);
      items = all.slice(0, 80); active = items.length ? 0 : -1;
      fill(list,
        items.map((n, i) => h('li', { role: 'option', class: i === active ? 'act' : '', onmousedown: (e) => { e.preventDefault(); select(n); } }, n)),
        all.length > items.length ? h('li', { class: 'more' }, `${all.length - items.length} more, keep typing to narrow`) : null,
        !items.length ? h('li', { class: 'none' }, 'No matching course') : null);
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    }
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }
    function select(n) { input.value = n; clr.hidden = !n; close(); if (n) hooks.onPick(); update('course', n); }
    function move(d) {
      if (!items.length) return;
      list.children[active] && list.children[active].classList.remove('act');
      active = (active + d + items.length) % items.length;
      const li = list.children[active]; li.classList.add('act'); li.scrollIntoView({ block: 'nearest' });
    }
    input.addEventListener('focus', () => { input.select(); open(); });
    input.addEventListener('input', () => { clr.hidden = !input.value; open(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); list.hidden ? open() : move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { if (!list.hidden && items[active]) { e.preventDefault(); select(items[active]); } }
      else if (e.key === 'Escape') { close(); input.value = form.course; }
    });
    input.addEventListener('blur', () => { close(); input.value = form.course; clr.hidden = !form.course; });
    const wrap = h('div', { class: 'combo' }, input, clr, list);
    wrap.sync = () => { input.value = form.course; clr.hidden = !form.course; };
    return wrap;
  }

  let seq = 0, shown = 0;
  function countTo(el, to) {
    const from = shown; shown = to;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) { el.textContent = aed(to); return; }
    const t0 = performance.now(), dur = 420;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = aed(from + (to - from) * e);
      if (k < 1 && el.isConnected) requestAnimationFrame(step); else el.textContent = aed(to);
    };
    requestAnimationFrame(step);
  }
  async function quoteNow() {
    const el = document.getElementById('result'); if (!el) return;
    const mine = ++seq;
    let q;
    try { q = await B.quote({ ...form }); } catch (e) { fill(el, h('div', { class: 'errs', style: 'margin:16px' }, 'Could not calculate: ' + e.message)); return; }
    if (mine !== seq) return;
    const hrs = q.hours != null ? num(q.hours) : null;
    const duration = form.durationMode === 'hours'
      ? (hrs ? `${hrs} training hours` : '—')
      : (Number(form.days) > 0 ? `${num(form.days)} day${Number(form.days) === 1 ? '' : 's'} × ${num(form.hoursPerDay)} hrs a day${hrs ? ` (${hrs} hours)` : ''}` : '—');
    const sel = (l, v, wide) => h('div', { class: 'r' + (wide ? ' wide' : '') }, h('span', {}, l), h('b', {}, v || h('i', {}, 'Not chosen yet')));
    const amount = h('div', { class: 'amount' }, q.ok ? aed(shown) : '—');
    const hero = h('div', { class: 'total' + (q.ok ? ' live' : ' empty') },
      h('div', { class: 'eyebrow' }, 'Course fee incl. VAT'), amount,
      h('div', { class: 'sub' }, q.ok ? `${aed(q.courseFee)} before VAT · VAT ${aed(q.vat)}` : (q.message || 'Fill in all inputs')));
    fill(el, hero,
      h('div', { class: 'grp' }, h('h3', {}, 'Your selection'),
        sel('Course', form.course || (form.category ? `Not listed · ${form.category} category` : ''), true), sel('Level', form.level), sel('Mode of training', form.mode), sel('Duration', duration, true)),
      q.ok ? summaryBox(q.summary) : null);
    if (q.ok) countTo(amount, q.total); else shown = 0;
  }

  function summaryBox(text) {
    const ta = h('textarea', { readonly: true, rows: 3, 'aria-label': 'Quote summary', id: 'summaryText' });
    ta.value = text;
    return h('div', { class: 'summary' },
      h('div', { class: 'bar' }, h('span', { class: 'lbl', style: 'margin:0' }, 'Quote summary'),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => {
          try { await navigator.clipboard.writeText(text); toast('Quote summary copied'); } catch (e) { ta.select(); toast('Press Ctrl/Cmd+C to copy'); }
        } }, 'Copy')), ta);
  }

  /* ======================= ADMIN ======================= */
  const SECTIONS = [
    ['Pricing', [
      ['rates', 'Rates', 'Trainer rate per hour for every course. Search, then change the online or offline rate of any course.'],
      ['cats', 'Default rate cards', 'Starting rates by category. A course uses its category card unless you give it a rate of its own in Rates.'],
      ['formulas', 'Formulas', 'The steps that turn a trainer rate into a price. Edit them, reorder them, or add your own.'],
      ['fees', 'Fee settings', 'Fee multiplier, VAT and rounding used by the formulas.'],
      ['addons', 'Levels & modes', 'Price add-ons for course level and mode of training, plus the note customers see for a mode.'],
      ['duration', 'Duration', 'Session-length factors and the day options people can pick.'],
    ]],
    ['Catalogue', [['courses', 'Courses', 'Add, edit, remove or bulk upload courses. Choose "None" as the category to price a course by hand.']]],
    ['System', [['data', 'Backup & reset', 'Download or restore all settings, or go back to the original Excel data.']]],
  ];
  const FLAT = SECTIONS.flatMap(([, items]) => items);

  async function renderAdmin(keep) {
    if (!keep) fill($app, h('div', { class: 'loading' }, logo(), h('span', {}, 'Loading admin data…')));
    let cfg;
    try { cfg = await B.getConfig(); } catch (e) { view = 'calc'; renderShell(); renderCalc(); return; }
    const prev = admin;
    admin = { orig: JSON.stringify(cfg), draft: clone(cfg), tab: (prev && prev.tab) || 'rates', f: (prev && prev.f) || { q: '', cat: '', basis: '', page: 0 }, r: (prev && prev.r) || { q: '', cat: '', own: '', page: 0 },
      dirty() { return JSON.stringify(this.draft) !== this.orig; } };
    drawAdmin();
  }
  B.onChange && B.onChange(() => {
    if (view === 'calc') renderCalc();
    else if (view === 'admin' && admin) { if (!admin.dirty()) renderAdmin(true); else toast('Shared data was changed by someone else. Save or discard your draft to see it.'); }
  });

  function drawAdmin(errors) {
    const sec = FLAT.find((s) => s[0] === admin.tab) || FLAT[0];
    const body = h('div', { id: 'tabBody' });
    const saveBtn = h('button', { class: 'btn primary', onclick: saveAll }, 'Save changes');
    const discard = h('button', { class: 'btn ghost', onclick: async () => { if (await ask({ title: 'Discard changes?', body: 'All unsaved edits will be lost.', ok: 'Discard', danger: true })) renderAdmin(true); } }, 'Discard');
    const bar = h('div', { class: 'savebar', role: 'region', 'aria-label': 'Unsaved changes' }, h('span', {}, 'Unsaved changes'), discard, saveBtn);
    admin.refreshBar = () => { bar.hidden = !admin.dirty(); };
    const rail = h('nav', { class: 'rail', 'aria-label': 'Admin sections' },
      SECTIONS.map(([g, items]) => [h('div', { class: 'gl' }, g), items.map(([k, label]) => h('button', { 'aria-current': admin.tab === k ? 'page' : null, onclick: () => { admin.tab = k; drawAdmin(); window.scrollTo(0, 0); } }, label))]),
      h('div', { class: 'out' }, h('button', { onclick: async () => { if (admin.dirty() && !(await ask({ title: 'Sign out without saving?', body: 'Your unsaved changes will be lost.', ok: 'Sign out', danger: true }))) return; await B.logout(); admin = null; view = 'calc'; renderShell(); renderCalc(); } }, 'Sign out')));
    fill($app, h('div', { class: 'admin' }, rail, h('section', {},
      h('div', { class: 'panel-head' }, h('div', {}, h('h1', {}, sec[1]), h('p', {}, sec[2]))),
      h('p', { class: 'status', id: 'status' }, B.statusText()),
      errors && errors.length ? h('div', { class: 'errs', role: 'alert' }, h('b', {}, 'Not saved. Please fix:'), h('ul', {}, errors.map((e) => h('li', {}, e)))) : null,
      body)), bar);
    ({ rates: tabRates, cats: tabCats, formulas: tabFormulas, fees: tabFees, addons: tabAddons, duration: tabDuration, courses: tabCourses, data: tabData })[admin.tab](body);
    admin.refreshBar();
  }
  window.__refreshStatus = () => { const el = document.getElementById('status'); if (el) el.textContent = B.statusText(); };

  async function saveAll() {
    const { errors } = Core.validateConfig(admin.draft);
    if (errors.length) { drawAdmin(errors); window.scrollTo(0, 0); return; }
    try {
      const r = await B.saveConfig(admin.draft);
      admin.draft = clone(r.config); admin.orig = JSON.stringify(r.config);
      toast(r.where === 'session' ? 'Applied for this session only (no shared storage)' : 'Saved. Live for everyone.');
      drawAdmin();
    } catch (e) { drawAdmin(e.details || [e.message]); window.scrollTo(0, 0); }
  }

  const changed = () => admin.refreshBar();
  function numInput(obj, key, o = {}) {
    return h('input', { type: 'number', step: o.step || 'any', min: o.min ?? 0, value: obj[key], class: o.cls, 'aria-label': o.label || key,
      oninput: (e) => { obj[key] = e.target.value === '' ? NaN : Number(e.target.value); o.after && o.after(); changed(); } });
  }
  function textInput(obj, key, o = {}) {
    return h('input', { type: 'text', value: obj[key], 'aria-label': o.label || key, class: o.cls, disabled: o.disabled, onchange: (e) => { const old = obj[key]; obj[key] = e.target.value.trim(); o.after && o.after(old); changed(); } });
  }
  const avg = (a, b) => (Number(a) + Number(b)) / 2;
  const iconBtn = (name, label, fn, disabled) => h('button', { class: 'btn ghost icon', 'aria-label': label, title: label, disabled, onclick: fn }, icon(name));
  const th = (arr) => h('thead', {}, h('tr', {}, arr.map((t) => h('th', {}, t))));
  const table = (head, body) => h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' }, th(head), body));

  /* ---- Rates (one row per course) ---- */
  const effRate = (c, card) => Core.courseRate(c, card, admin.draft.categories);
  const NONE_LABEL = 'None (price manually)';
  function catFilterOptions(cats, selected) {
    return [h('option', { value: '' }, 'All categories'), h('option', { value: '__none', selected: selected === '__none' }, NONE_LABEL), cats.map((c) => h('option', { value: c.name, selected: c.name === selected }, c.name))];
  }
  const matchesCat = (c, f) => (!f ? true : f === '__none' ? !c.category : c.category === f);

  function tabRates(body) {
    const d = admin.draft, F = admin.r, PAGE = 50;
    const tbl = h('div', { class: 'swap' }), pager = h('div', { class: 'pager' }), info = h('span', { class: 'pill' });
    const own = (c) => c.onlineRate !== null && c.onlineRate !== undefined || c.offlineRate !== null && c.offlineRate !== undefined;
    const filtered = () => {
      const toks = F.q.toLowerCase().split(/\s+/).filter(Boolean);
      return d.courses.filter((c) => matchesCat(c, F.cat) && (F.own !== 'own' || own(c)) && toks.every((t) => c.name.toLowerCase().includes(t)));
    };
    function rateCell(c, key, card, rowEl) {
      const manual = !c.category;
      const input = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', class: 'w90 rate', 'aria-label': `${card} rate for ${c.name}` });
      const paint = () => { const v = effRate(c, card); input.value = v === null ? '' : String(Math.round(v * 100) / 100); input.classList.toggle('own', c[key] !== null && c[key] !== undefined && !manual); };
      paint();
      input.addEventListener('change', () => {
        const raw = input.value.trim(), n = Number(raw);
        if (raw === '' || !Number.isFinite(n) || n < 0) { if (!manual) c[key] = null; paint(); changed(); rowEl.refresh(); return; }
        const base = manual ? null : (card === 'Online' ? Core.categoryRate(d.categories.find((x) => x.name === c.category), 'Online') : Core.categoryRate(d.categories.find((x) => x.name === c.category), 'Offline'));
        c[key] = !manual && base === n ? null : n;
        if (manual && !(n > 0)) { toast('A manually priced course needs a rate above 0'); }
        paint(); changed(); rowEl.refresh();
      });
      input.__paint = paint;
      return input;
    }
    function draw() {
      const rows = filtered();
      const pages = Math.max(1, Math.ceil(rows.length / PAGE));
      F.page = Math.min(F.page, pages - 1);
      const slice = rows.slice(F.page * PAGE, F.page * PAGE + PAGE);
      info.textContent = `${rows.length.toLocaleString()} of ${d.courses.length.toLocaleString()} courses`;
      const tb = h('tbody');
      slice.forEach((c) => {
        const tr = h('tr', {});
        const on = rateCell(c, 'onlineRate', 'Online', tr), off = rateCell(c, 'offlineRate', 'Offline', tr);
        const reset = h('button', { class: 'btn ghost icon', 'aria-label': 'Back to category rate', title: 'Back to the category rate card', onclick: () => { c.onlineRate = null; c.offlineRate = null; on.__paint(); off.__paint(); changed(); tr.refresh(); } }, icon('undo'));
        tr.refresh = () => { reset.hidden = !c.category || !own(c); };
        tr.refresh();
        tr.append(h('td', { class: 'cname' }, c.name),
          h('td', {}, c.category ? h('span', { class: 'chip' }, c.category) : h('span', { class: 'chip manual' }, 'Manual price')),
          h('td', {}, on), h('td', {}, off), h('td', { class: 'act1' }, reset));
        tb.append(tr);
      });
      fill(tbl, rows.length ? table(['Course', 'Category', 'Online rate (AED/hr)', 'Offline rate (AED/hr)', ''], tb) : h('div', { class: 'empty' }, 'No courses match your search.'));
      fill(pager, h('button', { class: 'btn sm', disabled: F.page === 0, onclick: () => { F.page--; draw(); } }, '‹ Prev'), h('span', {}, `Page ${F.page + 1} of ${pages}`), h('button', { class: 'btn sm', disabled: F.page >= pages - 1, onclick: () => { F.page++; draw(); } }, 'Next ›'));
    }
    const search = h('input', { type: 'text', id: 'rateSearch', class: 'grow', placeholder: 'Search courses…', value: F.q, 'aria-label': 'Search courses', oninput: (e) => { F.q = e.target.value; F.page = 0; draw(); } });
    const catSel = h('select', { 'aria-label': 'Filter category', onchange: (e) => { F.cat = e.target.value; F.page = 0; draw(); } }, catFilterOptions(d.categories, F.cat));
    const ownSel = h('select', { 'aria-label': 'Filter rates', onchange: (e) => { F.own = e.target.value; F.page = 0; draw(); } },
      h('option', { value: '' }, 'All courses'), h('option', { value: 'own', selected: F.own === 'own' }, 'Own rate set'));
    body.append(h('div', { class: 'toolbar' }, search, catSel, ownSel), h('div', { class: 'toolbar' }, info), tbl, pager,
      h('p', { class: 'note' }, 'Rates are AED per trainer hour (online rate for Online mode, offline rate for Classroom). Highlighted rates belong to that course only; the arrow returns it to its category card. Courses with no category always use their own rates.'));
    draw();
  }

  /* ---- Default rate cards (by category) ---- */
  function tabCats(body) {
    const d = admin.draft;
    const count = (name) => d.courses.reduce((n, c) => n + (c.category === name ? 1 : 0), 0);
    const tbody = h('tbody');
    d.categories.forEach((c, i) => {
      const on = h('td', { class: 'avg' }, num(avg(c.onlineLow, c.onlineHigh)));
      const off = h('td', { class: 'avg' }, num(avg(c.offlineLow, c.offlineHigh)));
      const upd = () => { on.textContent = num(avg(c.onlineLow, c.onlineHigh)); off.textContent = num(avg(c.offlineLow, c.offlineHigh)); };
      tbody.append(h('tr', {},
        h('td', {}, textInput(c, 'name', { label: 'Category name', after: (old) => { d.courses.forEach((x) => { if (x.category === old) x.category = c.name; }); } })),
        h('td', {}, numInput(c, 'onlineLow', { after: upd })), h('td', {}, numInput(c, 'onlineHigh', { after: upd })), on,
        h('td', {}, numInput(c, 'offlineLow', { after: upd })), h('td', {}, numInput(c, 'offlineHigh', { after: upd })), off,
        h('td', { class: 'avg' }, String(count(c.name))),
        h('td', {}, iconBtn('x', 'Delete category', async () => {
          const n = count(c.name);
          if (n) return toast(`${n} courses use "${c.name}". Move them to another category first (Courses).`);
          if (await ask({ title: 'Delete category?', body: c.name, ok: 'Delete', danger: true })) { d.categories.splice(i, 1); drawAdmin(); }
        }))));
    });
    body.append(table(['Pricing category', 'Online low', 'Online high', 'Online avg', 'Offline low', 'Offline high', 'Offline avg', 'Courses', ''], tbody),
      h('div', { class: 'toolbar', style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: () => {
        d.categories.push({ name: 'New category ' + (d.categories.length + 1), onlineLow: 100, onlineHigh: 140, offlineLow: 120, offlineHigh: 160 }); drawAdmin();
      } }, '+ Add category')),
      h('p', { class: 'note' }, 'Rates are AED per trainer hour. Online uses the online average; classroom uses the offline average. Renaming a category updates its courses. Courses with their own rate (Rates) ignore these cards.'));
  }

  /* ---- Fee settings ---- */
  function tabFees(body) {
    const s = admin.draft.settings;
    body.append(h('div', { class: 'card form-card' },
      h('div', { class: 'field' }, h('label', {}, 'Fee multiplier ', h('span', { class: 'hint' }, 'variable: markup')), numInput(s, 'multiplier', { step: '0.01', label: 'Fee multiplier' }), h('p', { class: 'note' }, 'Trainer payout × this = base course fee (default 2.8).')),
      h('div', { class: 'field' }, h('label', {}, 'VAT rate (%)'), h('input', { type: 'number', step: 'any', min: 0, max: 100, value: +(s.vatRate * 100).toFixed(4), 'aria-label': 'VAT rate percent', oninput: (e) => { s.vatRate = e.target.value === '' ? NaN : Number(e.target.value) / 100; changed(); } })),
      h('div', { class: 'field' }, h('label', {}, 'Round course fee to nearest (AED) ', h('span', { class: 'hint' }, 'variable: roundTo')), numInput(s, 'roundTo', { step: 'any', label: 'Round to' }))));
  }

  /* ---- Levels & modes ---- */
  function tabAddons(body) {
    const d = admin.draft;
    const modes = h('tbody');
    d.modes.forEach((m, i) => modes.append(h('tr', {},
      h('td', {}, textInput(m, 'name', { label: 'Mode name', cls: 'narrow' })),
      h('td', {}, h('select', { 'aria-label': 'Rate card', onchange: (e) => { m.rateCard = e.target.value; changed(); } }, ['Online', 'Offline'].map((o) => h('option', { value: o, selected: o === m.rateCard }, o + ' rates')))),
      h('td', {}, numInput(m, 'multiplier', { step: '0.01', cls: 'w90', label: 'Mode multiplier' })),
      h('td', { class: 'notecell' }, h('textarea', { rows: 2, maxlength: 400, 'aria-label': 'Note shown to customers', placeholder: 'Optional note shown when this mode is selected', value: m.note || '', oninput: (e) => { m.note = e.target.value; changed(); } })),
      h('td', {}, iconBtn('x', 'Delete mode', () => { if (d.modes.length < 2) return toast('At least one mode is required'); d.modes.splice(i, 1); drawAdmin(); })))));
    const levels = h('tbody');
    d.levels.forEach((l, i) => levels.append(h('tr', {},
      h('td', {}, textInput(l, 'name', { label: 'Level name' })),
      h('td', {}, numInput(l, 'multiplier', { step: '0.01', cls: 'w90', label: 'Level multiplier' })),
      h('td', {}, iconBtn('x', 'Delete level', () => { if (d.levels.length < 2) return toast('At least one level is required'); d.levels.splice(i, 1); drawAdmin(); })))));
    body.append(h('div', { class: 'cols' },
      h('div', {}, h('h3', { class: 'sub' }, 'Levels'), h('p', { class: 'p' }, 'Multiplier on the base course fee. 1.2 means the level adds 20%.'), table(['Level', 'Multiplier', ''], levels),
        h('div', { class: 'toolbar', style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: () => { d.levels.push({ name: 'New level', multiplier: 1 }); drawAdmin(); } }, '+ Add level'))),
      h('div', {}, h('h3', { class: 'sub' }, 'Modes of training'), h('p', { class: 'p' }, 'Rate card, price multiplier, and an optional note customers see when they pick the mode.'), table(['Mode', 'Rate card', 'Multiplier', 'Note shown to customers', ''], modes),
        h('div', { class: 'toolbar', style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: () => { d.modes.push({ name: 'New mode', rateCard: 'Offline', multiplier: 1, note: '' }); drawAdmin(); } }, '+ Add mode')))));
  }

  /* ---- Duration ---- */
  function tabDuration(body) {
    const d = admin.draft;
    const t = h('tbody');
    d.hoursPerDay.forEach((x, i) => t.append(h('tr', {},
      h('td', {}, numInput(x, 'hours', { step: '0.5', cls: 'w90', label: 'Session length (hours)' })),
      h('td', {}, numInput(x, 'multiplier', { step: '0.01', cls: 'w90', label: 'Factor' })),
      h('td', {}, iconBtn('x', 'Delete option', () => { if (d.hoursPerDay.length < 2) return toast('At least one option is required'); d.hoursPerDay.splice(i, 1); drawAdmin(); })))));
    const days = h('textarea', { rows: 4, id: 'daysOpts', 'aria-label': 'Days options', onchange: (e) => { d.daysOptions = e.target.value.split(/[\s,;]+/).filter(Boolean).map(Number); changed(); } });
    days.value = d.daysOptions.join(', ');
    body.append(h('div', { class: 'cols' },
      h('div', {}, h('h3', { class: 'sub' }, 'Session-length factor'), h('p', { class: 'p' }, 'Shorter sessions cost more per hour. Applied to the trainer payout (variable: durationFactor). When a user enters total hours instead of days, the factor of the shortest session that is at least as long as the total is used.'),
        table(['Hours per day', 'Factor', ''], t),
        h('div', { class: 'toolbar', style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: () => { d.hoursPerDay.push({ hours: 6, multiplier: 1 }); drawAdmin(); } }, '+ Add option'))),
      h('div', {}, h('h3', { class: 'sub' }, 'Number-of-days options'), h('p', { class: 'p' }, 'Whole numbers, separated by commas or spaces.'), days)));
  }

  /* ---- Formulas ---- */
  const fmtUnit = (v, unit) => (unit === 'x' ? num(v) + '×' : unit === 'num' ? num(v) : aed(v));
  const test = { category: null, level: null, mode: null, durationMode: 'days', days: '2', hoursPerDay: '4', totalHours: '12' };
  function tabFormulas(body) {
    const d = admin.draft;
    const left = h('div'), side = h('aside');
    const errEls = [];
    if (!test.category || !d.categories.some((c) => c.name === test.category)) test.category = d.categories[0] ? d.categories[0].name : '';
    if (!d.levels.some((l) => l.name === test.level)) test.level = (d.levels[1] || d.levels[0]).name;
    if (!d.modes.some((m) => m.name === test.mode)) test.mode = d.modes[0].name;
    if (!d.hoursPerDay.some((x) => String(x.hours) === String(test.hoursPerDay))) test.hoursPerDay = String(d.hoursPerDay[0].hours);

    function validate() {
      const errs = Core.validateFormulas(d.formulas.map((f) => ({ ...f, id: String(f.id).trim(), expr: String(f.expr) })), d.settings);
      d.formulas.forEach((f, i) => { const m = errs.filter((e) => e.startsWith(`Formula "${f.id}"`)); errEls[i] && (errEls[i].textContent = m.map((e) => e.replace(/^Formula "[^"]*": /, '')).join(' ')); });
      const globalErrs = errs.filter((e) => !d.formulas.some((f) => e.startsWith(`Formula "${f.id}"`)));
      return globalErrs;
    }
    function drawSide() {
      const cfg = { ...d, courses: [{ name: 'Test', category: test.category, basis: '', onlineRate: null, offlineRate: null }] };
      const q = Core.quote(cfg, { course: 'Test', level: test.level, mode: test.mode, durationMode: test.durationMode, days: test.days, hoursPerDay: test.hoursPerDay, totalHours: test.totalHours }, { fresh: true });
      const sel = (key, opts, label) => h('select', { 'aria-label': label, onchange: (e) => { test[key] = e.target.value; drawSide(); } }, opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(test[key]) }, t)));
      fill(side,
        h('div', { class: 'card side' }, h('h3', {}, 'Try it'),
          h('div', { class: 'mini' },
            h('div', { class: 'full' }, sel('category', d.categories.map((c) => [c.name, c.name]), 'Category')),
            sel('level', d.levels.map((l) => [l.name, l.name]), 'Level'), sel('mode', d.modes.map((m) => [m.name, m.name]), 'Mode'),
            sel('durationMode', [['days', 'By days'], ['hours', 'By total hours']], 'Duration type'),
            test.durationMode === 'days'
              ? h('div', { class: 'two', style: 'gap:8px' }, h('input', { type: 'number', min: 1, value: test.days, 'aria-label': 'Days', oninput: (e) => { test.days = e.target.value; drawSide(); } }), sel('hoursPerDay', d.hoursPerDay.map((x) => [x.hours, x.hours + ' hrs']), 'Hours per day'))
              : h('input', { type: 'number', min: 0, step: 'any', value: test.totalHours, 'aria-label': 'Total hours', oninput: (e) => { test.totalHours = e.target.value; drawSide(); } })),
          q.ok
            ? h('div', {}, q.steps.map((s) => h('div', { class: 'r ' + (['courseFee', 'total'].includes(s.id) ? 'strong' : '') }, h('span', {}, s.label), h('b', {}, fmtUnit(s.value, s.unit)))))
            : h('p', { class: 'note' }, q.message || 'Fill in the test inputs.')),
        h('div', { class: 'card side' }, h('h3', {}, 'Built-in variables'),
          h('div', { class: 'vars' }, Core.BASE_VARS.map(([n, desc]) => [h('code', {}, n), h('span', {}, desc), h('b', {}, q.vars && n.toLowerCase() in q.vars ? num(q.vars[n.toLowerCase()]) : '–')]))),
        h('div', { class: 'card side' }, h('h3', {}, 'Functions and operators'),
          h('div', { class: 'fdoc' }, Core.FUNC_DOCS.map(([f, t]) => h('div', {}, h('code', {}, f), ' ', h('span', {}, t))), h('div', {}, h('code', {}, '+ − × ÷ ^ ( )'), ' ', h('span', {}, 'Use * for multiply and / for divide')))));
    }
    function drawList() {
      errEls.length = 0;
      const nodes = d.formulas.map((f, i) => {
        const req = Core.REQUIRED_STEPS.includes(f.id);
        const err = h('div', { class: 'ferr', role: 'alert' }); errEls[i] = err;
        const expr = h('input', { type: 'text', class: 'mono', value: f.expr, 'aria-label': 'Formula for ' + f.label, spellcheck: 'false', autocomplete: 'off', oninput: (e) => { f.expr = e.target.value; changed(); validate(); drawSide(); } });
        return h('div', { class: 'card step' },
          h('div', { class: 'l1' },
            h('input', { type: 'text', value: f.label, 'aria-label': 'Label', onchange: (e) => { f.label = e.target.value; changed(); drawSide(); } }),
            h('select', { 'aria-label': 'Group', onchange: (e) => { f.stage = e.target.value; changed(); } }, Core.STAGES.map(([k, t]) => h('option', { value: k, selected: k === f.stage }, t))),
            h('div', { class: 'acts' }, iconBtn('up', 'Move up', () => { if (i) { [d.formulas[i - 1], d.formulas[i]] = [d.formulas[i], d.formulas[i - 1]]; changed(); drawList(); validate(); drawSide(); } }, i === 0),
              iconBtn('down', 'Move down', () => { if (i < d.formulas.length - 1) { [d.formulas[i + 1], d.formulas[i]] = [d.formulas[i], d.formulas[i + 1]]; changed(); drawList(); validate(); drawSide(); } }, i === d.formulas.length - 1),
              iconBtn('x', req ? 'Required step' : 'Delete step', () => { d.formulas.splice(i, 1); changed(); drawList(); validate(); drawSide(); }, req))),
          h('div', { class: 'l2' },
            h('input', { type: 'text', class: 'mono', value: f.id, disabled: req, 'aria-label': 'Step id', title: req ? 'Required step. Its id cannot change.' : 'Step id (used by later formulas)', onchange: (e) => { const old = f.id; f.id = e.target.value.trim(); d.formulas.forEach((g) => { if (g !== f) g.expr = g.expr.replace(new RegExp('\\b' + old + '\\b', 'gi'), f.id); }); changed(); drawList(); validate(); drawSide(); } }),
            h('div', { class: 'eq' }, expr),
            h('select', { 'aria-label': 'Shown as', onchange: (e) => { f.unit = e.target.value; changed(); drawSide(); } }, [['aed', 'AED'], ['x', 'Multiplier ×'], ['num', 'Number']].map(([k, t]) => h('option', { value: k, selected: k === f.unit }, t)))),
          err);
      });
      fill(left,
        h('div', { class: 'errs', id: 'globalFErr', hidden: true }),
        nodes,
        h('div', { class: 'toolbar' },
          h('button', { class: 'btn', onclick: () => {
            let n = 1; while (d.formulas.some((f) => f.id === 'step' + n)) n++;
            const at = d.formulas.findIndex((f) => f.id === 'courseFee');
            d.formulas.splice(at < 0 ? d.formulas.length : at, 0, { id: 'step' + n, label: 'New step', stage: 'addon', unit: 'aed', expr: '0' }); changed(); drawList(); validate(); drawSide();
          } }, '+ Add step'),
          h('button', { class: 'btn danger', onclick: async () => { if (await ask({ title: 'Reset formulas?', body: 'The formula steps return to their defaults. Rates and other settings are not touched.', ok: 'Reset', danger: true })) { d.formulas = Core.defaultFormulas(); changed(); drawList(); validate(); drawSide(); } } }, 'Reset formulas')),
        h('p', { class: 'note' }, 'Steps run top to bottom and can use built-in variables and any step above them. A step only changes the price if a later formula uses it, and the four required steps (trainerPayout, courseFee, vat, total) must stay. Use {name} in a label to show a value, for example {levelFactor} or {area}.'));
      validate();
    }
    drawList(); drawSide();
    body.append(h('div', { class: 'fgrid' }, left, side));
  }

  /* ---- Courses ---- */
  const BASES = ['Category match', 'Course-name keyword', 'Closest fit', 'Reviewed', 'Admin added', 'Bulk upload'];
  function tabCourses(body) {
    const d = admin.draft, F = admin.f, PAGE = 50;
    const tbl = h('div', { class: 'swap' }), pager = h('div', { class: 'pager' }), info = h('span', { class: 'pill' });
    const filtered = () => {
      const toks = F.q.toLowerCase().split(/\s+/).filter(Boolean);
      return d.courses.filter((c) => matchesCat(c, F.cat) && (!F.basis || (F.basis === '__review' ? !['Category match', 'Reviewed', 'Bulk upload', 'Admin added'].includes(c.basis) : c.basis === F.basis)) && toks.every((t) => c.name.toLowerCase().includes(t)));
    };
    function setCategory(c, value) {
      if (value === '') {
        c.onlineRate = effRate(c, 'Online') ?? 100; c.offlineRate = effRate(c, 'Offline') ?? 120; c.category = '';
      } else { c.category = value; c.onlineRate = null; c.offlineRate = null; }
      changed();
    }
    function draw() {
      const rows = filtered();
      const pages = Math.max(1, Math.ceil(rows.length / PAGE));
      F.page = Math.min(F.page, pages - 1);
      const slice = rows.slice(F.page * PAGE, F.page * PAGE + PAGE);
      info.textContent = `${rows.length.toLocaleString()} of ${d.courses.length.toLocaleString()} courses`;
      bulkBtn.disabled = !rows.length || !bulkSel.value; bulkBtn.textContent = `Move ${rows.length.toLocaleString()} shown to…`;
      const tb = h('tbody');
      slice.forEach((c) => {
        const manual = !c.category;
        const rate = (key, label) => manual
          ? numInput(c, key, { cls: 'w90', label: label + ' rate', step: 'any' })
          : h('span', { class: 'ro', title: 'From the category card. Change it under Rates.' }, effRate(c, label) === null ? '—' : aed(effRate(c, label)));
        tb.append(h('tr', {},
          h('td', { style: 'min-width:320px' }, textInput(c, 'name', { label: 'Course name' })),
          h('td', {}, h('select', { 'aria-label': 'Category', onchange: (e) => { setCategory(c, e.target.value); draw(); } },
            h('option', { value: '', selected: manual }, NONE_LABEL), d.categories.map((x) => h('option', { value: x.name, selected: x.name === c.category }, x.name)))),
          h('td', {}, rate('onlineRate', 'Online')), h('td', {}, rate('offlineRate', 'Offline')),
          h('td', {}, h('select', { 'aria-label': 'Source', onchange: (e) => { c.basis = e.target.value; changed(); } }, [...new Set([...BASES, c.basis])].map((b) => h('option', { value: b, selected: b === c.basis }, b)))),
          h('td', {}, iconBtn('x', 'Delete course', async () => { if (await ask({ title: 'Delete course?', body: c.name, ok: 'Delete', danger: true })) { d.courses.splice(d.courses.indexOf(c), 1); changed(); draw(); } }))));
      });
      fill(tbl, rows.length ? table(['Course', 'Pricing category', 'Online rate', 'Offline rate', 'Source', ''], tb) : h('div', { class: 'empty' }, 'No courses match your filters.'));
      fill(pager, h('button', { class: 'btn sm', disabled: F.page === 0, onclick: () => { F.page--; draw(); } }, '‹ Prev'), h('span', {}, `Page ${F.page + 1} of ${pages}`), h('button', { class: 'btn sm', disabled: F.page >= pages - 1, onclick: () => { F.page++; draw(); } }, 'Next ›'));
    }
    const search = h('input', { type: 'text', id: 'courseSearch', class: 'grow', placeholder: 'Search courses…', value: F.q, 'aria-label': 'Search courses', oninput: (e) => { F.q = e.target.value; F.page = 0; draw(); } });
    const catSel = h('select', { 'aria-label': 'Filter category', onchange: (e) => { F.cat = e.target.value; F.page = 0; draw(); } }, catFilterOptions(d.categories, F.cat));
    const basisSel = h('select', { 'aria-label': 'Filter source', onchange: (e) => { F.basis = e.target.value; F.page = 0; draw(); } },
      h('option', { value: '' }, 'All sources'), h('option', { value: '__review', selected: F.basis === '__review' }, 'Needs review (inferred)'), BASES.map((b) => h('option', { value: b, selected: b === F.basis }, b)));
    const bulkSel = h('select', { 'aria-label': 'Move to category', onchange: () => draw() }, h('option', { value: '' }, 'Choose category…'), d.categories.map((c) => h('option', { value: c.name }, c.name)));
    const bulkBtn = h('button', { class: 'btn', onclick: async () => {
      const rows = filtered();
      if (!(await ask({ title: `Move ${rows.length} course(s)?`, body: `They will all be set to "${bulkSel.value}" and use its rate card.`, ok: 'Move' }))) return;
      rows.forEach((c) => { c.category = bulkSel.value; c.onlineRate = null; c.offlineRate = null; }); changed(); draw(); toast(`${rows.length} course(s) moved. Remember to save.`);
    } }, 'Move…');
    const add = h('button', { class: 'btn primary', onclick: () => addCourseDialog((c) => { F.q = c.name; F.cat = ''; F.basis = ''; F.page = 0; search.value = c.name; catSel.value = ''; basisSel.value = ''; changed(); draw(); toast('Course added. Remember to save.'); }) }, '+ Add course');
    const upload = h('button', { class: 'btn', onclick: () => bulkUploadDialog((msg) => { F.q = ''; F.cat = ''; F.basis = ''; F.page = 0; search.value = ''; catSel.value = ''; basisSel.value = ''; changed(); draw(); toast(msg); }) }, icon('upload'), 'Bulk upload');
    body.append(h('div', { class: 'toolbar' }, search, catSel, basisSel, add, upload), h('div', { class: 'toolbar' }, info, h('span', { style: 'flex:1' }), bulkSel, bulkBtn), tbl, pager,
      h('p', { class: 'note' }, 'Choose "None (price manually)" as the category and the course is priced from the online and offline rates you type here. "Needs review" lists mappings that were inferred rather than matched directly.'));
    draw();
  }

  function openModal(node, wide) {
    const close = () => fill($modal);
    const scrim = h('div', { class: 'scrim', onmousedown: (e) => { if (e.target === scrim) close(); } }, node);
    scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    fill($modal, scrim);
    return close;
  }

  function addCourseDialog(done) {
    const d = admin.draft;
    const err = h('div', { class: 'err', role: 'alert' });
    const name = h('input', { type: 'text', 'aria-label': 'Course name', placeholder: 'Course name' });
    const cat = h('select', { 'aria-label': 'Pricing category' }, h('option', { value: '' }, NONE_LABEL), d.categories.map((c) => h('option', { value: c.name }, c.name)));
    const on = h('input', { type: 'number', min: 0, step: 'any', 'aria-label': 'Online rate per hour', placeholder: 'e.g. 140' });
    const off = h('input', { type: 'number', min: 0, step: 'any', 'aria-label': 'Offline rate per hour', placeholder: 'e.g. 180' });
    const manual = h('div', { class: 'two manualbox' }, h('div', { class: 'field' }, h('label', {}, 'Online rate (AED/hr)'), on), h('div', { class: 'field' }, h('label', {}, 'Offline rate (AED/hr)'), off));
    const paint = () => { manual.hidden = cat.value !== ''; hint.textContent = cat.value === '' ? 'No category: the rates below are used for this course.' : 'Uses the category rate card. You can give it its own rate later under Rates.'; };
    const hint = h('p', { class: 'note' });
    cat.addEventListener('change', paint);
    let close;
    const f = h('form', { class: 'modal', onsubmit: (e) => {
      e.preventDefault(); err.textContent = '';
      const n = name.value.trim().replace(/\s+/g, ' ');
      if (!n) { err.textContent = 'Enter a course name.'; return name.focus(); }
      if (d.courses.some((c) => c.name.toLowerCase() === n.toLowerCase())) { err.textContent = 'That course already exists.'; return name.focus(); }
      const course = { name: n, category: cat.value, basis: 'Admin added', onlineRate: null, offlineRate: null };
      if (!cat.value) {
        if (!(Number(on.value) > 0 && Number(off.value) > 0)) { err.textContent = 'Without a category, enter both an online and an offline rate above 0.'; return on.focus(); }
        course.onlineRate = Number(on.value); course.offlineRate = Number(off.value);
      }
      d.courses.unshift(course); close(); done(course);
    } }, logo(), h('h3', {}, 'Add a course'),
      h('div', { class: 'field' }, h('label', {}, 'Course name'), name),
      h('div', { class: 'field' }, h('label', {}, 'Pricing category'), cat, hint), manual, err,
      h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Add course')));
    close = openModal(f); paint(); name.focus();
  }

  /* ---- Bulk upload (Excel or CSV) ---- */
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const sc = document.createElement('script'); sc.src = B.xlsxUrl;
      sc.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('The spreadsheet reader did not start.')));
      sc.onerror = () => reject(new Error('Could not load the spreadsheet reader. Check your connection and try again.'));
      document.head.appendChild(sc);
    });
  }
  const cellText = (x) => String(x === null || x === undefined ? '' : x).trim();
  const slug = (x) => cellText(x).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const parseRate = (x) => { const t = cellText(x).replace(/aed|,/gi, '').trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

  /* rows: array of arrays. Returns { items, blanks, header } */
  function readTable(rows) {
    const NAME = /^(course|course name|course title|name|title|programme|program)$/;
    let head = -1;
    for (let i = 0; i < Math.min(rows.length, 8); i++) if (rows[i].some((c) => NAME.test(slug(c)))) { head = i; break; }
    let nameCol = 0, catCol = -1, onCol = -1, offCol = -1;
    if (head >= 0) {
      rows[head].forEach((c, i) => {
        const k = slug(c);
        if (NAME.test(k) && nameCol === 0 && !(rows[head].slice(0, i).some((x) => NAME.test(slug(x))))) nameCol = i;
        else if (/categor/.test(k)) catCol = i;
        else if (/online/.test(k)) onCol = i;
        else if (/offline|classroom|face/.test(k)) offCol = i;
      });
    } else { catCol = rows.some((r) => r.length > 1) ? 1 : -1; onCol = 2; offCol = 3; }
    const items = []; let blanks = 0;
    rows.slice(head + 1).forEach((r, i) => {
      const name = cellText(r[nameCol]).replace(/\s+/g, ' ');
      if (!name) { if (r.some((c) => cellText(c))) blanks++; return; }
      items.push({ row: head + 2 + i, name, cat: catCol >= 0 ? cellText(r[catCol]) : '', on: onCol >= 0 ? parseRate(r[onCol]) : null, off: offCol >= 0 ? parseRate(r[offCol]) : null });
    });
    return { items, blanks, header: head >= 0 };
  }

  /* Check parsed rows against the draft. */
  function planUpload(items, mode) {
    const d = admin.draft;
    const cats = new Map(d.categories.map((c) => [slug(c.name), c.name]));
    const existing = new Map(d.courses.map((c) => [c.name.toLowerCase(), c]));
    const seen = new Set();
    const plan = { add: [], update: [], skip: 0, errors: [] };
    const bad = (it, msg) => plan.errors.push(`Row ${it.row}: ${it.name.length > 50 ? it.name.slice(0, 50) + '…' : it.name}. ${msg}`);
    for (const it of items) {
      const k = it.name.toLowerCase();
      if (it.name.length > 300) { bad(it, 'Name is longer than 300 characters.'); continue; }
      if (seen.has(k)) { bad(it, 'Appears more than once in the file (first one kept).'); continue; }
      seen.add(k);
      const none = !it.cat || /^(none|n a|na|manual|nil|no category)$/.test(slug(it.cat));
      let category = '';
      if (!none) { category = cats.get(slug(it.cat)); if (!category) { bad(it, `Unknown category "${it.cat}".`); continue; } }
      if (Number.isNaN(it.on) || Number.isNaN(it.off) || (it.on !== null && it.on < 0) || (it.off !== null && it.off < 0)) { bad(it, 'Rates must be numbers of 0 or more.'); continue; }
      if (none && !(it.on > 0 && it.off > 0)) { bad(it, 'No category, so it needs both an online and an offline rate.'); continue; }
      const rec = { name: it.name, category, basis: 'Bulk upload', onlineRate: it.on, offlineRate: it.off };
      const ex = existing.get(k);
      if (!ex) plan.add.push(rec);
      else if (mode === 'update') plan.update.push([ex, rec]);
      else plan.skip++;
    }
    return plan;
  }

  const TEMPLATE = '﻿Course,Category,Online rate,Offline rate\n"Example: Excel for Finance Teams","Data & Analytics",,\n"Example: Custom Leadership Workshop",None,260,320\n';

  function bulkUploadDialog(done) {
    const d = admin.draft;
    let parsed = null, mode = 'skip', close;
    const out = h('div', { class: 'bu-out' });
    const confirm = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Add courses');
    const fileName = h('span', { class: 'fname' }, 'Choose an Excel (.xlsx, .xls) or CSV file');
    const input = h('input', { type: 'file', id: 'bulkFile', accept: '.xlsx,.xls,.csv,.txt,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hidden: true });
    function render() {
      if (!parsed) return fill(out);
      const plan = planUpload(parsed.items, mode);
      parsed.plan = plan;
      const n = plan.add.length + plan.update.length;
      confirm.disabled = n === 0;
      confirm.textContent = n ? `Add ${plan.add.length}${plan.update.length ? ` and update ${plan.update.length}` : ''} course${n === 1 ? '' : 's'}` : 'Nothing to add';
      fill(out,
        h('div', { class: 'stats' },
          h('div', { class: 'stat ok' }, h('b', {}, plan.add.length.toLocaleString()), h('span', {}, 'new')),
          mode === 'update' ? h('div', { class: 'stat' }, h('b', {}, plan.update.length.toLocaleString()), h('span', {}, 'updated')) : h('div', { class: 'stat' }, h('b', {}, plan.skip.toLocaleString()), h('span', {}, 'already exist, skipped')),
          h('div', { class: 'stat' + (plan.errors.length ? ' bad' : '') }, h('b', {}, plan.errors.length.toLocaleString()), h('span', {}, 'with problems'))),
        parsed.header ? null : h('p', { class: 'note' }, 'No header row found, so column A is read as the course name, B as category, C as online rate and D as offline rate.'),
        plan.errors.length ? h('div', { class: 'errlist' }, h('b', {}, 'These rows will not be added:'), h('ul', {}, plan.errors.slice(0, 40).map((e) => h('li', {}, e)), plan.errors.length > 40 ? h('li', {}, `…and ${plan.errors.length - 40} more`) : null)) : null);
    }
    input.addEventListener('change', async () => {
      const f = input.files[0]; if (!f) return;
      fileName.textContent = f.name; parsed = null; fill(out, h('p', { class: 'note' }, 'Reading file…')); confirm.disabled = true;
      try {
        if (f.size > 8 * 1024 * 1024) throw new Error('That file is over 8 MB.');
        const X = await loadXlsx();
        const wb = X.read(await f.arrayBuffer(), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) throw new Error('The file has no sheets.');
        const rows = X.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
        if (!rows.length) throw new Error('The sheet is empty.');
        if (rows.length > 20001) throw new Error('Too many rows (max 20,000 per upload).');
        parsed = readTable(rows);
        if (!parsed.items.length) throw new Error('No course names found. Put names in a column headed "Course".');
        render();
      } catch (e) { parsed = null; fill(out, h('div', { class: 'err', role: 'alert' }, e.message)); input.value = ''; }
    });
    confirm.addEventListener('click', () => {
      const plan = parsed && parsed.plan; if (!plan) return;
      plan.add.forEach((c) => d.courses.unshift(c));
      plan.update.forEach(([ex, rec]) => { ex.category = rec.category; ex.onlineRate = rec.onlineRate; ex.offlineRate = rec.offlineRate; ex.basis = 'Bulk upload'; });
      close(); done(`${plan.add.length} added${plan.update.length ? `, ${plan.update.length} updated` : ''}${plan.errors.length ? `, ${plan.errors.length} skipped` : ''}. Remember to save.`);
    });
    const radio = (val, label) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'dup', checked: mode === val, onchange: () => { mode = val; render(); } }), label);
    const drop = h('div', { class: 'drop', tabindex: '0', role: 'button', 'aria-label': 'Choose a file', onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) { input.files = e.dataTransfer.files; input.dispatchEvent(new Event('change')); } } },
      icon('upload'), fileName, h('span', { class: 'sub' }, 'or drag it here'));
    const modal = h('div', { class: 'modal wide' }, logo(), h('h3', {}, 'Bulk upload courses'),
      h('p', {}, 'One course per row. Columns: ', h('b', {}, 'Course'), ', ', h('b', {}, 'Category'), ' (leave blank or write None to price by hand), and ', h('b', {}, 'Online rate'), ' / ', h('b', {}, 'Offline rate'), ' (required when the category is None).'),
      drop, input,
      h('div', { class: 'toolbar', style: 'margin:10px 0 0' }, h('button', { class: 'btn sm', type: 'button', onclick: () => B.download('course-upload-template.csv', TEMPLATE) }, 'Download template (CSV)'),
        h('span', { class: 'grow' }), h('span', { class: 'dupl' }, 'If a course already exists:'), radio('skip', 'Skip it'), radio('update', 'Update it')),
      out,
      h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), confirm));
    close = openModal(modal);
  }

  /* ---- Backup ---- */
  function tabData(body) {
    const file = h('input', { type: 'file', id: 'importFile', accept: 'application/json,.json', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { admin.draft = JSON.parse(await f.text()); toast('Imported into the draft. Review it, then save.'); drawAdmin(); } catch (err) { toast('That is not a valid JSON file'); }
    } });
    const day = new Date().toISOString().slice(0, 10);
    body.append(h('div', { class: 'card form-card' },
      h('div', { class: 'field' }, h('h3', { class: 'sub' }, 'Back up or move settings'), h('p', { class: 'p' }, 'Everything (rates, formulas, courses) in one JSON file. Importing loads it into the draft; nothing changes until you save.'),
        h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: () => B.download(`course-calculator-config-${day}.json`, JSON.stringify(admin.draft, null, 1)) }, 'Download config'), h('button', { class: 'btn', onclick: () => file.click() }, 'Import config…'), file)),
      h('div', { class: 'field' }, h('h3', { class: 'sub' }, 'Courses as CSV'),
        h('button', { class: 'btn', onclick: () => {
          const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
          B.download('courses.csv', '\ufeffCourse,Category,Online rate,Offline rate,Source\n' + admin.draft.courses.map((c) => [c.name, c.category || 'None', effRate(c, 'Online') ?? '', effRate(c, 'Offline') ?? '', c.basis].map(esc).join(',')).join('\n'));
        } }, 'Download courses')),
      h('div', { class: 'field' }, h('h3', { class: 'sub' }, 'Reset'), h('p', { class: 'p' }, 'Go back to the original Excel data and the default formulas. This replaces all live settings.'),
        h('button', { class: 'btn danger', onclick: async () => {
          if (!(await ask({ title: 'Reset everything?', body: 'All rates, formulas and courses return to their defaults. This cannot be undone.', ok: 'Reset', danger: true }))) return;
          try { await B.reset(); toast('Reset to defaults'); renderAdmin(true); } catch (e) { toast('Reset failed: ' + e.message); }
        } }, 'Reset to defaults')),
      B.adminNote ? h('p', { class: 'note' }, B.adminNote) : null));
  }

  renderShell();
  renderCalc();
  B.start && B.start();
})();
