// Drill edition client. Expects globals: Chess, Board (concatenated by scripts/build-drill.js).
const DATA = JSON.parse(document.getElementById('data').textContent);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---- per-device progress (nice to have; the page works without it) ----
const KEY = 'chess-coach-drills-v1';
let mem = { p: {}, days: {}, themes: {}, rating: {}, timer: 0, speed: { n: 0, ms: 0, inTime: 0, late: 0 }, scan: { rounds: 0, hits: 0, missed: 0, falses: 0, ms: 0 }, ctrl: { rounds: 0, hits: 0, missed: 0, falses: 0, ms: 0 } };
const load = () => { try { const j = JSON.parse(localStorage.getItem(KEY)); if (j) mem = { ...mem, ...j }; } catch (e) { /* ignore */ } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* ignore */ } };
load();
const today = () => new Date().toISOString().slice(0, 10);
function record(p, solved, clean) {
  const prev = mem.p[p.id] || { t: 0 };
  mem.p[p.id] = { t: prev.t + 1, s: solved ? 1 : (prev.s || 0), last: Date.now(), r: solved ? 'ok' : 'fail' };
  const th = mem.themes[p.theme] || (mem.themes[p.theme] = { ok: 0, fail: 0, clean: 0 });
  if (solved) { th.ok++; if (clean) th.clean++; } else th.fail++;
  const d = mem.days[today()] || (mem.days[today()] = { ok: 0, fail: 0 });
  if (solved) d.ok++; else d.fail++;
  save();
}

// ---- countdown: a 3-2-1 screen before every challenge. It covers the board (so the position is not previewed) and says which side to play ----
const cdSecs = () => (mem.countdown === 0 || mem.countdown === 5 ? mem.countdown : 3);
let cdCancel = null;
function cancelCountdown() { if (cdCancel) cdCancel(false); }
function runCountdown({ title, sub, color }) {
  cancelCountdown();
  const secs = cdSecs(); const host = $('pb');
  if (!secs || !host) return Promise.resolve(true);
  return new Promise((resolve) => {
    let left = secs; let iv = null;
    const ov = document.createElement('div'); ov.className = 'cd'; ov.id = 'cd'; ov.setAttribute('role', 'status'); ov.setAttribute('aria-live', 'polite');
    const finish = (ok) => { clearInterval(iv); ov.remove(); if (cdCancel === finish) cdCancel = null; resolve(ok); };
    const paint = () => {
      ov.innerHTML = `<div class="cdbox">${color ? `<div class="chip ${color}"><span class="dotc"></span>${color === 'w' ? 'WHITE' : 'BLACK'}</div>` : ''}<div class="cdt">${esc(title)}</div><div class="cdn" aria-label="${left} seconds">${left}</div><div class="cds">${esc(sub)}</div><button class="ghost" id="cdskip">Skip</button></div>`;
      const sk = ov.querySelector('#cdskip'); if (sk) sk.onclick = () => finish(true);
    };
    paint(); host.appendChild(ov); cdCancel = finish;
    iv = setInterval(() => { left--; if (left <= 0) finish(true); else paint(); }, 1000);
  });
}

// ---- selection ----
const PUZ = DATA.puzzles;
const FILTERS = {
  hanging: (p) => p.theme === 'hangingPiece' || p.themes.includes('hangingPiece'),
  mine: (p) => p.mine,
  openW: (p) => p.real && p.phase === 'opening' && p.color === 'w',
  openB: (p) => p.real && p.phase === 'opening' && p.color === 'b',
  later: (p) => p.real && p.phase === 'later',
  exchanges: (p) => p.theme === 'winsMaterial',
  forks: (p) => p.theme === 'fork' || p.theme === 'discoveredAttack' || p.theme === 'pin' || p.theme === 'skewer',
  mates: (p) => p.theme === 'mate' || p.theme === 'backRankMate',
  mixed: (p) => p.difficulty <= 3,
};
function choose(filter, n = 10) {
  const now = Date.now();
  const score = (p) => {
    const r = mem.p[p.id]; let s = Math.random();
    if (p.mine) s += 1.2;
    if (p.times > 1) s += 0.8; // positions you keep getting wrong
    if (!r) s += 0.8; else if (r.r === 'fail') s += 2; else if (now - r.last < 3 * 86400e3) s -= 3; else s -= 0.5;
    return s;
  };
  return PUZ.filter(filter).map((p) => [score(p), p]).sort((a, b) => b[0] - a[0]).slice(0, n).map((x) => x[1]);
}

// ---- pieces: chess.com's set when embedded, otherwise (or on request) the original drawings ----
function applyPieces() {
  const neo = window.PIECE_IMGS_NEO; const on = !!neo && mem.pieces !== 'original';
  window.PIECE_IMGS = on ? neo : null;
}
applyPieces();

