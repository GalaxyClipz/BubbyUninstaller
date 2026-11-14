const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = window.bubby;
const view = $('#view');
let info = { drives: [] };
let drive = '';
let screen = 'home';
let S = null; // deck state
const cache = new Map(); // scan cache: cat|drive -> items
const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const fmt = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(0) + ' MB' : b >= 1e3 ? (b / 1e3).toFixed(0) + ' KB' : (b || 0) + ' B');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const cap = (s) => s[0] + s.slice(1).toLowerCase();
function ago(v) {
  const t = typeof v === 'number' ? v : /^\d{8}$/.test(v || '') ? new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6)).getTime() : 0;
  if (!t) return '';
  const d = (Date.now() - t) / 864e5;
  return d < 1 ? 'today' : d < 30 ? `${Math.floor(d)}d ago` : d < 365 ? `${Math.floor(d / 30)}mo ago` : `${(d / 365).toFixed(1)}y ago`;
}

const I = {
  apps: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  bloat: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  tweaks: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  opt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  startup: '<path d="M12 2v10"/><path d="M5.6 6.6a8 8 0 1 0 12.8 0"/>',
  junk: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/>',
  videos: '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="M17 10l5-3v10l-5-3z"/>',
  pictures: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  documents: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  downloads: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  large: '<path d="M4 20h16M7 20v-6M12 20V5M17 20v-10"/>',
  dupes: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  smart: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>', check: '<path d="M5 12l5 5L20 7"/>', play: '<path d="M7 4l13 8-13 8z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', back: '<path d="M15 18l-6-6 6-6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
};
const svg = (n) => `<svg viewBox="0 0 24 24">${I[n]}</svg>`;

const CATS = {
  smart: { t: 'Smart Clean', d: 'Best safe picks from everything. Swipe through, done.' },
  apps: { t: 'Apps', d: 'Uninstall programs + Store apps and wipe every leftover.', drive: 1 },
  bloat: { t: 'Bloatware', d: 'Junk apps Windows came with.' },
  tweaks: { t: 'Debloat Windows', d: 'Kill ads, tracking, Copilot, Bing and more.' },
  opt: { t: 'Optimize', d: 'FPS, latency and speed boosts. Swipe right to turn on.' },
  startup: { t: 'Startup apps', d: 'Stop apps launching at boot. Faster startup.' },
  junk: { t: 'Junk & Update files', d: 'Temp, caches, Windows Update junk, old drivers.' },
  videos: { t: 'Videos', d: 'Swipe your videos, biggest first.', drive: 1 },
  pictures: { t: 'Pictures', d: 'Photo-swipe pictures and screenshots.', drive: 1 },
  documents: { t: 'Documents', d: 'PDFs, Word, Excel, text files.', drive: 1 },
  downloads: { t: 'Downloads', d: 'Everything piling up in Downloads.' },
  large: { t: 'Huge files', d: 'Anything over 500 MB.', drive: 1 },
  dupes: { t: 'Duplicates', d: 'Exact copies of the same file. Keep one.', drive: 1 },
};

// ---------- swipe meaning ----------
// Optimize deck works like Tinder: right = yes, turn it on. Everything else: left = get rid of it.
const isBoostDeck = () => S && S.cat === 'opt';
const actSide = () => (isBoostDeck() ? 'right' : 'left');
const ACT = { app: 'UNINSTALL', bloat: 'REMOVE', junk: 'CLEAN', file: 'DELETE', bundle: 'DELETE', startup: 'DISABLE', debloat: 'KILL IT', opt: 'BOOST' };
const actLabel = (it) => (it.kind === 'tweak' ? ACT[it.group] : ACT[it.kind]);
const passLabel = (it) => (it.kind === 'tweak' || it.kind === 'startup' ? 'SKIP' : 'KEEP');
const isApply = (it) => it.kind === 'tweak' || it.kind === 'startup'; // changes a setting, deletes nothing
const sideLabel = (it, side) => (side === actSide() ? actLabel(it) : passLabel(it));

// ---------- titlebar ----------
function status() {
  const sel = $('#drive');
  sel.innerHTML = info.drives.map((d) => `<option value="${d.root}">${d.root.slice(0, 2)} · ${fmt(d.free)} free</option>`).join('');
  sel.value = drive;
  sel.onchange = () => { drive = sel.value; store.set('drive', drive); if (screen === 'home') home(); };
  $('#admin').innerHTML = info.isAdmin ? '<span class="pill good" title="Full power">Admin ✓</span>'
    : '<button class="pill bad" id="elev" title="Some boosts and cleanups need admin">Not admin · fix</button>';
  const e = $('#elev');
  if (e) e.onclick = () => { if (e.disabled) return; e.disabled = true; e.textContent = 'Restarting…'; api.elevate(); }; // one click = one prompt
}
function musicBtn() { const b = $('#music'); b.classList.toggle('good', Music.on); b.textContent = Music.on ? '♪ Music on' : '♪ Music off'; }
$('#music').onclick = () => { Music.on ? Music.stop() : Music.start(); store.set('music', Music.on); musicBtn(); };
let hintSet = [];
function hints(h) { hintSet = h; drawHints(); }
function drawHints() {
  const pad = Pad.connected;
  $('#hints').innerHTML = hintSet.map(([k, t, p]) => `<span><kbd>${pad && p ? p : k}</kbd>${t}</span>`).join('') + (pad ? '<span class="padname">🎮 controller</span>' : '');
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2200); setTimeout(() => t.remove(), 2600);
}
// in-app popup (used for warnings like Game Bar)
function ask(title, text, okLabel = 'Do it anyway') {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'tip modal';
    el.innerHTML = `<div class="tip-card warn-card"><div class="warn-ico">${svg('warn')}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="row-btns"><button class="btn" id="m-no">Cancel</button><button class="btn danger" id="m-yes">${esc(okLabel)}</button></div></div>`;
    document.body.appendChild(el);
    const done = (v) => { el.remove(); resolve(v); };
    $('#m-no', el).onclick = () => done(false);
    $('#m-yes', el).onclick = () => done(true);
    $('#m-no', el).focus();
  });
}

