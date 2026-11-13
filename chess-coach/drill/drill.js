// Drill edition client. Expects globals: Chess, Board (concatenated by scripts/build-drill.js).
const DATA = JSON.parse(document.getElementById('data').textContent);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---- per-device progress (nice to have; the page works without it) ----
const KEY = 'chess-coach-drills-v1';
let mem = { p: {}, days: {}, themes: {}, rating: {}, timer: 0, speed: { n: 0, ms: 0, inTime: 0, late: 0 }, scan: { rounds: 0, hits: 0, missed: 0, falses: 0, ms: 0 } };
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

// ---- tabs ----
let board = null; let S = null; let tab = 'drill';
document.querySelectorAll('nav button').forEach((b) => { b.onclick = () => show(b.dataset.tab); });
function show(t) {
  tab = t; stopTimer();
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  ({ drill: renderMenu, weak: renderWeak, progress: renderProgress })[t]();
}
const view = () => $('view');


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

// ---- menu ----
function renderMenu() {
  if (S && S.active) { if (S.scan) { renderScan(); scanRound(); } else { renderSession(); load1(); } return; }
  const w = DATA.profile.weaknesses;
  const hang = w.find((x) => x.theme === 'hangingPiece');
  const d = mem.days[today()] || { ok: 0, fail: 0 };
  const count = (f) => PUZ.filter(f).length;
  view().innerHTML = `<div class="menu">
    ${goalCard(false)}
    <button class="hero" id="m-hanging"><b>Stop hanging pieces</b><span>${hang ? `Your biggest leak: ${plural(hang.count, 'mistake')} in ${DATA.profile.games} games.` : 'Your biggest leak.'} ${count(FILTERS.hanging)} puzzles. Find the free piece, or spot yours before it's taken.</span></button>
    <div class="card"><h3>Your real openings</h3>
      <p class="muted small" style="margin-bottom:8px">Positions from your own games, in the first 10 moves, where the engine had a better move. The game replays up to your opponent's last move and you find the improvement. Positions you keep getting wrong come up more often.</p>
      <div class="opens"><button class="primary" id="m-ow">As White (${count(FILTERS.openW)})</button><button class="primary" id="m-ob">As Black (${count(FILTERS.openB)})</button><button id="m-later">Middlegame mistakes (${count(FILTERS.later)})</button></div></div>
    <div class="card"><h3>Train your instinct</h3>
      <p class="muted small" style="margin-bottom:8px">Your fast moves are not your problem: in balanced middlegames you blunder about as often at 3 seconds as at 15. The goal is a safety scan that runs on its own, so the fast move is also the safe one.</p>
      <div class="row"><button class="primary" id="m-scan">Safety scan</button><span class="small muted">Scan finds</span><span class="seg" id="smode">${[['undefended', 'Undefended'], ['hanging', 'Winnable']].map(([v, l]) => `<button data-s="${v}" class="${scanMode() === v ? 'on' : ''}">${l}</button>`).join('')}</span><span class="small muted">Puzzle timer</span>
      <span class="seg" id="seg">${[[0, 'Off'], [10, '10 s'], [5, '5 s']].map(([v, l]) => `<button data-t="${v}" class="${(mem.timer || 0) === v ? 'on' : ''}">${l}</button>`).join('')}</span></div></div>
    <div class="modes">
      <button class="mode" data-m="mine"><b>Your own mistakes</b><span>${count(FILTERS.mine)} positions from your games</span></button>
      <button class="mode" data-m="exchanges"><b>Material &amp; exchanges</b><span>Count the trade to the end · ${count(FILTERS.exchanges)}</span></button>
      <button class="mode" data-m="forks"><b>Forks, pins &amp; skewers</b><span>Hit two things at once · ${count(FILTERS.forks)}</span></button>
      <button class="mode" data-m="mates"><b>Checkmates</b><span>Including back-rank · ${count(FILTERS.mates)}</span></button>
      <button class="mode" data-m="mixed"><b>Mixed set</b><span>Easier ones from every theme</span></button>
    </div>
    <div class="card"><h3>Before every move in your games</h3><ol class="checks"><li>What did my opponent's last move attack?</li><li>Is every piece I own defended, or does it have somewhere safe to go?</li><li>If I capture, what can they take back?</li></ol></div>
    <div class="stats"><div class="stat"><b>${d.ok}</b><span>solved today</span></div><div class="stat"><b>${d.fail}</b><span>missed today</span></div><div class="stat"><b>${Object.keys(mem.p).length}</b><span>puzzles tried</span></div></div>
  </div>`;
  $('m-hanging').onclick = () => start('hanging', 'Hanging pieces');
  $('m-scan').onclick = startScan;
  $('m-ow').onclick = () => start('openW', 'Your openings as White'); $('m-ob').onclick = () => start('openB', 'Your openings as Black'); $('m-later').onclick = () => start('later', 'Your middlegame mistakes');
  bindGoal(renderMenu);
  $('smode').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; mem.scanMode = b.dataset.s; save(); renderMenu(); };
  $('seg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; mem.timer = +b.dataset.t; save(); renderMenu(); };
  document.querySelectorAll('.mode').forEach((b) => { b.onclick = () => start(b.dataset.m, b.querySelector('b').textContent.replace('&amp;', '&')); });
}