// ---- app shell: a top bar, a stage that fits the screen, and a bottom bar. Nothing scrolls; every button lives in the top or bottom bar ----
let board = null; let S = null; let tab = 'drill';
const view = () => $('view');
const ICON = {
  drill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>',
  weak: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9 16h-18z"/><path d="M12 10v4.5M12 17.4v.1"/></svg>',
  progress: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19v-6M11 19V6M17 19v-9M3 20h18"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/></svg>',
};
const TABS = [['drill', 'Drill'], ['weak', 'Weak spots'], ['progress', 'Progress'], ['settings', 'Settings']];
function setNav() {
  $('bottom').innerHTML = `<div class="tabs" role="navigation" aria-label="Sections">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}"${tab === k ? ' aria-current="page"' : ''}>${ICON[k]}<span>${l}</span></button>`).join('')}</div>`;
  $('bottom').querySelectorAll('button').forEach((b) => { b.onclick = () => show(b.dataset.tab); });
}
function setTopBrand() {
  const g = ratingInfo(); const pct = Math.max(1.5, Math.min(100, (g.cur / g.target) * 100));
  $('top').innerHTML = `<div class="brandrow"><div class="brand">Chess Coach</div><button class="ratingchip" id="ratingchip" aria-label="Rating ${g.cur}, goal ${g.target}. Open progress"><b>${g.cur}</b><span>→ ${g.target}</span></button></div>
    <div class="topbar" role="progressbar" aria-valuemin="0" aria-valuemax="${g.target}" aria-valuenow="${g.cur}" aria-label="Rating progress"><i style="width:${pct}%"></i></div>`;
  $('ratingchip').onclick = () => { mem.progressPage = 'goal'; save(); show('progress'); };
}
function show(t) {
  tab = t; stopTimer(); cancelCountdown();
  setTopBrand(); setNav();
  ({ drill: renderMenu, weak: renderWeak, progress: renderProgress, settings: renderSettings })[t]();
}

// ---- goal: road to 2000 ----
const MILESTONES = [500, 800, 1000, 1200, 1500, 1800, 2000];
const goalMode = () => (mem.goalMode === 'blitz' ? 'blitz' : 'rapid');
function ratingInfo() {
  const mode = goalMode(); const hist = (DATA.ratings && DATA.ratings[mode]) || [];
  const o = mem.rating && mem.rating[mode];
  const cur = o ? o.r : hist.length ? hist[hist.length - 1][1] : 0;
  const peak = Math.max(cur, ...hist.map((h) => h[1]), 0);
  return { mode, hist, cur, peak, mine: !!o, target: (DATA.goal && DATA.goal.rating) || 2000 };
}
function goalCard(full) {
  const g = ratingInfo(); const pct = Math.max(1.5, Math.min(100, (g.cur / g.target) * 100));
  const next = MILESTONES.find((m) => m > g.cur) || g.target;
  let spark = '';
  if (full && g.hist.length > 2) {
    const h = g.hist.slice(-60).map((x) => x[1]); const lo = Math.min(...h), hi = Math.max(...h), W = 300, H = 56;
    const pts = h.map((r, i) => `${(i / (h.length - 1) * W).toFixed(1)},${(H - 4 - (r - lo) / Math.max(1, hi - lo) * (H - 8)).toFixed(1)}`).join(' ');
    spark = `<div><svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Rating over your last ${h.length} games"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg><div class="small muted">Last ${h.length} ${g.mode} games: low ${lo}, high ${hi}</div></div>`;
  }
  return `<div class="card goal"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Road to ${g.target}</h3>
    <span class="seg" id="gseg">${['rapid', 'blitz'].map((m) => `<button data-m="${m}" class="${g.mode === m ? 'on' : ''}">${m}</button>`).join('')}</span></div>
    <div class="gbar" role="progressbar" aria-valuemin="0" aria-valuemax="${g.target}" aria-valuenow="${g.cur}" aria-label="Rating progress toward ${g.target}"><i style="width:${pct}%"></i>${[500, 1000, 1500].map((m) => `<u style="left:${m / g.target * 100}%"></u>`).join('')}</div>
    <div class="gticks"><span style="left:0">0</span>${[500, 1000, 1500].map((m) => `<span style="left:${m / g.target * 100}%">${m}</span>`).join('')}<span style="left:100%">${g.target}</span></div>
    <div class="nums"><span><b>${g.cur}</b> <span class="muted small">now${g.mine ? ' (you entered)' : ''}</span></span><span><b>${(g.target - g.cur).toLocaleString()}</b> <span class="muted small">to go</span></span><span><b>${next}</b> <span class="muted small">next stop, ${next - g.cur} away</span></span><span><b>${g.peak}</b> <span class="muted small">peak</span></span></div>
    ${spark}${full ? `<div class="row small"><label for="rin" class="muted">Played since this was built? Enter your rating:</label><input id="rin" type="number" min="100" max="3500" inputmode="numeric" placeholder="${g.cur}"><button id="rset">Update</button>${g.mine ? '<button id="rreset" class="ghost">Use built-in</button>' : ''}</div>` : ''}</div>`;
}
function bindGoal(rerender) {
  const seg = $('gseg'); if (seg) seg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; mem.goalMode = b.dataset.m; save(); rerender(); };
  const set = $('rset'); if (set) set.onclick = () => { const v = Math.round(+$('rin').value); if (v >= 100 && v <= 3500) { mem.rating[goalMode()] = { r: v, ts: Date.now() }; save(); rerender(); } };
  const rs = $('rreset'); if (rs) rs.onclick = () => { delete mem.rating[goalMode()]; save(); rerender(); };
}

// ---- menu: one screen of big tiles, no scrolling ----
function renderMenu() {
  if (S && S.active) { if (S.scan) { renderScan(); scanRound(); } else if (S.ctrl) { renderCtrl(); ctrlRound(); } else { renderSession(); load1(); } return; }
  tab = 'drill'; setTopBrand(); setNav();
  const hang = DATA.profile.weaknesses.find((x) => x.theme === 'hangingPiece');
  const count = (f) => PUZ.filter(f).length;
  const sMode = scanMode() === 'hanging' ? 'Winnable' : 'Undefended';
  const sideLabel = { mixed: 'Both colours', w: 'White', b: 'Black' }[sidePref()];
  const regLabel = { both: 'whole board', near: 'near half', far: 'far half' }[region()];
  // [id, data-m (puzzle mode, or '' for the two instinct drills), title, subtitle, extra class, label shown in the session]
  const tiles = [
    ['m-hanging', 'hanging', 'Stop hanging pieces', `${hang ? plural(hang.count, 'mistake') + ' in your games · ' : ''}${count(FILTERS.hanging)} puzzles`, 'hero', 'Hanging pieces'],
    ['m-ow', 'openW', 'Openings · White', `${count(FILTERS.openW)} of your positions`, '', 'Openings · White'],
    ['m-ob', 'openB', 'Openings · Black', `${count(FILTERS.openB)} of your positions`, '', 'Openings · Black'],
    ['m-later', 'later', 'Middlegame', `${count(FILTERS.later)} of your mistakes`, '', 'Middlegame mistakes'],
    ['m-mine', 'mine', 'My own mistakes', `${count(FILTERS.mine)} positions`, '', 'My own mistakes'],
    ['m-ex', 'exchanges', 'Material &amp; trades', `${count(FILTERS.exchanges)} puzzles`, '', 'Material & trades'],
    ['m-forks', 'forks', 'Forks, pins, skewers', `${count(FILTERS.forks)} puzzles`, '', 'Forks, pins, skewers'],
    ['m-mates', 'mates', 'Checkmates', `${count(FILTERS.mates)} puzzles`, '', 'Checkmates'],
    ['m-mix', 'mixed', 'Mixed set', 'easier ones, every theme', '', 'Mixed set'],
    ['m-scan', '', 'Safety scan', `${sMode} · 10 s`, 'inst', ''],
    ['m-ctrl', '', 'Square control', `${sideLabel} · ${regLabel}`, 'inst', ''],
  ];
  view().innerHTML = `<div class="tiles">${tiles.map(([id, m, title, sub, cls]) => `<button class="tile ${cls}" id="${id}"${m ? ` data-m="${m}"` : ''}><b>${title}</b><span>${sub}</span></button>`).join('')}</div>`;
  tiles.forEach(([id, m, , , , label]) => { if (m) $(id).onclick = () => start(m, label); });
  $('m-scan').onclick = startScan; $('m-ctrl').onclick = startCtrl;
}

