// Simple Budget — monthly spend caps per category, receipt scanning, shared between two phones.
(() => {
  'use strict';

  const VERSION = '1.0';
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const lsGet = (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

  const DEFAULT_CATEGORIES = [
    { id: 'dining', name: 'Dining Out', emoji: '🍽️', cap: 0, lineItems: false },
    { id: 'groceries', name: 'Groceries', emoji: '🛒', cap: 0, lineItems: true },
  ];

  const state = {
    tab: lsGet('sb.tab', 'dining'),
    settings: { startDay: 27, categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), apiKey: '' },
    cycles: {},
    expenses: [],
    viewKey: null,          // cycle being viewed; null = the current one
    mode: {},               // catId -> 'receipts' | 'items'
    group: '',              // item-group filter on the "What we bought" view
    search: '',
    showAll: false,
    explain: {},            // `${catId}|${key}` -> text
    deviceName: lsGet('sb.name', ''),
    idx: null,
    ring: { key: '', off: 0 },
  };

  // ======================================================================
  // Formatting + dates
  // ======================================================================
  function money(n, whole) {
    const v = Number(n) || 0;
    const a = Math.abs(v);
    const s = whole ? Math.round(a).toLocaleString('en-US') : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '-' : '') + '$' + s;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => toISO(new Date());
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmtShort = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  function fmtDate(iso) {
    if (!iso) return '';
    const d = parseISO(iso);
    return `${DOW[d.getDay()]}, ${fmtShort(d)}${d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : ''}`;
  }
  const fmtTimestamp = (ms) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });


  // ======================================================================
  // Icons + budget tone
  // ======================================================================
  const svg = (inner) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICON = {
    dining: svg('<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>'),
    groceries: svg('<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>'),
    calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    settings: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
    camera: svg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    wallet: svg('<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>'),
    chart: svg('<path d="M5 21v-6M12 21V3M19 21V9"/>'),
    receipt: svg('<path d="M4 2v20l3-2 2.5 2L12 20l2.5 2L17 20l3 2V2l-3 2-2.5-2L12 4 9.5 2 7 4z"/><path d="M8 9h8M8 13h8"/>'),
    basket: svg('<path d="m5 11 4-7M19 11l-4-7M2 11h20"/><path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4"/><path d="M9 15v2M12 15v2M15 15v2"/>'),
    cloche: svg('<path d="M3 18h18"/><path d="M5 18a7 7 0 0 1 14 0"/><path d="M12 8V6M10 5.5h4"/><path d="M12 2v1M5.6 4.6l.7.7M18.4 4.6l-.7.7"/>'),
  };
  const catIcon = (cat) => (cat && ICON[cat.id]) || (cat && cat.emoji ? `<span class="emo">${esc(cat.emoji)}</span>` : ICON.receipt);
  // Green under 75% of the cap, amber from 75%, red at 100% or more.
  const toneFor = (spent, cap) => (cap > 0 ? (spent >= cap ? 'bad' : spent / cap >= 0.75 ? 'warn' : '') : '');

  // ======================================================================
  // Budget cycles ("months" that start on the Nth)
  // ======================================================================
  const effStart = (y, m, sd) => Math.min(sd, new Date(y, m + 1, 0).getDate());

  function cycleFromStart(sy, sm, sd) {
    const start = new Date(sy, sm, effStart(sy, sm, sd));
    let ey = sy, em = sm + 1;
    if (em > 11) { em = 0; ey++; }
    const end = new Date(ey, em, effStart(ey, em, sd) - 1);
    return { key: toISO(start), start, end, days: Math.round((end - start) / 864e5) + 1 };
  }
  function cycleContaining(iso, sd) {
    const [y, m, d] = iso.split('-').map(Number);
    let sy = y, sm = m - 1;
    if (d < effStart(sy, sm, sd)) { sm--; if (sm < 0) { sm = 11; sy--; } }
    return cycleFromStart(sy, sm, sd);
  }
  function shiftCycle(c, delta, sd) {
    let y = c.start.getFullYear(), m = c.start.getMonth() + delta;
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    return cycleFromStart(y, m, sd);
  }
  const currentCycle = () => cycleContaining(todayISO(), state.settings.startDay);
  function cycleByKey(key) {
    const [y, m] = key.split('-').map(Number);
    return cycleFromStart(y, m - 1, state.settings.startDay);
  }
  function cycleLabel(c) {
    const y = new Date().getFullYear();
    const yr = c.end.getFullYear() !== y || c.start.getFullYear() !== y ? `, ${c.end.getFullYear()}` : '';
    return `${fmtShort(c.start)} – ${fmtShort(c.end)}${yr}`;
  }

  // ======================================================================
  // Derived data
  // ======================================================================
  const cats = () => state.settings.categories.filter((c) => !c.archived);
  const catById = (id) => state.settings.categories.find((c) => c.id === id);

  function index() {
    if (state.idx) return state.idx;
    const sd = state.settings.startDay;
    const byCycle = {};
    for (const e of state.expenses) {
      const date = e.date || toISO(new Date(e.createdAt || Date.now()));
      (byCycle[cycleContaining(date, sd).key] ||= []).push(e);
    }
    state.idx = byCycle;
    return byCycle;
  }
  const cycleExpenses = (key) => index()[key] || [];
  const expensesIn = (key, catId) => cycleExpenses(key).filter((e) => e.category === catId);
  const sum = (rows) => rows.reduce((t, e) => t + (Number(e.total) || 0), 0);
  const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0);
  const capFor = (cat, key) => {
    const snap = state.cycles[key] && state.cycles[key].caps && state.cycles[key].caps[cat.id];
    return snap != null ? snap : (cat.cap || 0);
  };
  function catsFor(key) {
    return state.settings.categories.filter((c) => !c.archived || expensesIn(key, c.id).length);
  }

  function allCycles() {
    const sd = state.settings.startDay;
    const cur = currentCycle();
    let first = cur.key;
    for (const k of Object.keys(index())) if (k < first) first = k;
    const out = [];
    let c = cur;
    for (let i = 0; i < 240; i++) {
      out.push(c);
      if (c.key <= first) break;
      c = shiftCycle(c, -1, sd);
    }
    return out;
  }

  // ======================================================================
  // Persistence helpers
  // ======================================================================
  function saveSettings() { Store.put('settings', 'main', JSON.parse(JSON.stringify(state.settings))); }
  function writeCycle(key, patch) {
    const merged = { ...(state.cycles[key] || {}), ...patch };
    delete merged.id;
    state.cycles[key] = merged;
    Store.put('cycles', key, JSON.parse(JSON.stringify(merged)));
  }
  function changeCap(cat, newCap) {
    // Freeze past months that were relying on the old default so history keeps the cap they had.
    const cur = currentCycle();
    for (const c of allCycles()) {
      if (c.key === cur.key) continue;
      const doc = state.cycles[c.key] || {};
      if (doc.caps && doc.caps[cat.id] != null) continue;
      if (!expensesIn(c.key, cat.id).length) continue;
      writeCycle(c.key, { caps: { ...(doc.caps || {}), [cat.id]: cat.cap || 0 } });
    }
    cat.cap = newCap;
    saveSettings();
  }

  // ======================================================================
  // UI plumbing
  // ======================================================================
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function openSheet(html) {
    const root = $('#modalRoot');
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `<div class="sheet">${html}</div>`;
    root.appendChild(el);
    document.body.classList.add('noscroll');
    requestAnimationFrame(() => el.classList.add('open'));
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) closeSheet(el); });
    return el;
  }
  function closeSheet(el) {
    el.classList.remove('open');
    setTimeout(() => {
      el.remove();
      if (!$('#modalRoot').children.length) document.body.classList.remove('noscroll');
    }, 200);
  }

  function lightbox(src) {
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `<img src="${src}" alt="Receipt">`;
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  }

  // ======================================================================
  // Rendering
  // ======================================================================
  function render(force) {
    if (state.tab === 'settings' && !force) return;
    document.body.dataset.bg = state.tab === 'groceries' ? 'groceries' : 'dining';
    const view = $('#view');
    renderTabbar();
    if (state.tab === 'settings') { view.innerHTML = settingsHtml(); return; }
    if (state.tab === 'history') { view.innerHTML = historyHtml(); return; }
    const cat = catById(state.tab) && !catById(state.tab).archived ? catById(state.tab) : cats()[0];
    if (!cat) { state.tab = 'settings'; render(true); return; }
    state.tab = cat.id;
    view.innerHTML = categoryHtml(cat);
    const ring = $('.ring-fill');
    if (ring) requestAnimationFrame(() => requestAnimationFrame(() => { ring.style.strokeDashoffset = ring.dataset.target; }));
  }

  function renderTabbar() {
    const tabs = [
      ...cats().map((c) => ({ id: c.id, ico: catIcon(c), label: c.name })),
      { id: 'history', ico: ICON.calendar, label: 'History' },
      { id: 'settings', ico: ICON.settings, label: 'Settings' },
    ];
    $('#tabbar').innerHTML = tabs.map((t) =>
      `<button class="tab${t.id === state.tab ? ' active' : ''}" data-act="tab" data-id="${esc(t.id)}"><span class="tab-ico">${t.ico}</span>${esc(t.label)}</button>`
    ).join('');
  }

  function viewCycle() {
    return state.viewKey ? cycleByKey(state.viewKey) : currentCycle();
  }

  const RING_R = 96;
  const RING_C = 2 * Math.PI * RING_R;

  function heroHtml(cat, cycle, rows) {
    const cur = currentCycle();
    const isCur = cycle.key === cur.key;
    const cap = capFor(cat, cycle.key);
    const spent = sum(rows);
    const left = cap - spent;
    const ratio = cap > 0 ? spent / cap : 0;
    const tone = toneFor(spent, cap);
    const earliest = allCycles().slice(-1)[0].key;

    // The ring animates from where it last was (or empty) to the real percentage.
    const target = RING_C * (1 - Math.min(1, ratio));
    const ringKey = `${cat.id}|${cycle.key}`;
    const startOff = state.ring.key === ringKey ? state.ring.off : RING_C;
    state.ring = { key: ringKey, off: target };

    let big, sub, pill, tiles, pace = '';
    if (cap > 0) {
      big = money(Math.abs(left), true);
      sub = left >= 0 ? `${isCur ? 'left' : 'under'} of ${money(cap, true)}` : `over ${money(cap, true)}`;
      pill = `<span class="pill ${tone}">${Math.round(ratio * 100)}% used</span>`;
      tiles = [
        ['', ICON.wallet, money(cap, true), 'Monthly Budget'],
        ['mint', ICON.wallet, money(Math.abs(left), true), left >= 0 ? 'Remaining' : 'Over'],
        ['', ICON.chart, `${Math.round(ratio * 100)}%`, 'Used'],
      ];
      if (isCur) {
        const daysLeft = Math.max(1, Math.round((cycle.end - parseISO(todayISO())) / 864e5) + 1);
        pace = left > 0
          ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left · about ${money(left / daysLeft, true)}/day`
          : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in this month`;
      }
    } else {
      big = money(spent, true);
      sub = 'spent this month';
      pill = `<button class="pill" data-act="tab" data-id="settings">Set a budget →</button>`;
      tiles = [
        ['', ICON.wallet, 'Not set', 'Monthly Budget'],
        ['mint', ICON.wallet, money(spent, true), 'Spent'],
        ['', ICON.receipt, String(rows.length), 'Receipts'],
      ];
    }
    return `
      <section class="hero">
        <div class="hero-top">
          <button class="nav-btn" data-act="prev" ${cycle.key <= earliest ? 'disabled' : ''} aria-label="Previous month">‹</button>
          <div class="cycle-label">${esc(cycleLabel(cycle))}<small>${isCur ? 'This month' : 'Past month'}</small></div>
          <button class="nav-btn" data-act="next" ${isCur ? 'disabled' : ''} aria-label="Next month">›</button>
        </div>
        <button class="cat-title" data-act="catpicker" aria-label="Switch category">${catIcon(cat)}<span>${esc(cat.name)}</span><span class="chev">⌄</span></button>
        <div class="ring-wrap">
          <svg class="ring" viewBox="0 0 220 220" aria-hidden="true">
            <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#37a06a"/><stop offset="1" stop-color="#0d5230"/></linearGradient></defs>
            <circle class="ring-track" cx="110" cy="110" r="${RING_R}"/>
            <circle class="ring-fill ${tone}" cx="110" cy="110" r="${RING_R}" style="stroke-dasharray:${RING_C};stroke-dashoffset:${startOff};${ratio > 0 ? '' : 'opacity:0'}" data-target="${target}"/>
          </svg>
          <div class="ring-center">
            <div class="big-number ${tone === 'bad' ? 'over' : ''}">${big}</div>
            <div class="ring-sub">${sub}</div>
            <div class="ring-rule"></div>
            ${pill}
          </div>
        </div>
        <div class="stat-row">${tiles.map(([cls, ico, val, label]) => `<div class="stat ${cls}">${ico}<b>${val}</b><span>${label}</span></div>`).join('')}</div>
        ${pace ? `<div class="pace">${pace}</div>` : ''}
        ${cap > 0 ? `<div class="pace">${cat.lineItems
          ? `<button class="link-btn" data-act="mode" data-mode="items" data-cat="${esc(cat.id)}">${ICON.chart} View spending insights →</button>`
          : `<button class="link-btn" data-act="tab" data-id="history">${ICON.calendar} View monthly history →</button>`}</div>` : ''}
      </section>`;
  }

  function rowHtml(e) {
    const cat = catById(e.category) || {};
    const thumb = e.thumb
      ? `<img class="row-thumb" src="${e.thumb}" alt="">`
      : `<div class="row-thumb">${catIcon(cat)}</div>`;
    const bits = [fmtDate(e.date)];
    if (e.items && e.items.length) bits.push(`${e.items.length} item${e.items.length === 1 ? '' : 's'}`);
    if (e.by) bits.push(esc(e.by));
    return `<li><button class="row" data-act="open" data-id="${esc(e.id)}">
      ${thumb}
      <div class="row-main"><div class="row-title">${esc(e.vendor || 'Receipt')}</div><div class="row-sub">${bits.join(' · ')}</div></div>
      <div class="row-amt">${money(e.total)}</div>
    </button></li>`;
  }

  function categoryHtml(cat) {
    const cycle = viewCycle();
    const rows = expensesIn(cycle.key, cat.id).sort(byDateDesc);
    const mode = cat.lineItems ? (state.mode[cat.id] || 'receipts') : 'receipts';
    let body;
    if (mode === 'items') {
      body = insightsHtml(cat, cycle, rows);
    } else if (rows.length) {
      body = `<div class="section-title">${rows.length} receipt${rows.length === 1 ? '' : 's'}</div><ul class="list">${rows.map(rowHtml).join('')}</ul>`;
    } else {
      body = `<div class="empty-card">${cat.id === 'dining' ? ICON.cloche : cat.id === 'groceries' ? ICON.basket : catIcon(cat)}<h3>No ${esc(cat.name)} Expenses Yet</h3><p>Scan a receipt or add an expense to start tracking your ${esc(cat.name.toLowerCase())} spending.</p></div>`;
    }
    return `
      ${heroHtml(cat, cycle, rows)}
      <div class="actions">
        <button class="btn primary" data-act="scan" data-cat="${esc(cat.id)}">${ICON.camera}Scan Receipt</button>
        <button class="btn" data-act="add" data-cat="${esc(cat.id)}">${ICON.plus}Add Expense</button>
      </div>
      ${cat.lineItems ? `<div class="seg"><button class="${mode === 'receipts' ? 'active' : ''}" data-act="mode" data-mode="receipts" data-cat="${esc(cat.id)}">Receipts</button><button class="${mode === 'items' ? 'active' : ''}" data-act="mode" data-mode="items" data-cat="${esc(cat.id)}">What we bought</button></div>` : ''}
      ${body}`;
  }

  // ---------- "What we bought" ----------
  function flatItems(rows) {
    const out = [];
    for (const e of rows) for (const it of e.items || []) out.push({ ...it, vendor: e.vendor, date: e.date, expId: e.id });
    return out;
  }
  function groupTotals(items) {
    const m = {};
    for (const it of items) m[it.group || 'Other'] = (m[it.group || 'Other'] || 0) + (Number(it.price) || 0);
    return m;
  }

  function insightsHtml(cat, cycle, rows) {
    const items = flatItems(rows);
    if (!items.length) {
      return `<div class="empty"><span class="emoji">🧺</span>No line items yet this month.<br>Scan a receipt and the app will read what you bought.</div>`;
    }
    const prev = shiftCycle(cycle, -1, state.settings.startDay);
    const prevItems = flatItems(expensesIn(prev.key, cat.id));
    const g = groupTotals(items);
    const pg = groupTotals(prevItems);
    const order = Object.keys(g).sort((a, b) => g[b] - g[a]);
    const max = Math.max(...order.map((k) => g[k]), 1);
    const itemsTotal = items.reduce((t, i) => t + (Number(i.price) || 0), 0);
    const receiptsTotal = sum(rows);
    const hasPrev = prevItems.length > 0;

    const bars = order.map((k) => {
      let delta = '';
      if (hasPrev) {
        const d = g[k] - (pg[k] || 0);
        if (Math.abs(d) >= 1) delta = `<small class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${money(Math.abs(d), true)}</small>`;
      }
      return `<button class="grp${state.group === k ? ' sel' : ''}" data-act="grp" data-g="${esc(k)}">
        <span class="grp-name">${esc(k)}</span>
        <span class="grp-bar"><i style="width:${(g[k] / max) * 100}%"></i></span>
        <span class="grp-amt">${money(g[k], true)}${delta}</span></button>`;
    }).join('');

    const q = state.search.trim().toLowerCase();
    let list = items.filter((i) => (!state.group || (i.group || 'Other') === state.group) && (!q || i.name.toLowerCase().includes(q) || (i.vendor || '').toLowerCase().includes(q)));
    list.sort((a, b) => b.price - a.price);
    const shown = state.showAll ? list : list.slice(0, 25);
    const key = `${cat.id}|${cycle.key}`;

    return `
      <div class="card">
        <h4>By food group${hasPrev ? ' <span class="hint">· vs last month</span>' : ''}</h4>
        ${bars}
        <p>Items add up to ${money(itemsTotal)} of ${money(receiptsTotal)} on receipts${receiptsTotal - itemsTotal > 1 ? ' (the rest is mostly tax or lines that couldn\'t be read)' : ''}.</p>
      </div>
      <div class="card">
        <h4>✨ Why was this month ${receiptsTotal > capFor(cat, cycle.key) && capFor(cat, cycle.key) > 0 ? 'high' : 'this much'}?</h4>
        ${state.explain[key] ? `<p>${esc(state.explain[key])}</p>` : `<button class="btn small" data-act="explain" data-cat="${esc(cat.id)}">Ask Claude to explain</button>`}
      </div>
      <input class="search" id="itemSearch" type="search" placeholder="Search items or stores…" value="${esc(state.search)}">
      <div class="section-title">${state.group ? esc(state.group) : 'All items'} · ${list.length} (biggest first)</div>
      <div class="card" style="margin-top:0">
        ${shown.map((i) => `<div class="item-line"><div class="nm">${esc(i.name)}<small>${esc(i.vendor || '')} · ${esc(fmtShort(parseISO(i.date || todayISO())))}</small></div><div class="pr">${money(i.price)}</div></div>`).join('') || '<p>No matches.</p>'}
        ${list.length > shown.length ? `<button class="link-btn" data-act="showall" style="margin-top:8px">Show all ${list.length}</button>` : ''}
      </div>`;
  }

  async function explainMonth(cat) {
    const cycle = viewCycle();
    const sd = state.settings.startDay;
    const prev = shiftCycle(cycle, -1, sd);
    const describe = (c) => {
      const rows = expensesIn(c.key, cat.id);
      const items = flatItems(rows);
      return { rows, items, g: groupTotals(items), total: sum(rows) };
    };
    const a = describe(cycle), b = describe(prev);
    const fmtG = (g) => Object.entries(g).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${money(v)}`).join(', ') || 'none';
    const top = [...a.items].sort((x, y) => y.price - x.price).slice(0, 20).map((i) => `${i.name} ${money(i.price)} (${i.vendor || '?'}, ${i.date})`).join('; ');
    const stores = {};
    a.rows.forEach((e) => { stores[e.vendor || '?'] = (stores[e.vendor || '?'] || 0) + e.total; });
    const text = `Category: ${cat.name}. Month: ${cycleLabel(cycle)}.
This month: ${money(a.total)} over ${a.rows.length} receipts (cap ${money(capFor(cat, cycle.key))}).
Last month (${cycleLabel(prev)}): ${money(b.total)} over ${b.rows.length} receipts.
Food groups this month: ${fmtG(a.g)}.
Food groups last month: ${fmtG(b.g)}.
Receipts by store this month: ${Object.entries(stores).map(([k, v]) => `${k} ${money(v)}`).join(', ')}.
Biggest items this month: ${top}.`;
    return Claude.explain(text, state.settings.apiKey);
  }

  // ---------- History ----------
  function historyHtml() {
    const cycles = allCycles();
    const cards = cycles.map((c) => {
      const rows = cycleExpenses(c.key);
      const minis = catsFor(c.key).map((cat) => {
        const spent = sum(expensesIn(c.key, cat.id));
        const cap = capFor(cat, c.key);
        const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
        const cls = toneFor(spent, cap);
        return `<div class="mini"><div class="mini-top"><span>${catIcon(cat)} ${esc(cat.name)}</span><span>${money(spent, true)}${cap > 0 ? ' / ' + money(cap, true) : ''}</span></div>${cap > 0 ? `<div class="progress-track"><div class="progress-fill ${cls}" style="width:${pct}%"></div></div>` : ''}</div>`;
      }).join('');
      return `<li><button class="month-card" data-act="month" data-key="${c.key}">
        <div class="mc-head"><span>${esc(cycleLabel(c))}</span><span>${money(sum(rows), true)}</span></div>${minis}</button></li>`;
    }).join('');
    return `<div class="settings"><h2>History</h2>
      <div class="hint" style="margin:0 16px 12px">Tap a month to see every receipt or build a report.</div>
      <ul class="list">${cards}</ul></div>`;
  }

  function openMonth(key) {
    const cycle = cycleByKey(key);
    const rows = cycleExpenses(key).sort(byDateDesc);
    const sums = catsFor(key).map((cat) => {
      const spent = sum(expensesIn(key, cat.id));
      const cap = capFor(cat, key);
      return `<div class="item-line"><div class="nm">${catIcon(cat)} ${esc(cat.name)}${cap > 0 ? `<small>cap ${money(cap, true)} · ${cap - spent >= 0 ? money(cap - spent) + ' left' : money(spent - cap) + ' over'}</small>` : ''}</div><div class="pr">${money(spent)}</div></div>`;
    }).join('');
    const el = openSheet(`
      <div class="sheet-head"><h3>${esc(cycleLabel(cycle))}</h3><button class="x-btn" data-close>✕</button></div>
      <div class="sheet-body">
        <div class="card" style="margin:0">${sums}</div>
        <button class="btn primary" data-sheet="report">📄 Review &amp; export report</button>
        <div class="field-label" style="margin:0">All receipts</div>
        ${rows.length ? `<ul class="list" style="padding:0">${rows.map(rowHtml).join('')}</ul>` : '<div class="empty">No receipts this month.</div>'}
      </div>`);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-sheet="report"]')) openReport(key);
      const open = e.target.closest('[data-act="open"]');
      if (open) { e.stopPropagation(); openForm({ id: open.dataset.id }); }
    });
  }

  // ======================================================================
  // Receipt form (add / edit / scan)
  // ======================================================================
  function openForm({ catId, id, file }) {
    const existing = id ? state.expenses.find((e) => e.id === id) : null;
    const cat = catById(existing ? existing.category : catId);
    if (!cat) return;
    const ctx = {
      image: null,
      items: existing && existing.items ? existing.items.map((i) => ({ ...i })) : [],
    };

    const el = openSheet(`
      <div class="sheet-head"><h3>${existing ? 'Edit' : 'New'} · ${esc(cat.name)}</h3><button class="x-btn" data-close>✕</button></div>
      <div class="sheet-body">
        <div class="img-wrap" id="fImg" style="display:none"><img alt="Receipt"></div>
        <div class="status" id="fStatus" style="display:none"></div>
        <button class="btn" id="fPhoto">📸 ${existing && existing.hasImage ? 'Replace photo' : 'Add photo &amp; read it'}</button>
        <div><label class="field-label">Amount</label><div class="amount-wrap"><span>$</span><input id="fTotal" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${existing ? esc(existing.total) : ''}"></div></div>
        <div><label class="field-label">Where</label><input id="fVendor" type="text" placeholder="Restaurant or store" value="${esc(existing ? existing.vendor : '')}"></div>
        <div class="row-2">
          <div><label class="field-label">Date</label><input id="fDate" type="date" value="${esc(existing ? existing.date : todayISO())}"></div>
        </div>
        <div><label class="field-label">Address</label><input id="fAddress" type="text" placeholder="Optional" value="${esc(existing ? existing.address : '')}"></div>
        <div><label class="field-label">Notes</label><input id="fNotes" type="text" placeholder="Optional — birthday dinner, etc." value="${esc(existing ? existing.notes : '')}"></div>
        ${cat.lineItems ? `<div><label class="field-label">Items bought</label><div id="fItems"></div><div class="hint" id="fItemsNote"></div><button class="btn small" id="fAddItem" style="margin-top:8px">＋ Add item</button></div>` : ''}
        <button class="btn primary" id="fSave">Save</button>
        ${existing ? '<button class="btn danger" id="fDelete">Delete receipt</button>' : ''}
      </div>`);

    const q = (s) => $(s, el);
    const status = (msg, kind) => {
      const s = q('#fStatus');
      s.style.display = msg ? '' : 'none';
      s.className = 'status ' + (kind || '');
      s.textContent = msg || '';
    };
    const showImage = (src) => {
      q('#fImg').style.display = '';
      const img = q('#fImg img');
      img.src = src;
      img.onclick = () => lightbox(src);
    };

    function renderItems() {
      if (!cat.lineItems) return;
      q('#fItems').innerHTML = ctx.items.map((it, i) =>
        `<div class="item-row" data-i="${i}"><input class="it-n" type="text" value="${esc(it.name)}" placeholder="Item"><input class="it-p" type="number" inputmode="decimal" step="0.01" value="${esc(it.price)}"><button class="x-btn" data-rm="${i}">✕</button></div>`
      ).join('');
      const total = ctx.items.reduce((t, i) => t + (Number(i.price) || 0), 0);
      q('#fItemsNote').textContent = ctx.items.length ? `${ctx.items.length} items · ${money(total)} before tax` : 'No items yet — scan a receipt or add them by hand.';
    }
    renderItems();

    if (existing && existing.hasImage) {
      Store.get('images', existing.id).then((d) => { if (d && d.dataUrl) showImage(d.dataUrl); });
    }

    async function attachPhoto(f) {
      try {
        status('Preparing photo…', 'busy');
        ctx.image = await prepareImage(f);
        showImage(ctx.image.full);
        if (!state.settings.apiKey) { status('Add your Claude API key in Settings to read receipts automatically. You can type the details in for now.', 'warn'); return; }
        status('Reading receipt…', 'busy');
        const p = await Claude.parseReceipt(ctx.image.scan, state.settings.apiKey, cat, todayISO());
        if (p.total != null) q('#fTotal').value = p.total;
        if (p.vendor) q('#fVendor').value = p.vendor;
        if (p.date) q('#fDate').value = p.date;
        if (p.address) q('#fAddress').value = p.address;
        if (cat.lineItems) { ctx.items = p.items; renderItems(); }
        status('Got it — check the details, then Save.', 'ok');
      } catch (e) {
        status(e.message === 'NO_API_KEY' ? 'Add your Claude API key in Settings first.' : (e.message || 'Could not read that photo.') + ' You can fill it in by hand.', 'warn');
      }
    }

    q('#fPhoto').addEventListener('click', () => { photoCb = attachPhoto; $('#photoInput').click(); });
    if (cat.lineItems) {
      q('#fAddItem').addEventListener('click', () => { ctx.items.push({ name: '', price: 0, group: 'Other' }); renderItems(); });
      const box = q('#fItems');
      box.addEventListener('input', (e) => {
        const row = e.target.closest('.item-row');
        if (!row) return;
        const it = ctx.items[Number(row.dataset.i)];
        if (e.target.classList.contains('it-n')) it.name = e.target.value;
        else it.price = parseFloat(e.target.value) || 0;
        const total = ctx.items.reduce((t, i) => t + (Number(i.price) || 0), 0);
        q('#fItemsNote').textContent = `${ctx.items.length} items · ${money(total)} before tax`;
      });
      box.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rm]');
        if (rm) { ctx.items.splice(Number(rm.dataset.rm), 1); renderItems(); }
      });
    }

    q('#fSave').addEventListener('click', async () => {
      const total = parseFloat(q('#fTotal').value);
      const date = q('#fDate').value;
      if (!(total >= 0) || isNaN(total)) { toast('Enter the amount'); return; }
      if (!date) { toast('Pick a date'); return; }
      const vendor = q('#fVendor').value.trim();
      if (!existing) {
        const dupe = state.expenses.find((e) => e.category === cat.id && e.date === date && Math.abs(e.total - total) < 0.005 && (e.vendor || '').toLowerCase() === vendor.toLowerCase());
        if (dupe && !confirm('You already logged a receipt with the same store, date and amount. Add it again?')) return;
      }
      const eid = existing ? existing.id : uid();
      const exp = {
        id: eid,
        category: cat.id,
        vendor,
        total: Math.round(total * 100) / 100,
        date,
        address: q('#fAddress').value.trim(),
        notes: q('#fNotes').value.trim(),
        items: cat.lineItems ? ctx.items.filter((i) => i.name.trim() || i.price).map((i) => ({ name: i.name.trim(), price: Number(i.price) || 0, group: i.group || 'Other' })) : [],
        thumb: ctx.image ? ctx.image.thumb : (existing ? existing.thumb || null : null),
        hasImage: !!ctx.image || !!(existing && existing.hasImage),
        by: existing ? existing.by || '' : state.deviceName,
        createdAt: existing ? existing.createdAt : Date.now(),
        updatedAt: Date.now(),
      };
      const { id: _drop, ...data } = exp;
      await Store.put('expenses', eid, JSON.parse(JSON.stringify(data)));
      if (ctx.image) await Store.put('images', eid, { dataUrl: ctx.image.full });
      closeSheet(el);
      // Jump to the month this receipt landed in so it's visible straight away.
      if (state.tab === cat.id) {
        const landed = cycleContaining(date, state.settings.startDay).key;
        state.viewKey = landed === currentCycle().key ? null : landed;
      }
      toast(existing ? 'Saved' : `Added ${money(exp.total)}`);
    });

    if (existing) {
      q('#fDelete').addEventListener('click', async () => {
        if (!confirm('Delete this receipt?')) return;
        await Store.remove('expenses', existing.id);
        await Store.remove('images', existing.id);
        closeSheet(el);
        toast('Deleted');
      });
    }

    if (file) attachPhoto(file);
  }

  // ======================================================================
  // Photos
  // ======================================================================
  let photoCb = null;

  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
  }
  function scaleTo(img, max, q) {
    const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * r);
    c.height = Math.round(img.naturalHeight * r);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  }
  async function prepareImage(file) {
    const img = await loadImage(file);
    const scan = scaleTo(img, 1600, 0.85);
    let q = 0.65;
    let full = scaleTo(img, 1300, q);
    while (full.length > 850000 && q > 0.3) { q -= 0.1; full = scaleTo(img, 1300, q); }
    return { scan, full, thumb: scaleTo(img, 120, 0.6) };
  }

  // ======================================================================
  // Report (review before export)
  // ======================================================================
  function openReport(key) {
    const cycle = cycleByKey(key);
    const exps = cycleExpenses(key).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const rs = { off: new Set(), photos: true, items: false, note: (state.cycles[key] && state.cycles[key].note) || '' };
    const reportCats = catsFor(key);

    const el = openSheet(`
      <div class="sheet-head"><h3>Report · ${esc(cycleLabel(cycle))}</h3><button class="x-btn" data-close>✕</button></div>
      <div class="sheet-body">
        <div class="card" style="margin:0" id="rSummary"></div>
        <div><label class="field-label">Notes (printed on the report)</label><textarea id="rNote" placeholder="Anything worth remembering about this month…">${esc(rs.note)}</textarea></div>
        <label class="check-line"><input type="checkbox" id="rPhotos" checked> Include receipt photos</label>
        <label class="check-line"><input type="checkbox" id="rItems"> Include grocery line items</label>
        <div><div class="field-label">Receipts — untick any to leave out</div>
          ${exps.length ? exps.map((e) => `<label class="row-check" data-id="${esc(e.id)}"><input type="checkbox" checked><span style="flex:1;min-width:0"><b>${esc(e.vendor || 'Receipt')}</b><br><span class="hint">${esc(fmtDate(e.date))} · ${esc((catById(e.category) || {}).name || '')}</span></span><b>${money(e.total)}</b></label>`).join('') : '<div class="empty">No receipts this month.</div>'}
        </div>
        <button class="btn primary" id="rPrint">🖨️ Print / Save as PDF</button>
        <div class="row-2"><button class="btn" id="rCsv">Receipts CSV</button><button class="btn" id="rItemsCsv">Items CSV</button></div>
      </div>`);
    const q = (s) => $(s, el);
    const included = () => exps.filter((e) => !rs.off.has(e.id));

    function summary() {
      const inc = included();
      q('#rSummary').innerHTML = reportCats.map((cat) => {
        const spent = sum(inc.filter((e) => e.category === cat.id));
        const cap = capFor(cat, key);
        return `<div class="item-line"><div class="nm">${catIcon(cat)} ${esc(cat.name)}${cap > 0 ? `<small>cap ${money(cap, true)} · ${cap - spent >= 0 ? money(cap - spent) + ' left' : money(spent - cap) + ' over'}</small>` : ''}</div><div class="pr">${money(spent)}</div></div>`;
      }).join('') + `<div class="item-line"><div class="nm"><b>Total</b></div><div class="pr">${money(sum(inc))}</div></div>`;
    }
    summary();

    el.addEventListener('change', (e) => {
      const row = e.target.closest('.row-check');
      if (row) {
        if (e.target.checked) rs.off.delete(row.dataset.id); else rs.off.add(row.dataset.id);
        row.classList.toggle('off', !e.target.checked);
        summary();
      }
      if (e.target.id === 'rPhotos') rs.photos = e.target.checked;
      if (e.target.id === 'rItems') rs.items = e.target.checked;
    });
    q('#rNote').addEventListener('change', (e) => { rs.note = e.target.value; writeCycle(key, { note: rs.note }); });
    q('#rPrint').addEventListener('click', async () => {
      rs.note = q('#rNote').value;
      writeCycle(key, { note: rs.note });
      const btn = q('#rPrint');
      btn.disabled = true; btn.textContent = 'Preparing…';
      try { await printReport(cycle, reportCats, included(), rs); } finally { btn.disabled = false; btn.textContent = '🖨️ Print / Save as PDF'; }
    });
    q('#rCsv').addEventListener('click', () => {
      const rows = [['Date', 'Category', 'Where', 'Address', 'Total', 'Notes', 'Added by']];
      included().forEach((e) => rows.push([e.date, (catById(e.category) || {}).name || '', e.vendor, e.address, Number(e.total).toFixed(2), e.notes, e.by]));
      download(`budget-${key}-receipts.csv`, toCsv(rows));
    });
    q('#rItemsCsv').addEventListener('click', () => {
      const rows = [['Date', 'Store', 'Category', 'Item', 'Group', 'Price']];
      included().forEach((e) => (e.items || []).forEach((i) => rows.push([e.date, e.vendor, (catById(e.category) || {}).name || '', i.name, i.group, Number(i.price).toFixed(2)])));
      if (rows.length === 1) { toast('No line items in this month'); return; }
      download(`budget-${key}-items.csv`, toCsv(rows));
    });
  }

  const toCsv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function printReport(cycle, reportCats, inc, rs) {
    const images = {};
    if (rs.photos) {
      for (const e of inc) {
        if (!e.hasImage) continue;
        const d = await Store.get('images', e.id);
        if (d && d.dataUrl) images[e.id] = d.dataUrl;
      }
    }
    const prepared = state.deviceName || '';
    const summaryRows = reportCats.map((cat) => {
      const spent = sum(inc.filter((e) => e.category === cat.id));
      const cap = capFor(cat, cycle.key);
      return `<tr><td>${esc(cat.emoji)} ${esc(cat.name)}</td><td class="r">${cap > 0 ? money(cap) : '—'}</td><td class="r">${money(spent)}</td><td class="r">${cap > 0 ? money(cap - spent) : '—'}</td></tr>`;
    }).join('');
    const sections = reportCats.map((cat) => {
      const rows = inc.filter((e) => e.category === cat.id);
      if (!rows.length) return '';
      return `<h2>${esc(cat.name)} · ${money(sum(rows))}</h2>` + rows.map((e) => `
        <div class="pr">
          <div class="pr-head"><span>${esc(e.vendor || 'Receipt')}</span><span>${money(e.total)}</span></div>
          <div class="pr-sub">${esc(fmtDate(e.date))}${e.address ? ' · ' + esc(e.address) : ''}${e.by ? ' · ' + esc(e.by) : ''}${e.notes ? '<br>' + esc(e.notes) : ''}</div>
          ${rs.items && e.items && e.items.length ? `<table>${e.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.group)}</td><td class="r">${money(i.price)}</td></tr>`).join('')}</table>` : ''}
          ${images[e.id] ? `<img src="${images[e.id]}" alt="Receipt">` : ''}
        </div>`).join('');
    }).join('');
    const root = $('#printRoot');
    root.innerHTML = `
      <h1>Simple Budget — ${esc(cycleLabel(cycle))}</h1>
      <div class="meta">${prepared ? 'Prepared by ' + esc(prepared) + ' · ' : ''}${esc(new Date().toLocaleDateString())}</div>
      <table><tr><th>Category</th><th class="r">Cap</th><th class="r">Spent</th><th class="r">Left</th></tr>${summaryRows}
        <tr><td><b>Total</b></td><td></td><td class="r"><b>${money(sum(inc))}</b></td><td></td></tr></table>
      ${rs.note.trim() ? `<div class="note">${esc(rs.note)}</div>` : ''}
      ${sections}`;
    await Promise.all([...root.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
    window.print();
  }

  // ======================================================================
  // Settings
  // ======================================================================
  const googleOn = () => lsGet('sb.google') === '1';
  let syncFormOpen = false;

  function settingsHtml() {
    const s = state.settings;
    const active = s.categories.filter((c) => !c.archived);
    const archived = s.categories.filter((c) => c.archived);
    const catRows = active.map((c) => `
      <div class="cat-edit">
        <input data-set="catName" data-cat="${esc(c.id)}" value="${esc(c.name)}" aria-label="Name">
        <div class="amount-wrap"><span style="font-size:15px">$</span><input data-set="cap" data-cat="${esc(c.id)}" type="number" inputmode="decimal" min="0" step="1" value="${c.cap || ''}" placeholder="Cap" style="font-size:16px;font-weight:600"></div>
        <div class="full">
          <label class="check-line"><input type="checkbox" data-set="lineItems" data-cat="${esc(c.id)}" ${c.lineItems ? 'checked' : ''}> Read line items</label>
          <button class="link-btn" style="color:var(--bad)" data-act="s-rmcat" data-cat="${esc(c.id)}">Remove</button>
        </div>
      </div>`).join('');

    const syncBody = Store.mode === 'cloud'
      ? `<div class="hint">✅ Syncing as <b>${esc(Store.email)}</b>. Anything either of you adds shows up on both phones.</div>
         <button class="btn danger" data-act="s-sync-out">Turn off sync on this phone</button>`
      : `<div class="hint">Sync is off — receipts live only on this phone. Turn it on so you and your wife share one budget.</div>
         ${Store.syncError ? `<div class="status warn">${esc(Store.syncError)}</div>` : ''}
         <button class="btn" data-act="s-sync-show">${syncFormOpen ? 'Hide' : 'Set up sync'}</button>
         ${syncFormOpen ? `
           <input id="syncEmail" type="email" autocapitalize="off" placeholder="Household email (you both use the same one)">
           <input id="syncPass" type="password" placeholder="Household password">
           <div class="row-2"><button class="btn primary" data-act="s-sync-create">Create household</button><button class="btn" data-act="s-sync-in">Sign in</button></div>
           <div class="hint"><b>First phone:</b> Create household. <b>Second phone:</b> Sign in with the same email and password.</div>` : ''}`;

    const connected = googleOn();
    const lastBackup = lsGet('sb.lastBackup');

    return `<div class="settings">
      <h2>Settings</h2>

      <div class="s-card">
        <h4>Month</h4>
        <label class="field-label" style="margin:0">Budget month starts on the</label>
        <select data-set="startDay">${Array.from({ length: 28 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${d === s.startDay ? 'selected' : ''}>${d}${['th', 'st', 'nd', 'rd'][(d % 100 > 10 && d % 100 < 14) ? 0 : (d % 10 < 4 ? d % 10 : 0)]}</option>`).join('')}</select>
        <div class="hint">Each month runs from this day to the day before the next one, then resets. Changing it re-sorts every receipt into months by its date.</div>
      </div>

      <div class="s-card">
        <h4>Categories &amp; monthly caps</h4>
        ${catRows}
        <div class="hint">"Read line items" makes the scanner record every product on the receipt and unlocks the What we bought view.</div>
        <div class="field-label" style="margin:4px 0 0">Add a category</div>
        <div class="row-2" style="flex-wrap:wrap">
          <input id="ncEmoji" value="🧾" maxlength="4" style="flex:0 0 64px;text-align:center">
          <input id="ncName" placeholder="Name (e.g. Coffee)">
        </div>
        <div class="row-2"><input id="ncCap" type="number" inputmode="decimal" placeholder="Monthly cap ($)"><label class="check-line"><input type="checkbox" id="ncItems"> Read line items</label></div>
        <button class="btn" data-act="s-addcat">＋ Add category</button>
        ${archived.length ? `<div class="hint">Removed (receipts kept): ${archived.map((c) => `${esc(c.name)} <button class="link-btn" data-act="s-restore" data-cat="${esc(c.id)}">restore</button>`).join(' · ')}</div>` : ''}
      </div>

      <div class="s-card">
        <h4>This phone</h4>
        <div><label class="field-label">Your name (shown on receipts you add)</label><input data-set="device" value="${esc(state.deviceName)}" placeholder="e.g. Jordan"></div>
        <div><label class="field-label">Claude API key</label><input data-set="apiKey" type="password" autocomplete="off" value="${esc(s.apiKey)}" placeholder="sk-ant-…"><div class="hint" style="margin-top:6px">Reads your receipts (from console.anthropic.com). With sync on, the key is shared so your wife doesn't need to enter it.</div></div>
      </div>

      <div class="s-card"><h4>Share with your wife</h4>${syncBody}</div>

      <div class="s-card">
        <h4>Backup to Google Drive</h4>
        ${connected ? `
          <div class="hint">${lastBackup ? 'Last backed up ' + esc(fmtTimestamp(Number(lastBackup))) : 'Not backed up yet.'}</div>
          <button class="btn primary" data-act="s-g-backup">Back up now</button>
          <button class="btn" data-act="s-g-restore">Restore from backup</button>
          <button class="link-btn" data-act="s-g-out">Disconnect Google</button>`
        : `<div class="hint">A safety copy of everything, saved in your own Google Drive.</div><button class="btn" data-act="s-g-connect">Connect Google Drive</button>`}
      </div>

      <div class="s-card">
        <h4>App</h4>
        <div class="hint">Simple Budget v${VERSION}</div>
        <button class="btn" data-act="s-refresh">Force refresh app</button>
      </div>
    </div>`;
  }

  async function handleSettingsAction(act, t) {
    const s = state.settings;
    if (act === 's-addcat') {
      const name = $('#ncName').value.trim();
      if (!name) { toast('Give the category a name'); return; }
      s.categories.push({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) + '-' + uid().slice(0, 4), name, emoji: $('#ncEmoji').value.trim() || '🧾', cap: parseFloat($('#ncCap').value) || 0, lineItems: $('#ncItems').checked });
      saveSettings(); render(true); toast(`Added ${name}`);
    } else if (act === 's-rmcat') {
      const cat = catById(t.dataset.cat);
      if (cats().length <= 1) { toast('Keep at least one category'); return; }
      const used = state.expenses.some((e) => e.category === cat.id);
      if (!confirm(used ? `Hide "${cat.name}"? Its receipts stay in your history and reports.` : `Delete "${cat.name}"?`)) return;
      if (used) cat.archived = true; else s.categories = s.categories.filter((c) => c.id !== cat.id);
      saveSettings(); render(true);
    } else if (act === 's-restore') {
      catById(t.dataset.cat).archived = false; saveSettings(); render(true);
    } else if (act === 's-sync-show') {
      syncFormOpen = !syncFormOpen; render(true);
    } else if (act === 's-sync-create' || act === 's-sync-in') {
      await connectSync(act === 's-sync-create');
    } else if (act === 's-sync-out') {
      if (!confirm('Turn off sync on this phone? The shared data stays in the cloud; this phone goes back to local-only.')) return;
      await Store.signOut(); location.reload();
    } else if (act === 's-g-connect') {
      try { await ensureGoogleToken(); lsSet('sb.google', '1'); render(true); toast('Connected to Google'); } catch (e) { toast(e.message); }
    } else if (act === 's-g-backup') {
      await driveBackup(t);
    } else if (act === 's-g-restore') {
      await driveRestore(t);
    } else if (act === 's-g-out') {
      lsSet('sb.google', '0'); googleToken = null; render(true);
    } else if (act === 's-refresh') {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      for (const k of await caches.keys()) await caches.delete(k);
      location.reload();
    }
  }

  async function connectSync(create) {
    try {
      const em = $('#syncEmail').value.trim(), pw = $('#syncPass').value;
      if (!em || !pw) { toast('Enter the household email and password'); return; }
      toast('Connecting…');
      const { localCount, cloudHas } = await Store.connect(em, pw, create);
      if (localCount > 0 && confirm(`Add the ${localCount} receipt${localCount === 1 ? '' : 's'} already on this phone to the shared budget?`)) {
        toast('Uploading…');
        await Store.uploadLocal(!cloudHas);
      }
      location.reload();
    } catch (e) { toast(e.message || 'Could not connect.'); }
  }

  // ---------- Google Drive backup ----------
  // Same pattern as the trip app: one JSON file in the user's own Drive (drive.file scope — the app
  // can only see files it created). The Anthropic API key is never included.
  const GOOGLE_CLIENT_ID = '324499494473-n0m48riklpl2e1rajniop7v55363ptjf.apps.googleusercontent.com';
  const BACKUP_FILENAME = 'simple-budget-backup.json';
  let googleClient = null, googleToken = null, googleTokenExp = 0;

  function initGoogle() {
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) { setTimeout(initGoogle, 400); return; }
    googleClient = google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.file', callback: () => {} });
  }
  function ensureGoogleToken() {
    return new Promise((resolve, reject) => {
      if (!googleClient) { reject(new Error('Google sign-in isn\'t ready yet — try again in a moment.')); return; }
      if (googleToken && Date.now() < googleTokenExp - 60000) { resolve(googleToken); return; }
      googleClient.callback = (r) => {
        if (r.error) { reject(new Error(`Google sign-in failed (${r.error}).`)); return; }
        googleToken = r.access_token; googleTokenExp = Date.now() + r.expires_in * 1000; resolve(googleToken);
      };
      googleClient.requestAccessToken({});
    });
  }
  async function driveFind(token) {
    const q = encodeURIComponent(`name='${BACKUP_FILENAME}' and trashed=false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Could not reach Google Drive.');
    return ((await res.json()).files || [])[0] || null;
  }
  async function driveBackup(btn) {
    btn.disabled = true;
    try {
      const token = await ensureGoogleToken();
      const { apiKey, ...settings } = state.settings;
      const payload = JSON.stringify({
        version: 1, app: 'simple-budget', exportedAt: Date.now(), settings,
        cycles: await Store.getAll('cycles'), expenses: await Store.getAll('expenses'), images: await Store.getAll('images'),
      });
      const existing = await driveFind(token);
      let res;
      if (existing) {
        res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: payload });
      } else {
        const b = 'sb' + Date.now();
        res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${b}` },
          body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: BACKUP_FILENAME, mimeType: 'application/json' })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${b}--`,
        });
      }
      if (!res.ok) throw new Error('Drive upload failed.');
      lsSet('sb.lastBackup', String(Date.now()));
      render(true); toast('Backed up to Google Drive');
    } catch (e) { toast(e.message || 'Backup failed.'); } finally { btn.disabled = false; }
  }
  async function driveRestore(btn) {
    if (!confirm('This REPLACES everything in the budget (on every synced phone) with your Google Drive backup. Continue?')) return;
    btn.disabled = true;
    try {
      const token = await ensureGoogleToken();
      const file = await driveFind(token);
      if (!file) { toast('No backup found in Google Drive yet.'); return; }
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Could not download the backup.');
      const p = await res.json();
      if (!p || p.app !== 'simple-budget' || !Array.isArray(p.expenses)) throw new Error('That backup file looks invalid.');
      for (const col of ['expenses', 'images', 'cycles']) for (const r of await Store.getAll(col)) await Store.remove(col, r.id);
      for (const r of p.expenses) { const { id, ...d } = r; await Store.put('expenses', id, d); }
      for (const r of p.images || []) { const { id, ...d } = r; await Store.put('images', id, d); }
      for (const r of p.cycles || []) { const { id, ...d } = r; await Store.put('cycles', id, d); }
      await Store.put('settings', 'main', { ...p.settings, apiKey: state.settings.apiKey });
      toast('Restored from Google Drive');
    } catch (e) { toast(e.message || 'Restore failed.'); } finally { btn.disabled = false; }
  }

  // ======================================================================
  // Events
  // ======================================================================
  document.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act.startsWith('s-')) { await handleSettingsAction(act, t); return; }

    if (act === 'catpicker') {
      const el = openSheet(`<div class="sheet-head"><h3>Category</h3><button class="x-btn" data-close>✕</button></div>
        <div class="sheet-body" style="gap:0">${cats().map((c) => `<button class="pick-row${c.id === state.tab ? ' sel' : ''}" data-act="tab" data-id="${esc(c.id)}">${catIcon(c)}<span>${esc(c.name)}</span></button>`).join('')}</div>`);
      return;
    }
    if (act === 'tab') {
      document.querySelectorAll('#modalRoot .overlay').forEach(closeSheet);
      state.tab = t.dataset.id; lsSet('sb.tab', state.tab);
      state.viewKey = null; state.group = ''; state.search = ''; state.showAll = false;
      render(true); window.scrollTo(0, 0);
    } else if (act === 'prev' || act === 'next') {
      state.viewKey = shiftCycle(viewCycle(), act === 'prev' ? -1 : 1, state.settings.startDay).key;
      if (state.viewKey === currentCycle().key) state.viewKey = null;
      state.group = ''; state.search = ''; state.showAll = false;
      render(true);
    } else if (act === 'scan') {
      const catId = t.dataset.cat;
      photoCb = (f) => openForm({ catId, file: f });
      $('#photoInput').click();
    } else if (act === 'add') {
      openForm({ catId: t.dataset.cat });
    } else if (act === 'open') {
      openForm({ id: t.dataset.id });
    } else if (act === 'mode') {
      state.mode[t.dataset.cat] = t.dataset.mode; state.group = ''; render(true);
    } else if (act === 'grp') {
      state.group = state.group === t.dataset.g ? '' : t.dataset.g; state.showAll = false; render(true);
    } else if (act === 'showall') {
      state.showAll = true; render(true);
    } else if (act === 'explain') {
      const cat = catById(t.dataset.cat);
      if (!state.settings.apiKey) { toast('Add your Claude API key in Settings first'); return; }
      t.disabled = true; t.textContent = 'Thinking…';
      try { state.explain[`${cat.id}|${viewCycle().key}`] = await explainMonth(cat); } catch (e) { toast(e.message); }
      render(true);
    } else if (act === 'month') {
      openMonth(t.dataset.key);
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'itemSearch') {
      state.search = e.target.value; state.showAll = false;
      const pos = e.target.selectionStart;
      render(true);
      const box = $('#itemSearch'); box.focus(); box.setSelectionRange(pos, pos);
    }
  });

  $('#photoInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    const cb = photoCb; photoCb = null;
    if (f && cb) cb(f);
  });

  document.addEventListener('change', (e) => {
    const set = e.target.dataset && e.target.dataset.set;
    if (!set) return;
    const s = state.settings;
    const cat = e.target.dataset.cat ? catById(e.target.dataset.cat) : null;
    if (set === 'startDay') { s.startDay = Number(e.target.value); state.idx = null; state.viewKey = null; saveSettings(); toast('Month now starts on the ' + e.target.value); }
    else if (set === 'cap') { changeCap(cat, Math.max(0, parseFloat(e.target.value) || 0)); toast('Cap saved'); }
    else if (set === 'catName') { if (e.target.value.trim()) { cat.name = e.target.value.trim(); saveSettings(); toast('Saved'); } }
    else if (set === 'lineItems') { cat.lineItems = e.target.checked; saveSettings(); toast('Saved'); }
    else if (set === 'device') { state.deviceName = e.target.value.trim(); lsSet('sb.name', state.deviceName); toast('Saved'); }
    else if (set === 'apiKey') { saveApiKey(e.target.value); toast('Saved'); }
  });

  // The key is saved on every keystroke/paste (not just on blur) and mirrored in localStorage, so a
  // re-render or a synced settings update can never wipe it.
  function saveApiKey(v) {
    const k = (v || '').trim();
    state.settings.apiKey = k;
    lsSet('sb.apikey', k);
    saveSettings();
  }
  document.addEventListener('input', (e) => {
    if (e.target.dataset && e.target.dataset.set === 'apiKey') saveApiKey(e.target.value);
  });

  // ======================================================================
  // Boot
  // ======================================================================
  function mergeSettings(row) {
    const base = { startDay: 27, categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), apiKey: lsGet('sb.apikey') || '' };
    if (!row) return base;
    return {
      startDay: row.startDay || 27,
      categories: Array.isArray(row.categories) && row.categories.length ? row.categories : base.categories,
      apiKey: row.apiKey || lsGet('sb.apikey') || '',
    };
  }

  async function boot() {
    Store.onError = (e) => toast('Sync problem: ' + ((e && e.message) || 'unknown'));
    await Store.init();
    if (Store.syncError && Store.hasConfig) {
      const b = $('#banner');
      b.style.display = '';
      b.textContent = '⚠︎ ' + Store.syncError;
    }
    Store.subscribe('settings', (rows) => {
      state.settings = mergeSettings(rows.find((r) => r.id === 'main'));
      state.idx = null; render();
    });
    Store.subscribe('cycles', (rows) => {
      state.cycles = {}; rows.forEach((r) => { const { id, ...d } = r; state.cycles[id] = d; });
      render();
    });
    Store.subscribe('expenses', (rows) => { state.expenses = rows; state.idx = null; render(); });
    render(true);
    initGoogle();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
  boot();
})();