// ---- session ----
function start(modeKey, label) {
  const list = choose(FILTERS[modeKey], 10);
  if (!list.length) { view().innerHTML = '<div class="card">No puzzles for that yet.</div>'; return; }
  S = { active: true, label, modeKey, list, i: 0, results: [], retried: new Set() };
  renderSession(); load1();
}
function renderSession() {
  view().innerHTML = `<div class="split"><div><div id="pb"></div><div class="tools"><button id="flip">Flip board</button></div></div>
    <div><div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(S.label)}</h2><button class="ghost small" id="quit">End session</button></div>
    <div class="dots" id="dots"></div><div id="info"></div><div id="feed"></div><div class="tools" id="btns"></div></div></div>`;
  board = new Board($('pb'), { onMove });
  $('flip').onclick = () => board.flip(); $('quit').onclick = finish;
  dots();
}
function dots() { $('dots').innerHTML = S.list.map((p, i) => `<i class="${S.results[i] === undefined ? '' : S.results[i] ? 'ok' : 'no'} ${i === S.i ? 'cur' : ''}"></i>`).join(''); }
const sideName = (s) => (s === 'w' ? 'White' : 'Black');
async function load1() {
  const p = S.list[S.i]; if (!p) return finish();
  S.cur = { p, si: 0, wrong: 0, hints: 0, hintLevel: 0, done: false };
  dots();
  board.flip(p.side); board.locked = true; board.interactive = true;
  board.load(p.setup ? p.setup.fen : p.fen);
  $('feed').innerHTML = ''; $('btns').innerHTML = '';
  const why = p.real ? `From <b>your game</b> (${esc(p.ctx)}). You played <b>${esc(p.yourMove)}</b> here${p.times > 1 ? ` and you have reached this exact position ${p.times} times` : ''}. Find a better move.` : p.origin === 'my-mistake' ? `From <b>your game</b>: you played <b>${esc(p.yourMove)}</b> here. Find the move you should have played.`
    : p.yourMove ? `From <b>your game</b>: your opponent had just erred and you played <b>${esc(p.yourMove)}</b>. Was there better?` : 'Your opponent just made a mistake. Punish it.';
  $('info').innerHTML = `<div class="msg"><b>${sideName(p.side)} to move.</b> Find the best move.<div class="small muted">${why}</div>
    <div style="margin-top:6px"><span class="tag">Puzzle ${S.i + 1} of ${S.list.length}</span><span class="tag">${'★'.repeat(p.difficulty)}${'☆'.repeat(5 - p.difficulty)}</span>${p.solution.length > 1 ? `<span class="tag">${Math.ceil(p.solution.length / 2)}-move idea</span>` : ''}</div></div>`;
  if (p.setup) { await sleep(450); await board.play(p.setup.move); }
  board.locked = false; buttons(); startTimer();
}
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
    await sleep(450); await board.playSan(c.p.solutionSan[c.si * 2 + 1]); c.si++;
    $('feed').innerHTML += `<div class="msg">Your opponent replied <b>${esc(c.p.solutionSan[c.si * 2 - 1])}</b>. What's next?</div>`;
    board.locked = false; return;
  }
  c.wrong++;
  const b = st.bad[uci];
  board.setMarks({ [uci.slice(2, 4)]: 'bad' });
  $('feed').innerHTML = `<div class="msg no"><b>Not quite.</b> ${b ? md(b[0]) : `${esc(mv.san)} isn't the best move here.`}${b && b[1].length ? `<div class="small">For example: ${esc(b[1].join(' '))}</div>` : ''}${b && b[2] ? '<div class="small">That is a decent move, but there is something stronger.</div>' : ''}${c.wrong >= 2 && !c.hintLevel ? '<div class="small">Stuck? Try the hint.</div>' : ''}</div>`;
  await sleep(1100);
  board.load(before); board.locked = false;
}
function reveal(p) { return `<p>${esc(p.reveal.idea)}</p><p class="small">Line: ${esc(p.reveal.line)}</p><p class="small"><b>Remember:</b> ${esc(p.reveal.takeaway)}</p>`; }
function solved() {
  const c = S.cur; c.done = true; stopTimer();
  if (c.wrong === 0 && c.firstMs) { mem.speed.n++; mem.speed.ms += c.firstMs; if (!mem.timer || c.firstMs <= mem.timer * 1000) mem.speed.inTime++; } board.locked = true; S.results[S.i] = true; dots();
  record(c.p, true, c.wrong === 0 && c.hints === 0);
  $('feed').innerHTML += `<div class="msg ok"><b>${c.wrong === 0 && !c.hints ? `Solved first try${c.firstMs ? ' in ' + (c.firstMs / 1000).toFixed(1) + ' s' : ''}.` : 'Solved.'}</b> <span class="tag">${esc(c.p.themeLabel)}</span>${reveal(c.p)}</div>`;
  $('btns').innerHTML = `<button class="primary" id="next">${S.i + 1 >= S.list.length ? 'Finish' : 'Next puzzle'}</button>`; $('next').onclick = next;
}
function giveUp(why) {
  const c = S.cur; c.done = true; stopTimer(); board.locked = true; S.results[S.i] = false; dots();
  record(c.p, false, false);
  if (!S.retried.has(c.p.id) && S.list.length < 14) { S.retried.add(c.p.id); S.list.push(c.p); } // missed ones come back once, at the end
  $('feed').innerHTML = `<div class="msg no">${why ? `<div>${esc(why)}</div>` : ''}<b>The solution:</b> ${esc(c.p.reveal.line)}<span class="tag">${esc(c.p.themeLabel)}</span>${reveal(c.p)}<div class="small muted">This one comes back at the end of the session.</div></div>`;
  $('btns').innerHTML = `<button id="watch">Watch it</button><button class="primary" id="next">${S.i + 1 >= S.list.length ? 'Finish' : 'Next puzzle'}</button>`;
  $('next').onclick = next;
  $('watch').onclick = async () => { board.load(c.p.fen); board.interactive = false; for (const san of c.p.solutionSan) { await sleep(700); await board.playSan(san); } board.interactive = true; };
  board.load(c.p.fen); board.setArrows([{ from: c.p.solution[0].slice(0, 2), to: c.p.solution[0].slice(2, 4) }]);
}
function next() { stopTimer(); S.i++; if (S.i >= S.list.length) finish(); else load1(); }
function finish() {
  stopTimer();
  if (!S) { renderMenu(); return; }
  const done = S.results.map((r, i) => [r, S.list[i]]).filter(([r]) => r !== undefined);
  const ok = done.filter(([r]) => r).length;
  const by = {};
  done.forEach(([r, p]) => { const t = by[p.themeLabel] || (by[p.themeLabel] = { ok: 0, n: 0 }); t.n++; if (r) t.ok++; });
  const key = S.modeKey; const label = S.label;
  S = null;
  view().innerHTML = `<div class="card"><h2>Session complete</h2><div class="stats" style="margin-bottom:10px"><div class="stat"><b>${ok}/${done.length}</b><span>solved</span></div></div>
    ${Object.entries(by).map(([k, t]) => `<p><b>${esc(k)}</b>: ${t.ok} of ${t.n}</p>`).join('')}
    <div class="row"><button class="primary" id="again">Drill ${esc(label)} again</button><button id="menu">Back to menu</button></div></div>`;
  $('again').onclick = () => start(key, label); $('menu').onclick = renderMenu;
}