// ---- settings: every option on one screen ----
function renderSettings() {
  const row = (label, id, opts, cur, attr) => `<div class="srow"><div class="slabel">${label}</div><span class="seg" id="${id}">${opts.map(([v, l]) => `<button data-${attr}="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</span></div>`;
  const piecesRow = window.PIECE_IMGS_NEO ? row('Pieces', 'pseg', [['chesscom', 'chess.com'], ['original', 'Original']], mem.pieces === 'original' ? 'original' : 'chesscom', 'p') : '';
  view().innerHTML = `<div class="settings">
    ${row('Countdown', 'cdseg', [[0, 'Off'], [3, '3 s'], [5, '5 s']], cdSecs(), 'd')}
    ${row('Puzzle timer', 'seg', [[0, 'Off'], [10, '10 s'], [5, '5 s']], mem.timer || 0, 't')}
    ${row('Scan finds', 'smode', [['undefended', 'Undefended'], ['hanging', 'Winnable']], scanMode(), 's')}
    ${row('Control: colour', 'cside', [['mixed', 'Both'], ['w', 'White'], ['b', 'Black']], sidePref(), 'c')}
    ${row('Control: squares', 'creg', [['both', 'Whole'], ['near', 'Near half'], ['far', 'Far half']], region(), 'r')}
    ${piecesRow}
    ${row('Rating goal', 'gseg', [['rapid', 'Rapid'], ['blitz', 'Blitz']], goalMode(), 'm')}
    <p class="hint">Saved on this device. Near half is the side being read, far half is the opponent's side.</p></div>`;
  const bind = (id, attr, fn) => { $(id).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; fn(b.dataset[attr]); save(); renderSettings(); setTopBrand(); }; };
  bind('cdseg', 'd', (v) => { mem.countdown = +v; });
  bind('seg', 't', (v) => { mem.timer = +v; });
  bind('smode', 's', (v) => { mem.scanMode = v; });
  bind('cside', 'c', (v) => { mem.ctrlSide = v; });
  bind('creg', 'r', (v) => { mem.ctrlRegion = v; });
  bind('gseg', 'm', (v) => { mem.goalMode = v; });
  if (window.PIECE_IMGS_NEO) bind('pseg', 'p', (v) => { mem.pieces = v; applyPieces(); });
}