// ---------- home ----------
// checks GitHub once per launch for a newer release
const updateP = api.checkUpdate().catch(() => null);
async function showUpdate() {
  const u = await updateP;
  const c = $('.credit');
  if (!u || !c || $('#upd')) return;
  c.insertAdjacentHTML('afterend', `<button class="btn update" id="upd">⬇ Update ${esc(u.version)} is out · get it</button>`);
  $('#upd').onclick = () => api.openUrl(u.url);
}
async function home() {
  screen = 'home'; S = null;
  info = await api.info();
  if (!drive || !info.drives.some((d) => d.root === drive)) drive = store.get('drive', info.sysDrive);
  if (!info.drives.some((d) => d.root === drive)) drive = info.sysDrive;
  status();
  const d = info.drives.find((x) => x.root === drive) || { free: 0, total: 1 };
  const used = ((d.total - d.free) / d.total) * 100;
  const tile = (k, cls = '') => `<button class="tile ${cls}" data-cat="${k}" data-nav>${svg(k)}<span class="t">${CATS[k].t}</span><span class="d">${CATS[k].d}</span></button>`;
  view.innerHTML = `<section class="screen home">
    <div class="hero">
      <div>
        <h1>Swipe your PC clean.</h1>
        <p class="sub">Swipe cards to decide. Nothing changes until you check the list at the end.</p>
        <div class="disk"><span class="dl">${drive.slice(0, 2)}</span><div class="bar"><i style="width:${used.toFixed(1)}%"></i></div><span>${fmt(d.free)} free of ${fmt(d.total)}</span></div>
        <div class="credit">Made by <b>BubbyJr</b> · <button class="link" id="gh">open source on GitHub</button></div>
      </div>
      ${tile('smart', 'hero-tile')}
    </div>
    <div class="section-label">Programs & Windows</div>
    <div class="tiles">${['apps', 'bloat', 'tweaks'].map((k) => tile(k)).join('')}</div>
    <div class="section-label">Speed</div>
    <div class="tiles">${['opt', 'startup'].map((k) => tile(k)).join('')}</div>
    <div class="section-label">Files ${drive !== info.sysDrive ? `<span class="badge info">scanning whole ${drive.slice(0, 2)} drive</span>` : ''}</div>
    <div class="tiles">${['junk', 'videos', 'pictures', 'documents', 'downloads', 'large', 'dupes'].map((k) => tile(k)).join('')}</div>
  </section>`;
  $$('.tile').forEach((t) => (t.onclick = () => openDeck(t.dataset.cat)));
  $('#gh').onclick = () => api.github();
  showUpdate();
  $('.tile').focus();
  hints([['←↑→↓', 'move', 'D-pad'], ['Enter', 'open', 'A']]);
  if (!store.get('tipSeen', false)) tip();
  else if (!store.get('warnSeen', false)) careful();
}
function tip() {
  const el = document.createElement('div');
  el.className = 'tip';
  el.innerHTML = `<div class="tip-card"><img src="logo.svg" alt="" width="72"><h2>Hey! Here is how it works</h2>
    <ol><li><b>Pick a tile</b>, like Junk or Apps.</li>
    <li><b>Drag cards</b> with your mouse. In cleaning tabs: <b class="red">left = delete</b>, <b class="green">right = keep</b>. In Optimize: <b class="green">right = turn boost on</b>, left = skip.</li>
    <li><b>Check the list</b> at the end, then hit the big button. Nothing is touched before that.</li></ol>
    <p class="sub">Keys ← → work too, and any controller. New here? Try <b>Smart Clean</b> first.</p><button class="btn primary" id="tipok">Got it</button></div>`;
  document.body.appendChild(el);
  $('#tipok').focus();
  $('#tipok').onclick = () => { store.set('tipSeen', true); el.remove(); if (!store.get('warnSeen', false)) careful(); else $('.tile')?.focus(); };
}
// "Read first" pill + shown once on first ever launch
function careful() {
  if ($('.careful-modal')) return;
  const el = document.createElement('div');
  el.className = 'tip modal careful-modal';
  el.innerHTML = `<div class="tip-card warn-card"><div class="warn-ico">${svg('warn')}</div><h2>Look before you swipe</h2>
    <ul class="careful-list">
      <li>Deleted stuff skips the Recycle Bin by default. <b>Once it's gone, it's gone.</b></li>
      <li>Only swipe left on things you know. <b>Not sure? Swipe right</b> to keep it.</li>
      <li>Want a safety net? Tick <b>Send to Recycle Bin</b> or <b>restore point</b> on the last screen.</li>
      <li>Boosts are safe: every one can be turned back off.</li>
    </ul>
    <div class="row-btns"><button class="btn primary" id="c-ok">Got it, I'll be careful</button></div></div>`;
  document.body.appendChild(el);
  const close = () => { store.set('warnSeen', true); el.remove(); $('.tile')?.focus(); };
  $('#c-ok', el).onclick = close;
  $('#c-ok', el).focus();
}
$('#careful').onclick = careful;