// ---- safety scan: instinct trainer. Answers come from public/js/loose.js, which only counts REAL recaptures ----
const LOOSE = makeLoose(Chess);
const TAP = ['n', 'b', 'r', 'q']; const PNAME = { n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };
const scanMode = () => (mem.scanMode === 'hanging' ? 'hanging' : 'undefended');
const truthOf = (r) => r.pieces.filter((x) => (scanMode() === 'hanging' ? x.hanging : x.undefended));
let scanQueue = [];
function nextScanRound(wantNone) {
  const seen = new Set(); const max = scanMode() === 'hanging' ? 3 : 5;
  if (!scanQueue.length) scanQueue = PUZ.map((p) => ({ p, k: Math.random() + (p.mine ? 0.4 : 0) })).sort((a, b) => b.k - a.k).map((x) => x.p);
  for (let tries = 0; tries < 80 && scanQueue.length; tries++) {
    const p = scanQueue.shift(); const key = p.fen.split(' ')[0]; if (seen.has(key)) continue; seen.add(key);
    let pieces; try { pieces = LOOSE.analyze(p.fen); } catch (e) { continue; }
    const r = { fen: p.fen, side: p.side, pieces }; const n = truthOf(r).length;
    if (wantNone ? n === 0 : n >= 1 && n <= max) return r;
  }
  return null;
}
function startScan() { S = { scan: true, active: true, rounds: [], total: 8, i: 0, score: [], label: 'Safety scan' }; renderScan(); scanRound(); }
function renderScan() {
  view().innerHTML = `<div class="split"><div><div id="pb"></div></div><div><div class="row" style="justify-content:space-between"><h2 style="margin:0">Safety scan</h2><button class="ghost small" id="quit">End</button></div>
    <div class="dots" id="dots"></div><div id="info"></div><div id="feed"></div><div class="tools" id="btns"></div></div></div>`;
  board = new Board($('pb'), {});
  $('quit').onclick = scanSummary; dotsScan();
}
function dotsScan() { $('dots').innerHTML = Array.from({ length: S.total }, (_, i) => `<i class="${S.score[i] === undefined ? '' : S.score[i] ? 'ok' : 'no'} ${i === S.i ? 'cur' : ''}"></i>`).join(''); }
function scanRound() {
  if (S.i >= S.total) return scanSummary();
  const r = S.rounds[S.i] || (S.rounds[S.i] = nextScanRound(Math.random() < 0.25) || nextScanRound(false));
  if (!r) return scanSummary();
  S.cur = { r, picks: new Set(), t0: Date.now(), done: false }; dotsScan(); stopTimer();
  board.load(r.fen); board.flip(r.side); board.interactive = true; board.locked = false; board.setMarks({}); board.setArrows([]);
  board.onSquare = (sq) => {
    if (S.cur.done) return; const pc = board.chess.get(sq);
    if (!pc || !TAP.includes(pc.type)) return; // only knights, bishops, rooks and queens count
    if (S.cur.picks.has(sq)) S.cur.picks.delete(sq); else S.cur.picks.add(sq);
    board.setMarks(Object.fromEntries([...S.cur.picks].map((q) => [q, 'sel'])));
  };
  const total = 10000;
  const rule = scanMode() === 'hanging'
    ? 'Tap every knight, bishop, rook or queen that <b>can be won right now</b>: it is attacked and taking it nets material (not defended, or taken by a cheaper piece, or not defended enough).'
    : 'Tap every knight, bishop, rook or queen that <b>nothing defends</b>. A piece only defends if it could really recapture: a pinned piece does not, and neither does a king that would step into check.';
  $('info').innerHTML = `<div class="msg"><b>${sideName(r.side)} to move.</b> ${rule} Either colour. Nothing? Press <b>None</b>.<div class="timer" id="tm"><i id="tmi"></i></div></div>`;
  $('feed').innerHTML = ''; $('btns').innerHTML = '<button class="primary" id="done">Done</button><button id="none">None</button>';
  $('done').onclick = scanCheck; $('none').onclick = () => { S.cur.picks.clear(); scanCheck(); };
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
  const section = (title, list) => (list.length ? `<div class="small" style="margin-top:6px"><b>${title}</b></div>${list.map((q) => `<div class="small">${esc(LOOSE.explain(by[q]))}</div>`).join('')}` : '');
  const what = scanMode() === 'hanging' ? 'winnable' : 'undefended';
  $('feed').innerHTML = `<div class="msg ${perfect ? 'ok' : 'no'}"><b>${perfect ? (truth.size ? 'Spotted them all' : `Right, nothing was ${what}`) : 'Not quite'}</b> in ${(ms / 1000).toFixed(1)} s.
    ${section('Found', hits)}${section(`You tapped these, but they are not ${what}`, falses)}${section('Missed', missed)}
    ${!truth.size && !c.picks.size ? '<div class="small">Nothing here qualified.</div>' : ''}
    <div class="legend" style="margin-top:8px"><span><b style="background:rgba(59,143,90,.7)"></b>found</span><span><b style="background:rgba(200,55,45,.7)"></b>not ${what}</span><span><b style="background:rgba(59,115,185,.7)"></b>missed</span><span>green arrow: defender · red arrow: attacker</span></div></div>`;
  $('btns').innerHTML = `<button class="primary" id="next">${S.i + 1 >= S.total ? 'Finish' : 'Next position'}</button>`;
  $('next').onclick = () => { S.i++; if (S.i >= S.total) scanSummary(); else scanRound(); };
}
function scanSummary() {
  stopTimer(); if (board) board.onSquare = null;
  const done = S.score.filter((x) => x !== undefined); const ok = done.filter(Boolean).length; S = null;
  view().innerHTML = `<div class="card"><h2>Scan complete</h2><div class="stats" style="margin-bottom:10px"><div class="stat"><b>${ok}/${done.length}</b><span>positions read perfectly</span></div></div>
    <p class="muted">The aim is to see the answer before you can explain it. Keep the 10 second limit and do a few rounds a day; once it feels automatic, try the other mode.</p>
    <div class="row"><button class="primary" id="again">Another round</button><button id="menu">Back to menu</button></div></div>`;
  $('again').onclick = startScan; $('menu').onclick = renderMenu;
}