// ---- session ----
function start(modeKey, label) {
  const list = choose(FILTERS[modeKey], 10);
  if (!list.length) { view().innerHTML = '<div class="card">No puzzles for that yet.</div>'; return; }
  S = { active: true, label, modeKey, list, i: 0, results: [], retried: new Set() };
  renderSession(); load1();
}
// shared layout for every drill: top bar = End / progress dots / flip, stage = board + short messages, bottom bar = the action buttons
function sessionShell(title, onQuit, boardOpts) {
  $('top').innerHTML = `<div class="sessbar"><button class="iconbtn" id="quit" aria-label="End this drill">✕</button><div class="sesstitle">${esc(title)}</div><div class="dots" id="dots"></div><button class="iconbtn" id="flip" aria-label="Flip the board">⇅</button></div>`;
  view().innerHTML = '<div class="boardbox"><div id="pb"></div></div><div class="panel"><div id="info"></div><div id="feed"></div></div>';
  $('bottom').innerHTML = '<div class="actions" id="btns"></div>';
  board = new Board($('pb'), boardOpts || {});
  $('quit').onclick = onQuit; $('flip').onclick = () => board.flip();
  watchPanel();
}
// end-of-drill screen: result in the stage, "again" and "menu" in the bottom bar
function summaryScreen(title, big, bigLabel, lines, note, againLabel, againFn) {
  setTopBrand();
  view().innerHTML = `<div class="summary"><h2>${title}</h2><div class="bigstat"><b>${big}</b><span>${bigLabel}</span></div>${lines}${note ? `<p class="note2">${note}</p>` : ''}</div>`;
  $('bottom').innerHTML = `<div class="actions"><button class="primary" id="again">${againLabel}</button><button id="menu">Menu</button></div>`;
  $('again').onclick = againFn; $('menu').onclick = renderMenu;
}
// Keep every message on screen without scrolling: shrink the text a little, then give the text more room with a smaller board,
// then (last resort) drop the secondary lines. Runs whenever the message area changes.
function fitPanel() {
  const p = document.querySelector('.panel'); const st = view(); const feed = $('feed');
  if (!p || !feed) return;
  st.classList.remove('fb'); p.classList.remove('tight'); p.style.removeProperty('--pfs');
  if (!feed.children.length) return;
  const over = () => p.scrollHeight > p.clientHeight + 1;
  const shrink = (min) => { let fs = 14; while (over() && fs > min) { fs -= 0.5; p.style.setProperty('--pfs', fs + 'px'); } return !over(); };
  if (shrink(11)) return;
  p.classList.add('tight'); // last resort: drop the secondary lines. The board always stays full width.
}
function watchPanel() {
  const obs = new MutationObserver(() => fitPanel());
  ['info', 'feed'].forEach((id) => { if ($(id)) obs.observe($(id), { childList: true, subtree: true, characterData: true }); });
}
function renderSession() { sessionShell(S.label, finish, { onMove }); dots(); }
function dots() { $('dots').innerHTML = S.list.map((p, i) => `<i class="${S.results[i] === undefined ? '' : S.results[i] ? 'ok' : 'no'} ${i === S.i ? 'cur' : ''}"></i>`).join(''); }
const sideName = (s) => (s === 'w' ? 'White' : 'Black');
async function load1() {
  const p = S.list[S.i]; if (!p) return finish();
  S.cur = { p, si: 0, wrong: 0, hints: 0, hintLevel: 0, done: false };
  const cur = S.cur; replayToken++; // cancels any "Watch it" replay still running from the previous puzzle
  dots();
  board.flip(p.side); board.locked = true; board.interactive = true;
  board.load(p.setup ? p.setup.fen : p.fen);
  $('feed').innerHTML = ''; $('btns').innerHTML = '';
  const why = p.real ? `From <b>your game</b> (${esc(p.ctx)}). You played <b>${esc(p.yourMove)}</b> here${p.times > 1 ? ` and you have reached this exact position ${p.times} times` : ''}. Find a better move.` : p.origin === 'my-mistake' ? `From <b>your game</b>: you played <b>${esc(p.yourMove)}</b> here. Find the move you should have played.`
    : p.yourMove ? `From <b>your game</b>: your opponent had just erred and you played <b>${esc(p.yourMove)}</b>. Was there better?` : 'Your opponent just made a mistake. Punish it.';
  $('info').innerHTML = `<div class="status"><b>${sideName(p.side)} to move</b><span>puzzle ${S.i + 1}/${S.list.length}</span><span>${'★'.repeat(p.difficulty)}${'☆'.repeat(5 - p.difficulty)}</span>${p.solution.length > 1 ? `<span>${Math.ceil(p.solution.length / 2)}-move idea</span>` : ''}</div><div class="why">${why}</div>`;
  const go = await runCountdown({ title: `Puzzle ${S.i + 1} of ${S.list.length}`, color: p.side, sub: `${sideName(p.side)} to move. Find the best move.` });
  if (!go || !S || S.cur !== cur) return;
  if (p.setup) { await sleep(450); if (S && S.cur !== cur) return; await board.play(p.setup.move); if (!S || S.cur !== cur) return; }
  board.locked = false; buttons(); startTimer();
}
let replayToken = 0; // "Watch it" replays check this so they stop when you move on
let tick = null;
function stopTimer() { clearInterval(tick); tick = null; }
function startTimer() {
  stopTimer(); const c = S.cur; c.t0 = Date.now();
  if (!mem.timer) return;
  const total = mem.timer * 1000;
  $('info').insertAdjacentHTML('beforeend', '<div class="timer" id="tm"><i id="tmi"></i></div>');
  tick = setInterval(() => {
    const left = total - (Date.now() - c.t0); const bar = $('tmi'); if (!bar) return stopTimer();
    bar.style.width = Math.max(0, (left / total) * 100) + '%'; $('tm').classList.toggle('low', left < total * 0.3);
    if (left <= 0) { stopTimer(); if (!c.done && c.si === 0 && !c.moved) { mem.speed.late++; save(); giveUp('Out of time. In a real game this is the moment to trust your scan, so look at how the answer works.'); } }
  }, 100);
}
function buttons() {
  if (S.cur.done) return;
  $('btns').innerHTML = '<button id="hint" class="ghost">Hint</button><button id="show" class="ghost">Show solution</button>';
  $('hint').onclick = hint; $('show').onclick = () => giveUp();
}
function hint() {
  const c = S.cur; const h = c.p.hints[Math.min(2, c.hintLevel)]; c.hintLevel++; c.hints++;
  if (typeof h === 'string') { $('feed').innerHTML = `<div class="msg">${esc(h)}</div>`; return; }
  board.setMarks(h.from ? { [h.from]: 'hl' } : {});
  if (h.to) board.setArrows([{ from: h.from, to: h.to }]);
  $('feed').innerHTML = `<div class="msg">${esc(h.text)}</div>`;
}
async function onMove(uci) {
  const c = S.cur; if (c.done) return;
  const before = board.fen(); if (c.si === 0 && !c.moved) { c.moved = true; c.firstMs = Date.now() - c.t0; stopTimer(); }
  board.locked = true; board.setMarks({}); board.setArrows([]);
  const mv = await board.play(uci);
  if (!mv) { board.load(before); board.locked = false; return; }
  const st = c.p.steps[c.si]; const main = c.p.solution[c.si * 2];
  if (uci === main || st.ok.includes(uci)) {
    if (uci !== main) { $('feed').innerHTML = `<div class="msg ok"><b>${esc(mv.san)}</b> also works. The main line was ${esc(c.p.solutionSan[c.si * 2])}.</div>`; return solved(); }
    $('feed').innerHTML = `<div class="msg ok"><b>${esc(mv.san)}</b> is correct.</div>`;
    const reply = c.p.solution[c.si * 2 + 1];
    if (!reply) return solved();
    await sleep(450); if (!S || S.cur !== c) return; await board.playSan(c.p.solutionSan[c.si * 2 + 1]); if (!S || S.cur !== c) return; c.si++;
    $('feed').innerHTML += `<div class="msg">Your opponent replied <b>${esc(c.p.solutionSan[c.si * 2 - 1])}</b>. What's next?</div>`;
    board.locked = false; return;
  }
  c.wrong++;
  const b = st.bad[uci];
  board.setMarks({ [uci.slice(2, 4)]: 'bad' });
  $('feed').innerHTML = `<div class="msg no"><b>Not quite.</b> ${b ? md(b[0]) : `${esc(mv.san)} isn't the best move here.`}${b && b[1].length ? `<div class="small">For example: ${esc(b[1].join(' '))}</div>` : ''}${b && b[2] ? '<div class="small">That is a decent move, but there is something stronger.</div>' : ''}${c.wrong >= 2 && !c.hintLevel ? '<div class="small">Stuck? Try the hint.</div>' : ''}</div>`;
  await sleep(1100);
  if (!S || S.cur !== c || c.done) return; // you pressed "Show solution", the timer ran out, or you moved on: leave the board alone
  board.load(before); board.locked = false;
}
function reveal(p) { return `<div class="rv"><div>${esc(p.reveal.idea)}</div><div class="small">Line: ${esc(p.reveal.line)}</div><div class="small rem"><b>Remember:</b> ${esc(p.reveal.takeaway)}</div></div>`; }
function solved() {
  const c = S.cur; c.done = true; stopTimer();
  if (c.wrong === 0 && c.firstMs) { mem.speed.n++; mem.speed.ms += c.firstMs; if (!mem.timer || c.firstMs <= mem.timer * 1000) mem.speed.inTime++; } board.locked = true; S.results[S.i] = true; dots();
  record(c.p, true, c.wrong === 0 && c.hints === 0);
  $('feed').innerHTML += `<div class="msg ok"><b>${c.wrong === 0 && !c.hints ? `Solved first try${c.firstMs ? ' in ' + (c.firstMs / 1000).toFixed(1) + ' s' : ''}.` : 'Solved.'}</b> <span class="tag">${esc(c.p.themeLabel)}</span>${reveal(c.p)}</div>`;
  $('btns').innerHTML = `<button class="primary" id="next">${S.i + 1 >= S.list.length ? 'Finish' : 'Next puzzle'}</button>`; $('next').onclick = next;
}
function giveUp(why) {
  const c = S.cur; if (c.done) return; c.done = true; stopTimer(); board.locked = true; S.results[S.i] = false; dots(); // a second click must not record the miss twice
  record(c.p, false, false);
  if (!S.retried.has(c.p.id) && S.list.length < 14) { S.retried.add(c.p.id); S.list.push(c.p); } // missed ones come back once, at the end
  $('feed').innerHTML = `<div class="msg no">${why ? `<div>${esc(why)}</div>` : ''}<b>The solution:</b> ${esc(c.p.reveal.line)}<span class="tag">${esc(c.p.themeLabel)}</span>${reveal(c.p)}<div class="small muted">This one comes back at the end of the session.</div></div>`;
  $('btns').innerHTML = `<button id="watch">Watch it</button><button class="primary" id="next">${S.i + 1 >= S.list.length ? 'Finish' : 'Next puzzle'}</button>`;
  $('next').onclick = next;
  $('watch').onclick = async () => {
    const mine = ++replayToken;
    board.load(c.p.fen); board.interactive = false;
    for (const san of c.p.solutionSan) { await sleep(700); if (mine !== replayToken || !S || S.cur !== c) return; await board.playSan(san); }
    if (mine === replayToken && S && S.cur === c) board.interactive = true;
  };
  board.load(c.p.fen); board.setArrows([{ from: c.p.solution[0].slice(0, 2), to: c.p.solution[0].slice(2, 4) }]);
}
function next() { if (!S || !S.cur || !S.cur.done) return; stopTimer(); S.i++; if (S.i >= S.list.length) finish(); else load1(); }
function finish() {
  stopTimer(); replayToken++; cancelCountdown();
  if (!S) { renderMenu(); return; }
  const done = S.results.map((r, i) => [r, S.list[i]]).filter(([r]) => r !== undefined);
  const ok = done.filter(([r]) => r).length;
  const by = {};
  done.forEach(([r, p]) => { const t = by[p.themeLabel] || (by[p.themeLabel] = { ok: 0, n: 0 }); t.n++; if (r) t.ok++; });
  const key = S.modeKey; const label = S.label;
  S = null;
  summaryScreen('Session complete', `${ok}/${done.length}`, 'solved', Object.entries(by).slice(0, 6).map(([k, t]) => `<div class="srow2"><span>${esc(k)}</span><b>${t.ok} of ${t.n}</b></div>`).join(''), '', `Drill ${esc(label)} again`, () => start(key, label));
}