// ---------- deck ----------
const SMART_SKIP = ['winold', 'recycle', 'installers', 'tinydl', 'winsxs'];
async function scan(cat, fresh) {
  const scoped = CATS[cat].drive ? drive : '';
  const key = cat + '|' + scoped;
  if (!fresh && cache.has(key)) return cache.get(key);
  let items;
  if (cat === 'smart') {
    const junk = await scan('junk', fresh), deb = await scan('tweaks', fresh), opt = await scan('opt', fresh);
    items = [...junk.filter((j) => !SMART_SKIP.includes(j.id) && (!j.admin || info.isAdmin)),
      ...deb.filter((t) => !t.applied && !t.noUndo && !t.confirm && (!t.admin || info.isAdmin)),
      ...opt.filter((t) => !t.applied && !t.warn && !t.confirm && (!t.admin || info.isAdmin))];
  } else items = await api.scan(cat, scoped || info.sysDrive).catch(() => []);
  cache.set(key, items);
  return items;
}
api.onProgress((n) => { const el = $('#scancount'); if (el) el.textContent = `${n.toLocaleString()} files checked`; });
async function openDeck(cat, fresh) {
  screen = 'loading';
  view.innerHTML = `<section class="screen"><div class="loading">
    <div class="loader"><i></i><i></i><i></i></div>
    <div class="ltitle">Scanning ${CATS[cat].t.toLowerCase()}…</div><small id="scancount">${cat === 'dupes' || cat === 'large' ? 'Big scan, give it a sec.' : 'Getting ready…'}</small></div></section>`;
  hints([]);
  const all = await scan(cat, fresh);
  if (screen !== 'loading') return; // user left
  const applied = all.filter((t) => t.kind === 'tweak' && t.applied);
  S = { cat, all: all.filter((t) => !(t.kind === 'tweak' && t.applied)), applied, marks: new Map(), hist: [], busy: false, okd: new Set(),
    f: { q: '', sort: 'size', sys: false } };
  S.queue = filtered();
  renderDeck();
}
function filtered() {
  let l = S.all.filter((it) => !S.marks.has(it.id));
  if (S.cat === 'apps') {
    const { q, sort, sys } = S.f;
    if (!sys) l = l.filter((a) => !a.warn);
    if (q) l = l.filter((a) => (a.title + ' ' + a.publisher).toLowerCase().includes(q.toLowerCase()));
    if (drive !== info.sysDrive) l = l.filter((a) => a.location && a.location.toUpperCase().startsWith(drive));
    const by = { size: (a, b) => b.size - a.size, old: (a, b) => (a.date || '9').localeCompare(b.date || '9'), new: (a, b) => (b.date || '').localeCompare(a.date || ''), az: (a, b) => a.title.localeCompare(b.title) }[sort];
    l.sort(by);
  }
  return l;
}
const picked = () => S.all.filter((it) => S.marks.get(it.id) === 'act');