// ---- weak spots ----
function renderWeak() {
  const pr = DATA.profile; const max = Math.max(1, ...pr.weaknesses.map((w) => w.count));
  const drill = { hangingPiece: 'hanging', winsMaterial: 'exchanges', fork: 'forks', mate: 'mates', backRankMate: 'mates' };
  view().innerHTML = `<h2>Your weak spots</h2><p class="muted">From ${pr.games} reviewed rapid and blitz games. Each count is a move that cost you at least an inaccuracy.</p>` +
    pr.weaknesses.map((w) => `<div class="card weak"><div class="row" style="justify-content:space-between"><b>${esc(w.label)}</b><span class="tag">${plural(w.count, 'time')}</span></div>
      <div class="bar"><i style="width:${(w.count / max) * 100}%"></i></div><p style="margin:2px 0">${esc(w.advice)}</p><p class="small muted">${esc(w.lesson || '')}</p>
      ${drill[w.theme] ? `<div><button class="primary" data-d="${drill[w.theme]}" data-l="${esc(w.label)}">Drill this</button></div>` : ''}</div>`).join('');
  view().querySelectorAll('button[data-d]').forEach((b) => { b.onclick = () => { show('drill'); start(b.dataset.d, b.dataset.l); }; });
}

// ---- progress ----
function renderProgress() {
  setTimeout(() => bindGoal(renderProgress), 0);
  const g = DATA.progress; const th = mem.themes; const labels = {};
  PUZ.forEach((p) => { labels[p.theme] = p.themeLabel; });
  const d = (a, b, lowerBetter) => { const x = +(a - b).toFixed(2); if (!x) return '–'; const good = lowerBetter ? x < 0 : x > 0; return `<span class="${good ? 'up' : 'down'}">${x > 0 ? '+' : ''}${x}</span>`; };
  const row = (name, k, lb) => `<tr><td>${name}</td><td>${g.before[k]}</td><td>${g.streak[k]}</td><td>${d(g.streak[k], g.before[k], lb)}</td></tr>`;
  const row2 = (name, k, lb) => `<tr><td>${name}</td><td>${g.older[k]}</td><td>${g.newer[k]}</td><td>${d(g.newer[k], g.older[k], lb)}</td></tr>`;
  view().innerHTML = `<h2>Progress</h2>
    <div style="margin-bottom:12px">${goalCard(true)}</div>
    <div class="card" style="margin-bottom:12px"><h3>Your recent streak vs everything before it</h3><p class="muted small">${g.streak.games} live games in the streak (plus a daily win) against ${g.before.games} before. Four games is a small sample, so treat it as encouraging, not proven.</p>
    <div class="scroll"><table><tr><th></th><th>Before</th><th>Streak</th><th>Change</th></tr>${row('Accuracy %', 'accuracy')}${row('Blunders per game', 'blunders', 1)}${row('Mistakes per game', 'mistakes', 1)}${row('Inaccuracies per game', 'inaccuracies', 1)}${row('Hung pieces per game', 'hanging', 1)}</table></div></div>
    <div class="card" style="margin-bottom:12px"><h3>First half vs second half of your reviewed games</h3><p class="muted small">${g.older.games} games each. This is the longer trend.</p>
    <div class="scroll"><table><tr><th></th><th>Older</th><th>Newer</th><th>Change</th></tr>${row2('Accuracy %', 'accuracy')}${row2('Blunders per game', 'blunders', 1)}${row2('Mistakes per game', 'mistakes', 1)}${row2('Hung pieces per game', 'hanging', 1)}</table></div></div>
    ${DATA.slips ? `<div class="card note" style="margin-bottom:12px"><h3>Mouse slips vs chess mistakes</h3>
      <p class="muted small">I checked every mistake for a good move exactly one square away (same piece one square over, or the piece next to it). Your opponents' mistakes got the same test, as a baseline for coincidence.</p>
      <div class="stats" style="margin-bottom:8px"><div class="stat"><b>${DATA.slips.strong}</b><span>possible slips (you)</span></div><div class="stat"><b>${DATA.slips.oppStrong}</b><span>same test, opponents</span></div><div class="stat"><b>${DATA.slips.fast}</b><span>of yours under 3 s</span></div>
        <div class="stat"><b>${DATA.slips.accuracyNow}%</b><span>accuracy as played</span></div><div class="stat"><b>${DATA.slips.accuracyAdjusted}%</b><span>if those were fixed</span></div></div>
      <p>Your blunders have a good move one square away ${DATA.slips.blunderNearRate}% of the time. Your opponents' blunders: ${DATA.slips.oppBlunderNearRate}%. So there is no extra pattern: slips exist, but they explain only a handful of your ${DATA.slips.blunders} blunders. Fixing every one would move accuracy by about ${(DATA.slips.accuracyAdjusted - DATA.slips.accuracyNow).toFixed(1)} points.</p>
      <p class="small muted" style="margin-top:8px">The likeliest slips are fast ones. You will know which were real:</p>
      <div class="scroll"><table><tr><th>You played</th><th>One square off</th><th>Time</th><th>Cost</th><th></th></tr>${DATA.slips.list.map((x) => `<tr><td>${esc(x.move)}</td><td>${esc(x.alt)} <span class="muted small">(${esc(x.altCls)})</span></td><td>${x.seconds == null ? '–' : x.seconds + ' s'}</td><td>−${x.loss}%</td><td><a href="${esc(x.url)}" target="_blank" rel="noopener">game</a></td></tr>`).join('')}</table></div></div>` : ''}
    ${DATA.speed ? `<div class="card note" style="margin-bottom:12px"><h3>Does playing fast cost you?</h3><p class="muted small">From the clock times in ${DATA.speed.games} ten-minute games (${DATA.speed.moves} of your moves). Your median is ${DATA.speed.medianSeconds} s a move.</p>
      <div class="scroll"><table><tr><th>Time on the move</th><th>All positions: blunder rate</th><th>Balanced middlegames: blunder rate</th></tr>${DATA.speed.raw.map((r, i) => `<tr><td>${r.label}</td><td>${r.blunderPct}%</td><td>${DATA.speed.controlled[i].blunderPct}%</td></tr>`).join('')}</table></div>
      <p style="margin-top:8px">Long thinks look worse only because the hard positions take longer. Compare like with like (balanced middlegames, ${DATA.speed.controlledMoves} moves) and your blunder rate is about the same at 3 seconds as at 15. So slowing down everywhere will not fix it. A safe instinct will.</p></div>` : ''}
    <div class="card" style="margin-bottom:12px"><h3>Instinct drills on this device</h3>${mem.scan.rounds || mem.speed.n ? `<div class="stats">
      <div class="stat"><b>${mem.scan.rounds}</b><span>scan positions</span></div>
      <div class="stat"><b>${mem.scan.rounds ? (mem.scan.ms / mem.scan.rounds / 1000).toFixed(1) + ' s' : '–'}</b><span>avg scan time</span></div>
      <div class="stat"><b>${mem.scan.hits + mem.scan.missed ? Math.round(100 * mem.scan.hits / (mem.scan.hits + mem.scan.missed)) + '%' : '–'}</b><span>loose pieces found</span></div>
      <div class="stat"><b>${mem.speed.n ? (mem.speed.ms / mem.speed.n / 1000).toFixed(1) + ' s' : '–'}</b><span>avg first-try solve</span></div>
      <div class="stat"><b>${mem.speed.late}</b><span>timed out</span></div></div>` : '<p class="muted">Run a safety scan or a timed puzzle session and your speed and hit rate show up here.</p>'}</div>
    <div class="card"><h3>Your drills on this device</h3>${Object.keys(th).length ? `<div class="scroll"><table><tr><th>Theme</th><th>Solved</th><th>Missed</th><th>First try</th></tr>${Object.entries(th).map(([k, v]) => `<tr><td>${esc(labels[k] || k)}</td><td>${v.ok}</td><td>${v.fail}</td><td>${v.clean}</td></tr>`).join('')}</table></div>` : '<p class="muted">Solve a few puzzles and your results show up here. They are saved in this browser only.</p>'}</div>`;
}

function afterProgress() { bindGoal(renderProgress); }
show('drill');
window.__drill = { get session() { return S; }, loose: LOOSE }; // debugging hook