// ---- safety scan: instinct trainer. Answers come from public/js/loose.js, which only counts REAL recaptures ----
const LOOSE = makeLoose(Chess);
const TAP = ['n', 'b', 'r', 'q']; const PNAME = { n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };
const scanMode = () => (mem.scanMode === 'hanging' ? 'hanging' : 'undefended');
const truthOf = (r) => r.pieces.filter((x) => (scanMode() === 'hanging' ? x.hanging : x.undefended));
// Rounds come from positions analysed at build time (DATA.scan), so choosing the next one is instant.
const expandPieces = (arr) => arr.map(([sq, c, t, d, b, at, g]) => ({
  square: sq, color: c, type: t,
  defenders: d.map((x) => ({ square: x.slice(0, 2), type: x[2] })),
  blocked: b.map((x) => ({ square: x.slice(0, 2), type: x[2], why: x[2] === 'k' ? 'the king would step into check' : 'it is pinned' })),
  attackers: at.map((x) => ({ square: x.slice(0, 2), type: x[2] })),
  undefended: d.length === 0, hanging: g > 0, gain: g,
}));
let scanPool = null;
function nextScanRound(wantNone) {
  if (!scanPool) scanPool = (DATA.scan || []).map((x) => ({ fen: `${x.f} - - 0 1`, side: x.f.split(' ')[1], mine: x.m, raw: x.p, pieces: null }));
  const max = scanMode() === 'hanging' ? 3 : 5;
  const recent = new Set(mem.scanSeen || []);
  const ok = scanPool.filter((r) => {
    const n = r.raw.filter((x) => (scanMode() === 'hanging' ? x[6] > 0 : x[3].length === 0)).length;
    return !recent.has(r.fen) && (wantNone ? n === 0 : n >= 1 && n <= max);
  });
  if (!ok.length) { mem.scanSeen = []; return wantNone ? null : scanPool.length ? nextScanRound(false) : null; }
  const r = ok[Math.floor(Math.random() * ok.length)];
  mem.scanSeen = [...(mem.scanSeen || []), r.fen].slice(-300); save();
  return { fen: r.fen, side: r.side, pieces: expandPieces(r.raw) };
}
function startScan() { S = { scan: true, active: true, rounds: [], total: 8, i: 0, score: [], label: 'Safety scan' }; renderScan(); scanRound(); }
function renderScan() { sessionShell('Safety scan', scanSummary); dotsScan(); }
function dotsScan() { $('dots').innerHTML = Array.from({ length: S.total }, (_, i) => `<i class="${S.score[i] === undefined ? '' : S.score[i] ? 'ok' : 'no'} ${i === S.i ? 'cur' : ''}"></i>`).join(''); }
async function scanRound() {
  if (S.i >= S.total) return scanSummary();
  const r = S.rounds[S.i] || (S.rounds[S.i] = nextScanRound(Math.random() < 0.25) || nextScanRound(false));
  if (!r) return scanSummary();
  const cur = S.cur = { r, picks: new Set(), t0: Date.now(), done: false }; dotsScan(); stopTimer();
  board.load(r.fen); board.flip(r.side); board.interactive = false; board.locked = true; board.onSquare = null; board.setMarks({}); board.setArrows([]);
  $('info').innerHTML = ''; $('feed').innerHTML = ''; $('btns').innerHTML = '';
  const go = await runCountdown({ title: `Safety scan ${S.i + 1} of ${S.total}`, sub: scanMode() === 'hanging' ? 'Find the pieces that can be won right now. Both colours count.' : 'Find the pieces nothing defends. Both colours count.' });
  if (!go || !S || S.cur !== cur) return;
  cur.t0 = Date.now(); board.interactive = true; board.locked = false; // the clock starts when the position appears
  board.onSquare = (sq) => {
    if (S.cur.done) return; const pc = board.chess.get(sq);
    if (!pc || !TAP.includes(pc.type)) return; // only knights, bishops, rooks and queens count
    if (S.cur.picks.has(sq)) S.cur.picks.delete(sq); else S.cur.picks.add(sq);
    board.setMarks(Object.fromEntries([...S.cur.picks].map((q) => [q, 'sel'])));
  };
  const total = 10000;
  const rule = scanMode() === 'hanging'
    ? 'Tap every knight, bishop, rook or queen that <b>can be won right now</b>: attacked, and taking it nets material.'
    : 'Tap every knight, bishop, rook or queen that <b>nothing defends</b>. A pinned piece, or a king that would step into check, does not defend.';
  $('info').innerHTML = `<div class="status"><b>Safety scan</b><span>${S.i + 1}/${S.total}</span><span>both colours · none? tap None</span></div><div class="why">${rule}</div><div class="timer" id="tm"><i id="tmi"></i></div>`;
  $('feed').innerHTML = ''; $('btns').innerHTML = '<button class="primary" id="done">Done</button><button id="none">None</button>';
  const armed = () => Date.now() - S.cur.t0 > 400; // a stray second click on the previous Next must not submit this round
  $('done').onclick = () => { if (armed()) scanCheck(); }; $('none').onclick = () => { if (!armed()) return; S.cur.picks.clear(); scanCheck(); };
  tick = setInterval(() => { const left = total - (Date.now() - S.cur.t0); const bar = $('tmi'); if (!bar) return stopTimer(); bar.style.width = Math.max(0, left / total * 100) + '%'; $('tm').classList.toggle('low', left < 3000); if (left <= 0) scanCheck(); }, 100);
}
function scanCheck() {
  const c = S.cur; if (c.done) return; c.done = true; stopTimer(); board.onSquare = null; board.interactive = false;
  const ms = Date.now() - c.t0; const by = Object.fromEntries(c.r.pieces.map((x) => [x.square, x]));
  const truth = new Set(truthOf(c.r).map((x) => x.square));
  const hits = [...c.picks].filter((q) => truth.has(q)); const falses = [...c.picks].filter((q) => !truth.has(q)); const missed = [...truth].filter((q) => !c.picks.has(q));
  const perfect = !falses.length && !missed.length; S.score[S.i] = perfect; dotsScan();
  mem.scan.rounds++; mem.scan.hits += hits.length; mem.scan.missed += missed.length; mem.scan.falses += falses.length; mem.scan.ms += ms; save();
  const marks = {}; hits.forEach((q) => { marks[q] = 'good'; }); falses.forEach((q) => { marks[q] = 'bad'; }); missed.forEach((q) => { marks[q] = 'hl'; }); board.setMarks(marks);
  // arrows: green = who defends a piece you tapped wrongly; red = what attacks a piece you missed
  const arrows = [];
  falses.forEach((q) => by[q].defenders.forEach((d) => arrows.push({ from: d.square, to: q, cls: 'good' })));
  falses.forEach((q) => { if (scanMode() === 'hanging') by[q].attackers.forEach((a) => arrows.push({ from: a.square, to: q, cls: 'bad' })); });
  missed.forEach((q) => by[q].attackers.forEach((a) => arrows.push({ from: a.square, to: q, cls: 'bad' })));
  board.setArrows(arrows.slice(0, 10));
  const section = (title, list) => (list.length ? `<div class="sec"><b>${title}</b>${list.slice(0, 3).map((q) => `<div>${esc(LOOSE.explain(by[q]))}</div>`).join('')}${list.length > 3 ? `<div class="muted">…and ${list.length - 3} more</div>` : ''}</div>` : '');
  const what = scanMode() === 'hanging' ? 'winnable' : 'undefended';
  $('feed').innerHTML = `<div class="msg ${perfect ? 'ok' : 'no'}"><b>${perfect ? (truth.size ? 'Spotted them all' : `Right, nothing was ${what}`) : `Found ${hits.length} of ${truth.size}`}</b> in ${(ms / 1000).toFixed(1)} s.
    ${perfect ? section('Why', hits) : ''}${section(`Tapped, but not ${what}`, falses)}${section('Missed', missed)}
    <div class="legend">green found · red not ${what} · blue missed · arrows: green defends, red attacks</div></div>`;
  $('btns').innerHTML = `<button class="primary" id="next">${S.i + 1 >= S.total ? 'Finish' : 'Next position'}</button>`;
  $('next').onclick = (e) => { if (e.currentTarget.disabled) return; e.currentTarget.disabled = true; S.i++; if (S.i >= S.total) scanSummary(); else scanRound(); };
}
function scanSummary() {
  stopTimer(); cancelCountdown(); if (board) board.onSquare = null;
  const done = S.score.filter((x) => x !== undefined); const ok = done.filter(Boolean).length; S = null;
  summaryScreen('Scan complete', `${ok}/${done.length}`, 'positions read perfectly', '', 'The aim is to see the answer before you can explain it. Keep the 10 second limit, do a few rounds a day, then try the other mode in Settings.', 'Another round', startScan);
}