function renderDeck() {
  screen = 'deck';
  const c = CATS[S.cat];
  const boost = isBoostDeck();
  view.innerHTML = `<section class="screen deck-wrap ${boost ? 'boost' : ''}">
    <div class="deck-main">
      <div class="deck-top">
        <button class="ib" id="back">${svg('back')}Home</button>
        <h2>${c.t}</h2>
        <button class="ib" id="rescan" title="Scan again">${svg('refresh')}</button>
        <span class="grow"></span><span class="counter" id="counter"></span>
      </div>
      ${S.cat === 'apps' ? `<div class="filters">
        <input id="q" placeholder="Search apps…" value="${esc(S.f.q)}">
        <select id="sort"><option value="size">Biggest first</option><option value="old">Oldest first</option><option value="new">Newest first</option><option value="az">A → Z</option></select>
        <label class="chk"><input type="checkbox" id="sys" ${S.f.sys ? 'checked' : ''}> Show system stuff</label></div>` : ''}
      <div class="mid"><div class="deck" id="deck"></div></div>
      <div class="actions">
        <button class="round sm" id="undo" title="Undo (Z)">${svg('undo')}</button>
        <button class="round ${boost ? 'skip' : 'del'}" id="left">${svg('x')}</button>
        <button class="round keep" id="right">${svg(boost ? 'opt' : 'check')}</button>
        <button class="round sm" id="rev" title="Finish & review (Enter)">${svg('list')}</button>
      </div>
    </div>
    <aside class="pile">
      <div class="half" id="h-apply"><div class="pile-head"><b>${boost ? 'Boosts' : 'Settings to change'}</b><span id="applysum" class="g"></span></div><div class="pile-list" id="applylist"></div></div>
      <div class="half" id="h-trash"><div class="pile-head"><b>Trash pile</b><span id="trashsum" class="r"></span></div><div class="pile-list" id="trashlist"></div></div>
      <button class="btn primary wide" id="rev2">Review & finish</button>
    </aside>
  </section>`;
  $('#back').onclick = leaveDeck;
  $('#rescan').onclick = () => openDeck(S.cat, true);
  $('#left').onclick = () => swipe('left');
  $('#right').onclick = () => swipe('right');
  $('#undo').onclick = undo;
  $('#rev').onclick = $('#rev2').onclick = review;
  if (S.cat === 'apps') {
    $('#sort').value = S.f.sort;
    let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.f.q = e.target.value; S.queue = filtered(); renderCards(); }, 150); };
    $('#sort').onchange = (e) => { S.f.sort = e.target.value; S.queue = filtered(); renderCards(); };
    $('#sys').onchange = (e) => { S.f.sys = e.target.checked; S.queue = filtered(); renderCards(); };
  }
  renderCards();
}
function leaveDeck() { if (!picked().length || confirm('Leave? Your swipes will be lost.')) home(); }
function renderPile() {
  const p = picked();
  const apply = p.filter(isApply), del = p.filter((x) => !isApply(x));
  const hasApply = S.all.some(isApply) || S.applied.length, hasDel = S.all.some((x) => !isApply(x));
  $('#h-apply').hidden = !hasApply; $('#h-trash').hidden = !hasDel && hasApply;
  const row = (it) => `<button class="pile-row" data-id="${esc(it.id)}" title="Click to put back"><span>${esc(it.title)}</span><small>${it.size ? fmt(it.size) : cap(actLabel(it))}</small></button>`;
  $('#applylist').innerHTML = (apply.length ? apply.slice().reverse().map(row).join('') : '') +
    (S.applied.length ? `<div class="pile-sub">Already on ✓</div>${S.applied.map((a) => `<div class="pile-row done"><span>${esc(a.title)}</span><small>on</small></div>`).join('')}` : '') +
    (!apply.length && !S.applied.length ? `<div class="pile-empty">Swipe ${actSide()} to add boosts here.</div>` : '');
  $('#applysum').textContent = apply.length ? `${apply.length} to turn on` : '';
  const size = del.reduce((a, b) => a + (b.size || 0), 0);
  $('#trashlist').innerHTML = del.length ? del.slice().reverse().map(row).join('') : '<div class="pile-empty">Swipe left to add stuff here.<br>Click an item to put it back.</div>';
  $('#trashsum').textContent = del.length ? `${del.length}${size ? ' · ' + fmt(size) : ''}` : '';
  $$('.pile-row[data-id]').forEach((b) => (b.onclick = () => { S.marks.delete(b.dataset.id); S.hist = S.hist.filter((h) => h !== b.dataset.id); S.queue = filtered(); renderCards(); }));
  $('#rev2').disabled = !p.length;
}
function counter() {
  const done = S.all.length - S.all.filter((it) => !S.marks.has(it.id)).length;
  $('#counter').innerHTML = `<b>${done}</b> / ${S.all.length} swiped`;
}
const IMG = /\.(jpe?g|png|gif|webp|bmp)$/i, VID = /\.(mp4|webm|mov|m4v|mkv)$/i;
function media(it, top) {
  if (it.kind === 'file') {
    if (IMG.test(it.name)) return `<img class="full" src="${esc(it.url)}" draggable="false" decoding="async">`;
    // video: only first frame until you hover = no lag on big files
    if (VID.test(it.name) && top) return `<video src="${esc(it.url)}#t=1" muted loop playsinline preload="metadata"></video><div class="playhint">${svg('play')}Hover to preview</div>`;
    return `<img class="ico" data-icon="${esc(it.path)}" hidden><div class="ext">${esc((it.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 5))}</div>`;
  }
  if (it.kind === 'app' && it.logo) return `<img class="ico big" src="${esc(it.logo)}" draggable="false">`;
  if (it.kind === 'app' || it.kind === 'startup') return `<img class="ico" data-icon="${esc(it.icon)}" hidden><div class="letter">${esc(it.title[0])}</div>`;
  const names = (it) => (it.sample ? `<div class="names">${it.sample.map((n) => `<span>${esc(n)}</span>`).join('')}${it.count > it.sample.length ? `<span>+ ${(it.count - it.sample.length).toLocaleString()} more</span>` : ''}</div>` : '');
  if (it.kind === 'junk' || it.kind === 'bundle') return `<div class="bundle"><div class="huge">${it.unknown ? 'GBs?' : fmt(it.size)}</div>${names(it)}</div>`;
  if (it.kind === 'tweak') return `<div class="letter ${it.group}">${svg(it.group === 'opt' ? 'opt' : 'tweaks')}</div>`;
  return `<div class="letter">${esc(it.title[0])}</div>`;
}
function infoHtml(it) {
  const m = []; let desc = '', badges = '';
  const b = (cls, t) => (badges += `<span class="badge ${cls}">${esc(t)}</span>`);
  if (it.kind === 'app') {
    if (it.publisher) m.push(it.publisher); if (it.size) m.push(fmt(it.size)); if (it.date) m.push('installed ' + ago(it.date));
    if (it.store) b('info', 'Store app'); if (it.broken) b('warn', 'Broken · force remove'); else if (it.silent) b('ok', 'No popups');
    if (it.warn) b('warn', '⚠ Other apps may need this');
  } else if (it.kind === 'file') {
    m.push(fmt(it.size), 'changed ' + ago(it.mtime));
    desc = `<div class="path">${esc(it.original ? 'Copy of: ' + it.original : it.folder)}</div>`;
    if (it.original) b('ok', 'Duplicate · original kept');
  } else if (it.kind === 'bundle') {
    m.push(`${it.count.toLocaleString()} files`); desc = `<div class="desc">${esc(it.desc)}</div>`;
  } else if (it.kind === 'junk') {
    if (!it.unknown) m.push(`${it.count.toLocaleString()} files`); desc = `<div class="desc">${esc(it.desc)}</div>`;
    if (it.admin && !info.isAdmin) b('warn', 'Needs admin'); else b('ok', 'Safe');
  } else if (it.kind === 'bloat') {
    desc = `<div class="desc">${esc(it.desc)}</div>`;
    it.risk === 'low' ? b('ok', 'Safe to remove') : b('warn', 'Keep if you use it');
  } else if (it.kind === 'tweak') {
    desc = `<div class="desc">${esc(it.desc)}</div>`;
    if (it.tag) b('ok', it.tag); if (it.warn) b('warn', it.warn);
    if (it.admin && !info.isAdmin) b('warn', 'Needs admin'); if (it.noUndo) b('warn', 'No undo'); else b('info', 'Undo anytime');
  } else if (it.kind === 'startup') {
    desc = `<div class="path">${esc(it.desc)}</div>`; b('info', 'Undo anytime');
    if (it.admin && !info.isAdmin) b('warn', 'Needs admin');
  }
  return `<div class="info"><div class="name">${esc(it.title)}</div><div class="meta">${m.filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div>${desc}<div>${badges}</div></div>`;
}
function renderCards() {
  const deck = $('#deck');
  counter(); renderPile();
  if (!S.queue.length) {
    const n = picked().length;
    deck.innerHTML = `<div class="empty"><div class="done-big">${S.all.length ? 'Done!' : 'All clean'}</div>
      <div>${S.all.length ? `${plural(n, 'item')} picked.` : 'Nothing to do here.'}${S.applied.length ? ` ${S.applied.length} already on.` : ''}</div>
      ${n ? '<button class="btn primary" id="go">Review & finish</button>' : '<button class="btn" id="go">Back home</button>'}</div>`;
    $('#go').onclick = n ? review : home; $('#go').focus();
    hints([['Enter', n ? 'review' : 'home', 'A'], ['Z', 'undo', 'Y']]);
    return;
  }
  const html = [];
  for (let k = Math.min(2, S.queue.length - 1); k >= 0; k--) {
    const it = S.queue[k];
    const links = it.kind === 'file' ? `<div class="links"><button data-a="open">Open</button><button data-a="reveal">Show in folder</button></div>` : '';
    const lAct = actSide() === 'left';
    html.push(`<div class="card${k ? ' behind' : ''}" style="transform: translateY(${k * 12}px) scale(${1 - k * 0.04}); z-index:${10 - k}; opacity:${k === 2 ? 0.5 : 1}">
      <div class="stamp l ${lAct ? 'act' : 'pass'}">${sideLabel(it, 'left')}</div><div class="stamp r ${lAct ? 'pass' : 'act'}">${sideLabel(it, 'right')}</div>${links}
      <div class="media">${k < 2 ? media(it, !k) : ''}</div>${infoHtml(it)}</div>`);
  }
  deck.innerHTML = html.join('');
  const top = deck.lastElementChild, it = S.queue[0];
  $$('[data-a]', top).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); api[b.dataset.a](it.path); }));
  const v = $('video', top);
  if (v) { top.onmouseenter = () => v.play().catch(() => {}); top.onmouseleave = () => v.pause(); }
  drag(top);
  $$('img[data-icon]', deck).forEach(async (img) => {
    const url = await api.icon(img.dataset.icon);
    if (url && img.isConnected) { img.src = url; img.hidden = false; img.nextElementSibling?.remove(); }
  });
  const L = sideLabel(it, 'left'), R = sideLabel(it, 'right');
  $('#left').title = `${cap(L)} (←)`; $('#right').title = `${cap(R)} (→)`;
  hints([['←', L.toLowerCase(), 'LB'], ['→', R.toLowerCase(), 'RB'], ['Z', 'undo', 'Y'], ['Enter', 'finish', 'Start'], ['Esc', 'home', 'B']]);
}
function drag(el) {
  let sx = 0, sy = 0, dx = 0, on = false;
  const L = $('.stamp.l', el), R = $('.stamp.r', el);
  el.onpointerdown = (e) => {
    if (e.target.closest('button') || S.busy || e.button) return;
    on = true; sx = e.clientX; sy = e.clientY; dx = 0; el.setPointerCapture(e.pointerId); el.classList.remove('back');
    $('video', el)?.pause();
  };
  el.onpointermove = (e) => {
    if (!on) return; dx = e.clientX - sx; const dy = (e.clientY - sy) * 0.3;
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 16}deg)`;
    L.style.opacity = Math.max(0, -dx / 100); R.style.opacity = Math.max(0, dx / 100);
    const side = dx < -40 ? 'left' : dx > 40 ? 'right' : '';
    el.dataset.glow = side ? (side === actSide() ? (isBoostDeck() ? 'good' : 'bad') : (isBoostDeck() ? 'meh' : 'good')) : '';
  };
  el.onpointerup = el.onpointercancel = () => {
    if (!on) return; on = false;
    if (Math.abs(dx) > 100) swipe(dx < 0 ? 'left' : 'right');
    else snapBack(el);
  };
}
function snapBack(el) { el.classList.add('back'); el.style.transform = ''; el.dataset.glow = ''; $$('.stamp', el).forEach((s) => (s.style.opacity = 0)); }
async function swipe(side) {
  if (screen !== 'deck' || S.busy || !S.queue.length) return;
  const top = $('#deck').lastElementChild, it = S.queue[0];
  const act = side === actSide();
  if (act && it.confirm && !S.okd.has(it.id)) { // big warning first (Game Bar, security...)
    S.busy = true; snapBack(top);
    const yes = await ask(`Heads up: ${it.title}`, it.confirm, `Yes, ${actLabel(it).toLowerCase()}`);
    S.busy = false;
    if (!yes) return;
    S.okd.add(it.id);
  }
  S.busy = true;
  $(side === 'left' ? '.stamp.l' : '.stamp.r', top).style.opacity = 1;
  top.classList.add('fly');
  top.style.transform = `translateX(${side === 'left' ? -140 : 140}%) rotate(${side === 'left' ? -22 : 22}deg)`;
  top.style.opacity = 0;
  S.marks.set(it.id, act ? 'act' : 'pass'); S.hist.push(it.id);
  setTimeout(() => { S.queue.shift(); S.busy = false; renderCards(); }, 220);
}
function undo() {
  if (screen !== 'deck' || S.busy || !S.hist.length) return;
  const id = S.hist.pop(); S.marks.delete(id);
  const it = S.all.find((x) => x.id === id); if (it) S.queue.unshift(it); renderCards();
}

// ---------- review ----------
const GROUP_NAMES = { app: 'Uninstall', bloat: 'Remove bloatware', junk: 'Clean junk', file: 'Delete files', bundle: 'Delete files', startup: 'Stop at startup', tweak: 'Turn on' };
function review() {
  if (!S) return;
  screen = 'review';
  const t = picked();
  const kinds = [...new Set(t.map((x) => x.kind))];
  const hasFiles = t.some((x) => x.kind === 'file' || x.kind === 'bundle');
  const sys = t.some((x) => ['app', 'bloat', 'tweak'].includes(x.kind));
  const groups = kinds.map((k) => `<div class="section-label">${GROUP_NAMES[k]}</div><div class="list">${t.map((it, i) => it.kind !== k ? '' : `<label class="row"><input type="checkbox" data-i="${i}" checked>
      <span class="n">${esc(it.title)}<small>${esc(it.original ? 'copy of ' + it.original : it.folder || it.publisher || it.desc || '')}</small></span><span class="s">${it.size ? fmt(it.size) : ''}</span></label>`).join('')}</div>`).join('');
  const appliedRows = S.applied.map((x) => `<div class="row"><span class="n">${esc(x.title)}<small>Already on</small></span>${x.noUndo ? '' : `<button class="btn" data-undo="${x.id}">Turn off</button>`}</div>`).join('');
  view.innerHTML = `<section class="screen narrow">
    <button class="ib" id="back">${svg('back')}Back to swiping</button>
    <h1>Last check</h1><p class="sub">Untick anything you changed your mind on. Then hit the button.</p>
    ${t.length ? `<div class="opts">
      ${hasFiles ? `<label><input type="checkbox" id="bin"> Send files to Recycle Bin instead <small>· default is delete forever</small></label>` : ''}
      ${sys ? `<label><input type="checkbox" id="rp" ${info.isAdmin ? '' : 'disabled'}> Make a restore point first <small>${info.isAdmin ? '· optional, lets you roll back Windows (takes ~1 min)' : '· needs admin'}</small></label>` : ''}
      ${t.some((x) => x.kind === 'app') ? `<label><input type="checkbox" id="silent" checked> Silent uninstall when possible <small>· fewer popups</small></label>` : ''}
    </div>` : ''}
    ${groups}
    ${appliedRows ? `<div class="section-label">Already on</div><div class="list">${appliedRows}</div>` : ''}
    <div class="bottombar"><span class="grow" id="sum"></span><button class="btn danger big" id="go" ${t.length ? '' : 'disabled'}>Go</button></div>
  </section>`;
  const sel = () => $$('input[data-i]').filter((x) => x.checked).map((x) => t[+x.dataset.i]);
  const upd = () => { const s = sel(); const sz = s.reduce((a, b) => a + (b.size || 0), 0); $('#sum').textContent = `${plural(s.length, 'item')} picked${sz ? ' · ' + fmt(sz) : ''}`; $('#go').textContent = s.length ? `Do it (${s.length})` : 'Nothing picked'; $('#go').disabled = !s.length; };
  $$('input[data-i]').forEach((x) => (x.onchange = upd)); if (t.length) upd();
  $('#back').onclick = () => renderDeck();
  $$('[data-undo]').forEach((b) => (b.onclick = async () => { b.disabled = true; b.textContent = '…'; const ok = await api.tweak(b.dataset.undo, true); b.textContent = ok ? 'Turned off ✓' : 'Failed'; cache.clear(); }));
  let armed = false;
  $('#go').onclick = () => {
    if (!armed) { armed = true; $('#go').textContent = 'Sure? Click again'; $('#go').classList.add('pulse'); setTimeout(() => { armed = false; $('#go')?.classList.remove('pulse'); if (screen === 'review') upd(); }, 3000); return; }
    run(sel(), { permanent: !($('#bin') || {}).checked, rp: !!($('#rp') || {}).checked, silent: !!($('#silent') || {}).checked });
  };
  $('#go').focus();
  hints([['Esc', 'back', 'B'], ['Space', 'tick / untick', 'A']]);
}

// ---------- run ----------
let logBuf = '';
function runScreen(title) {
  screen = 'run';
  view.innerHTML = `<section class="screen narrow"><h1>${esc(title)}</h1><p class="sub" id="now">Starting…</p>
    <div class="bar progress"><i id="prog" style="width:0%"></i></div><details><summary>Details</summary><div class="console" id="console">${esc(logBuf)}</div></details></section>`;
  hints([]);
}
const prog = (n, t, label) => { const p = $('#prog'); if (p) p.style.width = `${(n / t) * 100}%`; const w = $('#now'); if (w && label) w.textContent = label; };
api.onLog((m) => { logBuf += m + '\n'; const c = $('#console'); if (c) { c.textContent += m + '\n'; c.scrollTop = c.scrollHeight; } });

async function run(items, opts) {
  logBuf = '';
  runScreen('Working on it…');
  if (opts.rp) { prog(0, 1, 'Making a restore point…'); await api.restorePoint(); }
  const res = { freed: 0, deleted: 0, uninstalled: 0, applied: 0, failed: 0, needRestart: false };
  const left = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    prog(i, items.length, `${cap(actLabel(it))}: ${it.title}  (${i + 1}/${items.length})`);
    try {
      if (it.kind === 'app') {
        // uninstallers can hang (popup behind window, cancelled). After 20s offer a way out.
        const tmr = setTimeout(() => {
          const n = $('#now'); if (!n || $('#skipw')) return;
          n.insertAdjacentHTML('afterend', `<p class="sub">Stuck? The uninstaller window may be behind this one. <button class="btn" id="skipw">Skip waiting</button></p>`);
          $('#skipw').onclick = () => { api.skipWait(); $('#skipw').disabled = true; $('#skipw').textContent = 'Checking leftovers…'; };
        }, 20000);
        try { left.push(...(await api.uninstall(it, { silent: opts.silent }))); res.uninstalled++; }
        finally { clearTimeout(tmr); $('#skipw')?.parentElement.remove(); }
      }
      else if (it.kind === 'bloat') (await api.removeBloat(it)) ? res.uninstalled++ : res.failed++;
      else if (it.kind === 'tweak') { if (await api.tweak(it.id, false)) { res.applied++; res.needRestart = true; } else res.failed++; }
      else if (it.kind === 'startup') (await api.setStartup(it, false)) ? res.applied++ : res.failed++;
      else if (it.kind === 'junk') { const r = await api.cleanJunk(it); res.freed += r.freed; res.deleted++; }
      else { const r = await api.deleteFiles([it], opts.permanent); res.freed += r.freed; r.ok ? res.deleted++ : res.failed++; }
    } catch { res.failed++; }
  }
  prog(1, 1);
  cache.clear();
  res.bin = !opts.permanent && items.some((x) => x.kind === 'file' || x.kind === 'bundle');
  if (left.length) return leftoversScreen(left, res);
  done(res);
}

function leftoversScreen(left, res) {
  screen = 'leftovers';
  const label = { file: 'Folder / file', reg: 'Registry key (backed up first)', run: 'Startup entry', task: 'Scheduled task', svc: 'Service' };
  const rows = left.map((l, i) => `<label class="row"><input type="checkbox" data-i="${i}" ${l.sure ? 'checked' : ''}>
    <span class="n">${esc(l.path)}<small>${label[l.type]} · from ${esc(l.app)}${l.sure ? '' : ' · maybe, check it'}</small></span><span class="s">${l.size ? fmt(l.size) : ''}</span></label>`).join('');
  view.innerHTML = `<section class="screen narrow"><h1>Leftovers found</h1>
    <p class="sub">The uninstallers left this behind. Ticked = sure match. Unticked = name looks close, you decide.</p>
    <div class="list">${rows}</div>
    <div class="bottombar"><span class="grow"></span><button class="btn" id="skip">Skip</button><button class="btn danger big" id="go">Wipe leftovers</button></div></section>`;
  $('#skip').onclick = () => done(res);
  $('#go').onclick = async () => {
    const sel = $$('input[data-i]').filter((x) => x.checked).map((x) => left[+x.dataset.i]);
    runScreen('Wiping leftovers…');
    const r = await api.deleteLeftovers(sel);
    done({ ...res, freed: res.freed + r.freed, leftovers: r.ok });
  };
  $('#go').focus();
  hints([['Space', 'tick / untick', 'A']]);
}

let homeTimer;
function done(r) {
  screen = 'done';
  const parts = [];
  if (r.freed > 1e6) parts.push(`${fmt(r.freed)} freed`);
  if (r.uninstalled) parts.push(`${plural(r.uninstalled, 'app')} gone`);
  if (r.applied) parts.push(`${r.applied} ${isBoostDeck() ? (r.applied === 1 ? 'boost' : 'boosts') : (r.applied === 1 ? 'setting' : 'settings')} on`);
  if (r.deleted && r.freed <= 1e6) parts.push(`${plural(r.deleted, 'item')} cleaned`);
  const big = parts.shift() || 'All done';
  view.innerHTML = `<section class="screen narrow"><div class="empty" style="height:auto;margin-top:6vh">
    <div class="done-big">${esc(big)}</div>
    ${parts.length ? `<div class="done-sub">${esc(parts.join(' · '))}</div>` : ''}
    ${r.leftovers ? `<div>${r.leftovers} leftovers wiped.</div>` : ''}
    ${r.failed ? `<div class="warn-t">${r.failed} couldn't finish (in use or needs admin). See details.</div>` : ''}
    ${r.bin ? '<div class="sub">Files are in the Recycle Bin. Empty it in Junk to get the space.</div>' : ''}
    ${r.needRestart ? '<div class="sub">Some changes kick in after a restart.</div>' : ''}
    <div style="display:flex;gap:12px">${r.needRestart ? '<button class="btn" id="rx">Restart Explorer now</button>' : ''}<button class="btn primary" id="home">Back home</button></div>
  </div>${logBuf ? `<details id="det"><summary>What happened</summary><div class="console" style="height:30vh">${esc(logBuf)}</div></details>` : ''}</section>`;
  let n = 6;
  const tickHome = () => { const b = $('#home'); if (!b) return; b.textContent = `Back home (${n})`; if (n-- <= 0) home(); else homeTimer = setTimeout(tickHome, 1000); };
  const stop = () => { clearTimeout(homeTimer); const b = $('#home'); if (b) b.textContent = 'Back home'; };
  $('#home').onclick = () => { clearTimeout(homeTimer); home(); }; $('#home').focus();
  const rx = $('#rx'); if (rx) rx.onclick = () => { stop(); api.restartExplorer(); };
  const det = $('#det'); if (det) det.ontoggle = stop;
  tickHome();
  hints([['Enter', 'home', 'A']]);
}

// ---------- input: keyboard ----------
function nav(dir) {
  const items = $$('[data-nav]'), cur = document.activeElement;
  if (!items.includes(cur)) return items[0] && items[0].focus();
  const a = cur.getBoundingClientRect();
  let best = null, bd = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    if (!{ left: dx < -5, right: dx > 5, up: dy < -5, down: dy > 5 }[dir]) continue;
    const d = dir === 'left' || dir === 'right' ? Math.abs(dx) + Math.abs(dy) * 3 : Math.abs(dy) + Math.abs(dx) * 3;
    if (d < bd) { bd = d; best = el; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); }
}
function focusMove(step) { // generic tab-like move for review / popups with a controller
  const f = $$('.tip button, .tip input, #view button:not([disabled]), #view input, #view select, #view summary').filter((e) => e.offsetParent);
  const pool = $('.tip') ? f.filter((e) => e.closest('.tip')) : f;
  const i = pool.indexOf(document.activeElement);
  pool[(i + step + pool.length) % pool.length]?.focus();
}
function key(k) {
  if ($('.tip')) {
    if (k === 'Escape') { ($('#m-no') || $('#c-ok') || $('#tipok'))?.click(); return true; }
    if (k === 'ArrowLeft' || k === 'ArrowUp') return focusMove(-1), true;
    if (k === 'ArrowRight' || k === 'ArrowDown') return focusMove(1), true;
    return false; // Enter = native click on focused button
  }
  if (screen === 'home') {
    const m = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[k];
    if (m) return nav(m), true;
  } else if (screen === 'deck') {
    if (!S.queue.length) { if (k === 'z' || k === 'Backspace') return undo(), true; if (k === 'Escape') return leaveDeck(), true; return false; }
    if (k === 'ArrowLeft' || k === 'a') return swipe('left'), true;
    if (k === 'ArrowRight' || k === 'd') return swipe('right'), true;
    if (k === 'z' || k === 'Backspace' || k === 'ArrowUp') return undo(), true;
    if (k === 'Enter' || k === 'ArrowDown' || k === 'Start') return review(), true;
    if (k === 'Escape') return leaveDeck(), true;
  } else if (['review', 'leftovers', 'done'].includes(screen)) {
    if (k === 'Escape') return screen === 'review' ? renderDeck() : home(), true;
    if (k === 'ArrowUp' || k === 'ArrowLeft') return focusMove(-1), true;
    if (k === 'ArrowDown' || k === 'ArrowRight') return focusMove(1), true;
  }
  return false;
}
addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'SELECT'].includes(e.target.tagName) && e.target.type !== 'checkbox';
  if (typing && e.key !== 'Escape') return;
  if (typing) e.target.blur();
  if (key(e.key)) e.preventDefault();
});

// ---------- input: any controller ----------
// Xbox, PlayStation, Switch Pro, 8BitDo, generic USB pads. Standard layout + fallback for odd (DirectInput) pads.
const Pad = (() => {
  const prev = {}, repeatAt = {};
  let running = false, connected = false;
  function hat(v) { // DirectInput d-pad on one axis (-1 up … 0.71 left, >1 = idle)
    if (v === undefined || v > 1.1 || v < -1.1) return {};
    const r = Math.round((v + 1) / (2 / 7));
    return { up: [0, 1, 7].includes(r), right: [1, 2, 3].includes(r), down: [3, 4, 5].includes(r), left: [5, 6, 7].includes(r) };
  }
  function read(gp) {
    const B = (i) => !!gp.buttons[i]?.pressed, A = (i) => gp.axes[i] || 0;
    const std = gp.mapping === 'standard';
    const h = std ? {} : hat(gp.axes[9]);
    return {
      ArrowLeft: B(14) || A(0) < -0.6 || h.left, ArrowRight: B(15) || A(0) > 0.6 || h.right,
      ArrowUp: B(12) || A(1) < -0.6 || h.up, ArrowDown: B(13) || A(1) > 0.6 || h.down,
      Enter: B(0), Escape: B(1), z: B(3), Start: B(9),
      SwipeL: B(4) || (gp.buttons[6]?.value || 0) > 0.6, SwipeR: B(5) || (gp.buttons[7]?.value || 0) > 0.6,
    };
  }
  function press(k) {
    if (k === 'SwipeL') return screen === 'deck' ? swipe('left') : focusMove(-1);
    if (k === 'SwipeR') return screen === 'deck' ? swipe('right') : focusMove(1);
    if (key(k)) return;
    if (k === 'Enter') { const a = document.activeElement; a && a !== document.body ? a.click() : null; }
    if (k === 'Start' && screen !== 'deck') document.activeElement?.click();
  }
  function loop() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const now = performance.now();
    for (const gp of pads) {
      for (const [k, v] of Object.entries(read(gp))) {
        const id = gp.index + k;
        if (v && !prev[id]) { press(k); repeatAt[id] = now + 400; }
        else if (v && k.startsWith('Arrow') && now > repeatAt[id]) { press(k); repeatAt[id] = now + 130; } // hold to scroll
        prev[id] = v;
      }
    }
    if (pads.length) requestAnimationFrame(loop); else { running = false; setConnected(false); }
  }
  function setConnected(v) { if (connected !== v) { connected = v; drawHints(); } }
  function start(name) {
    setConnected(true);
    if (name) toast(`🎮 Controller ready`);
    if (!running) { running = true; requestAnimationFrame(loop); }
  }
  addEventListener('gamepadconnected', (e) => start(e.gamepad.id));
  setInterval(() => { if (!running && navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) start(); }, 1500);
  return { get connected() { return connected; } };
})();

if (store.get('music', true)) Music.start();
musicBtn();
home();