// ---- square control: tap every square White controls (board-vision trainer). Answers come from public/js/control.js ----
const CTRL = makeControl(Chess);
const region = () => (mem.ctrlRegion === 'near' || mem.ctrlRegion === 'far' ? mem.ctrlRegion : 'both');
const sidePref = () => (mem.ctrlSide === 'w' || mem.ctrlSide === 'b' ? mem.ctrlSide : 'mixed');
const SIDE_NAME = { w: 'White', b: 'Black' };
// "near" / "far" are seen from the side being read: its own half, or the opponent's half
const regionText = (color) => ({
  both: 'across the whole board',
  near: color === 'w' ? "on White's own half (ranks 1–4)" : "on Black's own half (ranks 8–5)",
  far: color === 'w' ? "on the far half, the opponent's side (ranks 5–8)" : "on the far half, the opponent's side (ranks 4–1)",
}[region()]);
let ctrlPool = null;
function ctrlRounds(n = 6) {
  if (!ctrlPool) ctrlPool = (DATA.scan || []).filter((x) => x.c && x.cb).map((x) => ({ fen: `${x.f} - - 0 1`, m: { w: x.c, b: x.cb } }));
  const [lo, hi] = region() === 'both' ? [14, 28] : [6, 16]; // enough squares to be a real test, few enough to tap in one go
  // which colour each round is about: the chosen side, or White and Black alternating from a random start
  const first = Math.random() < 0.5 ? 'w' : 'b'; const second = first === 'w' ? 'b' : 'w';
  const colors = Array.from({ length: n }, (_, i) => (sidePref() === 'mixed' ? (i % 2 ? second : first) : sidePref()));
  const seen = new Set(mem.ctrlSeen || []); const used = new Set(); const rounds = [];
  for (const color of colors) {
    const count = (r) => CTRL.count(r.m[color], region(), color);
    let ok = ctrlPool.filter((r) => !used.has(r.fen) && !seen.has(r.fen + color) && count(r) >= lo && count(r) <= hi);
    if (!ok.length) ok = ctrlPool.filter((r) => !used.has(r.fen) && count(r) >= lo && count(r) <= hi);
    if (!ok.length) continue;
    const r = ok[Math.floor(Math.random() * ok.length)]; used.add(r.fen); rounds.push({ fen: r.fen, color, n: count(r) });
  }
  rounds.sort((a, b) => a.n - b.n); // easier positions (fewer squares) first
  mem.ctrlSeen = [...(mem.ctrlSeen || []), ...rounds.map((r) => r.fen + r.color)].slice(-400); save();
  return rounds;
}
function startCtrl() {
  const rounds = ctrlRounds(6);
  if (!rounds.length) { view().innerHTML = '<div class="card">No suitable positions found.</div>'; return; }
  S = { ctrl: true, active: true, rounds, total: rounds.length, i: 0, score: [], label: 'Square control' }; renderCtrl(); ctrlRound();
}
function renderCtrl() { sessionShell('Square control', ctrlSummary); dotsCtrl(); }
function dotsCtrl() { $('dots').innerHTML = Array.from({ length: S.total }, (_, i) => `<i class="${S.score[i] === undefined ? '' : S.score[i] ? 'ok' : 'no'} ${i === S.i ? 'cur' : ''}"></i>`).join(''); }
async function ctrlRound() {
  if (S.i >= S.total) return ctrlSummary();
  const r = S.rounds[S.i]; stopTimer(); const color = r.color; const W = SIDE_NAME[color];
  const truth = CTRL.controlled(r.fen, color); const need = Object.keys(truth).filter((q) => CTRL.inRegion(q, region(), color)).length;
  const cur = S.cur = { r, color, truth, picks: new Set(), t0: Date.now(), done: false };
  dotsCtrl(); board.load(r.fen); board.flip(color); board.interactive = false; board.locked = true; board.onSquare = null; board.setMarks({}); board.setArrows([]);
  $('info').innerHTML = ''; $('feed').innerHTML = ''; $('btns').innerHTML = '';
  const go = await runCountdown({ title: `Square control ${S.i + 1} of ${S.total}`, color, sub: `Find the squares ${W.toUpperCase()} controls ${regionText(color)}.` });
  if (!go || !S || S.cur !== cur) return;
  cur.t0 = Date.now(); board.interactive = true; board.locked = false; // the clock starts when the position appears
  board.onSquare = (sq) => {
    if (S.cur.done) return;
    if (!CTRL.inRegion(sq, region(), color)) { $('feed').innerHTML = `<div class="msg">This round is only ${regionText(color)}.</div>`; return; }
    $('feed').innerHTML = '';
    if (S.cur.picks.has(sq)) S.cur.picks.delete(sq); else S.cur.picks.add(sq);
    board.setMarks(Object.fromEntries([...S.cur.picks].map((q) => [q, 'sel'])));
    $('cnt').textContent = S.cur.picks.size;
  };
  $('info').innerHTML = `<div class="status"><span class="chip ${color} mini"><span class="dotc"></span>${W.toUpperCase()}</span><b>${need} squares</b><span>${S.i + 1}/${S.total}</span><span>selected <b id="cnt">0</b></span><span><b id="el">0</b> s</span></div>
    <div class="why">Tap every square ${W} controls ${regionText(color)}: any square a ${W} piece attacks, including its own pieces that another ${W} piece defends. ${W} is at the bottom.</div>`;
  $('feed').innerHTML = ''; $('btns').innerHTML = '<button class="primary" id="done">Done</button><button id="clr">Clear</button>';
  $('done').onclick = () => { if (Date.now() - S.cur.t0 > 400) ctrlCheck(); }; // a stray double-click on the previous Next must not submit
  $('clr').onclick = () => { S.cur.picks.clear(); board.setMarks({}); $('cnt').textContent = 0; };
  tick = setInterval(() => { const e = $('el'); if (!e) return stopTimer(); e.textContent = Math.round((Date.now() - S.cur.t0) / 1000); }, 500);
}
// why a tapped square is NOT controlled, in plain words
function whyNot(fen, sq, color) {
  const c = new Chess(fen); const f = 'abcdefgh'.indexOf(sq[0]); const rk = +sq[1]; const W = SIDE_NAME[color]; const dir = color === 'w' ? 1 : -1;
  const behindRk = rk - dir; // the square a pawn of this colour would stand on to be directly "behind" the tapped square
  const behind = behindRk >= 1 && behindRk <= 8 ? c.get(sq[0] + behindRk) : null;
  if (behind && behind.type === 'p' && behind.color === color) return `the pawn on ${sq[0]}${behindRk} attacks the squares diagonally ahead, not the one straight in front of it`;
  for (const row of c.board()) for (const p of row) {
    if (!p || p.color !== color || !'brq'.includes(p.type)) continue;
    const pf = 'abcdefgh'.indexOf(p.square[0]); const pr = +p.square[1]; const dx = f - pf; const dy = rk - pr;
    const line = (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) && (dx || dy);
    const okType = p.type === 'q' || (p.type === 'r' && (dx === 0 || dy === 0)) || (p.type === 'b' && Math.abs(dx) === Math.abs(dy));
    if (!line || !okType) continue;
    const sx = Math.sign(dx); const sy = Math.sign(dy);
    for (let k = 1; k < Math.max(Math.abs(dx), Math.abs(dy)); k++) {
      const q = 'abcdefgh'[pf + sx * k] + (pr + sy * k); const b = c.get(q);
      if (b) return `the ${{ r: 'rook', b: 'bishop', q: 'queen' }[p.type]} on ${p.square} lines up with it, but the ${b.color === 'w' ? 'White' : 'Black'} ${{ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }[b.type]} on ${q} is in the way`;
    }
  }
  const occ = c.get(sq);
  if (occ && occ.color === color) return `${W}'s own ${{ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }[occ.type]} stands there and no other ${W} piece defends it`;
  return `no ${W} piece attacks it`;
}
function ctrlCheck() {
  const c = S.cur; if (c.done) return; c.done = true; stopTimer(); board.onSquare = null; board.interactive = false;
  const W = SIDE_NAME[c.color]; const ms = Date.now() - c.t0; const T = new Set(Object.keys(c.truth).filter((q) => CTRL.inRegion(q, region(), c.color)));
  const hits = [...c.picks].filter((q) => T.has(q)); const falses = [...c.picks].filter((q) => !T.has(q)); const missed = [...T].filter((q) => !c.picks.has(q));
  const perfect = !falses.length && !missed.length; S.score[S.i] = perfect; dotsCtrl();
  mem.ctrl.rounds++; mem.ctrl.hits += hits.length; mem.ctrl.missed += missed.length; mem.ctrl.falses += falses.length; mem.ctrl.ms += ms; save();
  const marks = {}; hits.forEach((q) => { marks[q] = 'good'; }); falses.forEach((q) => { marks[q] = 'bad'; }); missed.forEach((q) => { marks[q] = 'hl'; }); board.setMarks(marks);
  const arrows = []; missed.slice(0, 5).forEach((q) => c.truth[q].forEach((a) => arrows.push({ from: a.square, to: q, cls: 'good' }))); board.setArrows(arrows.slice(0, 10));
  const sec = (title, list, line) => (list.length ? `<div class="sec"><b>${title}</b>${list.slice(0, 3).map((q) => `<div>${esc(line(q))}</div>`).join('')}${list.length > 3 ? `<div class="muted">…and ${list.length - 3} more</div>` : ''}</div>` : '');
  $('feed').innerHTML = `<div class="msg ${perfect ? 'ok' : 'no'}"><b>${perfect ? 'Every square, nothing extra' : `Found ${hits.length} of ${T.size}${falses.length ? `, ${falses.length} not controlled` : ''}`}</b> in ${(ms / 1000).toFixed(1)} s.
    ${sec('Missed', missed, (q) => `${q}: attacked by the ${CTRL.names(c.truth[q])}`)}${sec(`Tapped, but ${W} does not control them`, falses, (q) => `${q}: ${whyNot(c.r.fen, q, c.color)}`)}
    <div class="legend">green correct · red not controlled · blue missed · arrows: who attacks a missed square</div></div>`;
  $('btns').innerHTML = `<button class="primary" id="next">${S.i + 1 >= S.total ? 'Finish' : 'Next position'}</button>`;
  $('next').onclick = (e) => { if (e.currentTarget.disabled) return; e.currentTarget.disabled = true; S.i++; if (S.i >= S.total) ctrlSummary(); else ctrlRound(); };
}
function ctrlSummary() {
  stopTimer(); cancelCountdown(); if (board) board.onSquare = null;
  const done = S.score.filter((x) => x !== undefined); const ok = done.filter(Boolean).length; S = null;
  summaryScreen('Square control complete', `${ok}/${done.length}`, 'positions read perfectly', '', "Aim for the whole board in under 30 seconds: see each piece's lines first, then the pawn diagonals. Reading Black from Black's side is the same skill, so keep both colours in the mix. The far half, the opponent's side, is where most players slip.", 'Another set', startCtrl);
}

// ---- weak spots: the top five on one screen ----
function renderWeak() {
  const pr = DATA.profile; const list = pr.weaknesses.slice(0, 5); const max = Math.max(1, ...list.map((w) => w.count));
  const drill = { hangingPiece: 'hanging', winsMaterial: 'exchanges', fork: 'forks', mate: 'mates', backRankMate: 'mates' };
  const rows = list.map((w) => `<div class="wrow"><div class="wmain"><div class="wl"><b>${esc(w.label)}</b><span>${plural(w.count, 'time')}</span></div><div class="bar"><i style="width:${(w.count / max) * 100}%"></i></div></div>${drill[w.theme] ? `<button class="primary" data-d="${drill[w.theme]}" data-l="${esc(w.label)}">Drill</button>` : '<span></span>'}</div>`).join('');
  const top = list[0];
  view().innerHTML = `<div class="weakpage"><div class="hint">From ${pr.games} reviewed games. Each count is a move that cost you at least an inaccuracy.</div>${rows}
    ${top ? `<div class="msg"><b>${esc(top.label)}:</b> ${esc(top.advice)}</div>` : ''}
    <div class="check"><b>Before every move:</b> 1. What did their last move attack? 2. Is every piece of mine defended? 3. If I capture, what can they take back?</div></div>`;
  view().querySelectorAll('button[data-d]').forEach((b) => { b.onclick = () => start(b.dataset.d, b.dataset.l); });
}

// ---- progress: five short pages, each fits on one screen ----
const PAGES = [['goal', 'Goal'], ['streak', 'Streak'], ['speed', 'Speed'], ['slips', 'Slips'], ['drills', 'Drills']];
function progressPage(page) {
  const g = DATA.progress; const th = mem.themes; const labels = {};
  PUZ.forEach((p) => { labels[p.theme] = p.themeLabel; });
  const d = (a, b, lowerBetter) => { const x = +(a - b).toFixed(2); if (!x) return '–'; const good = lowerBetter ? x < 0 : x > 0; return `<span class="${good ? 'up' : 'down'}">${x > 0 ? '+' : ''}${x}</span>`; };
  const row = (name, k, lb) => `<tr><td>${name}</td><td>${g.before[k]}</td><td>${g.streak[k]}</td><td>${d(g.streak[k], g.before[k], lb)}</td></tr>`;
  const row2 = (name, k, lb) => `<tr><td>${name}</td><td>${g.older[k]}</td><td>${g.newer[k]}</td><td>${d(g.newer[k], g.older[k], lb)}</td></tr>`;
  if (page === 'goal') return goalCard(true);
  if (page === 'streak') {
    return `<div class="card"><h3>Recent streak vs before</h3><p class="note2">${g.streak.games} live games in the streak against ${g.before.games} before. Four games is a small sample: encouraging, not proven.</p>
      <table><tr><th></th><th>Before</th><th>Streak</th><th>Change</th></tr>${row('Accuracy %', 'accuracy')}${row('Blunders / game', 'blunders', 1)}${row('Mistakes / game', 'mistakes', 1)}${row('Hung pieces / game', 'hanging', 1)}</table></div>
      <div class="card"><h3>Older half vs newer half</h3><p class="note2">${g.older.games} games each: the longer trend.</p>
      <table><tr><th></th><th>Older</th><th>Newer</th><th>Change</th></tr>${row2('Accuracy %', 'accuracy')}${row2('Blunders / game', 'blunders', 1)}${row2('Hung pieces / game', 'hanging', 1)}</table></div>`;
  }
  if (page === 'speed') {
    if (!DATA.speed) return '<div class="card">No clock data.</div>';
    return `<div class="card note"><h3>Does playing fast cost you?</h3><p class="note2">${DATA.speed.games} ten-minute games, ${DATA.speed.moves} of your moves. Median ${DATA.speed.medianSeconds} s a move.</p>
      <table><tr><th>Time on the move</th><th>All positions</th><th>Balanced middlegames</th></tr>${DATA.speed.raw.map((r, i) => `<tr><td>${r.label}</td><td>${r.blunderPct}%</td><td>${DATA.speed.controlled[i].blunderPct}%</td></tr>`).join('')}</table>
      <p class="note2" style="margin-top:8px">Blunder rate by time spent. Long thinks look worse only because hard positions take longer: compare like with like (${DATA.speed.controlledMoves} balanced middlegame moves) and it is about the same at 3 seconds as at 15. Slowing down everywhere will not fix it. A safe instinct will.</p></div>`;
  }
  if (page === 'slips') {
    if (!DATA.slips) return '<div class="card">No slip data.</div>';
    const s = DATA.slips;
    return `<div class="card note"><h3>Mouse slips vs chess mistakes</h3>
      <div class="stats"><div class="stat"><b>${s.strong}</b><span>possible slips</span></div><div class="stat"><b>${s.oppStrong}</b><span>opponents, same test</span></div><div class="stat"><b>${s.accuracyNow}→${s.accuracyAdjusted}%</b><span>accuracy if fixed</span></div></div>
      <p class="note2" style="margin:6px 0">A good move one square away happens in ${s.blunderNearRate}% of your blunders and ${s.oppBlunderNearRate}% of your opponents': no extra pattern. Likeliest slips (fast moves):</p>
      <table><tr><th>Played</th><th>One square off</th><th>Time</th><th>Cost</th></tr>${s.list.slice(0, 5).map((x) => `<tr><td>${esc(x.move)}</td><td>${esc(x.alt)}</td><td>${x.seconds == null ? '–' : x.seconds + ' s'}</td><td>−${x.loss}%</td></tr>`).join('')}</table></div>`;
  }
  const dd = mem.days[today()] || { ok: 0, fail: 0 };
  const themeRows = Object.entries(th).sort((a, b) => (b[1].ok + b[1].fail) - (a[1].ok + a[1].fail)).slice(0, 5);
  return `<div class="card"><h3>This device</h3><div class="stats">
      <div class="stat"><b>${dd.ok}</b><span>solved today</span></div><div class="stat"><b>${dd.fail}</b><span>missed today</span></div><div class="stat"><b>${Object.keys(mem.p).length}</b><span>puzzles tried</span></div>
      <div class="stat"><b>${mem.scan.rounds}</b><span>scans${mem.scan.rounds ? ` · ${(mem.scan.ms / mem.scan.rounds / 1000).toFixed(1)} s each` : ''}</span></div>
      <div class="stat"><b>${mem.ctrl.rounds}</b><span>control rounds${mem.ctrl.rounds ? ` · ${Math.round(100 * mem.ctrl.hits / Math.max(1, mem.ctrl.hits + mem.ctrl.missed))}% found` : ''}</span></div>
      <div class="stat"><b>${mem.speed.n ? (mem.speed.ms / mem.speed.n / 1000).toFixed(1) + ' s' : '–'}</b><span>first-try solve</span></div></div>
      ${themeRows.length ? `<table style="margin-top:8px"><tr><th>Theme</th><th>Solved</th><th>Missed</th><th>First try</th></tr>${themeRows.map(([k, v]) => `<tr><td>${esc(labels[k] || k)}</td><td>${v.ok}</td><td>${v.fail}</td><td>${v.clean}</td></tr>`).join('')}</table>` : '<p class="note2" style="margin-top:8px">Solve a few puzzles and your results show up here. They are saved in this browser only.</p>'}</div>`;
}
function renderProgress() {
  const page = PAGES.some(([k]) => k === mem.progressPage) ? mem.progressPage : 'goal';
  view().innerHTML = `<div class="pagebar seg" id="pgbar">${PAGES.map(([k, l]) => `<button data-p="${k}" class="${page === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="pagebody">${progressPage(page)}</div>`;
  $('pgbar').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; mem.progressPage = b.dataset.p; save(); renderProgress(); };
  bindGoal(renderProgress);
}

function afterProgress() { bindGoal(renderProgress); }
show('drill');
window.__drill = { get session() { return S; }, loose: LOOSE, rerender: () => renderMenu() }; // debugging hook
