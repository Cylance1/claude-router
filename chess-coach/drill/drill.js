// Drill edition client. Expects globals: Chess, Board (concatenated by scripts/build-drill.js).
const DATA = JSON.parse(document.getElementById('data').textContent);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---- per-device progress (nice to have; the page works without it) ----
const KEY = 'chess-coach-drills-v1';
let mem = { p: {}, days: {}, themes: {} };
const load = () => { try { const j = JSON.parse(localStorage.getItem(KEY)); if (j) mem = j; } catch (e) { /* ignore */ } };
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
const P = DATA.puzzles;
const FILTERS = {
  hanging: (p) => p.theme === 'hangingPiece' || p.themes.includes('hangingPiece'),
  mine: (p) => p.mine,
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
    if (!r) s += 0.8; else if (r.r === 'fail') s += 2; else if (now - r.last < 3 * 86400e3) s -= 3; else s -= 0.5;
    return s;
  };
  return P.filter(filter).map((p) => [score(p), p]).sort((a, b) => b[0] - a[0]).slice(0, n).map((x) => x[1]);
}

// ---- tabs ----
let board = null; let S = null; let tab = 'drill';
document.querySelectorAll('nav button').forEach((b) => { b.onclick = () => show(b.dataset.tab); });
function show(t) {
  tab = t;
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  ({ drill: renderMenu, weak: renderWeak, progress: renderProgress })[t]();
}
const view = () => $('view');

// ---- menu ----
function renderMenu() {
  if (S && S.active) { renderSession(); return; }
  const w = DATA.profile.weaknesses;
  const hang = w.find((x) => x.theme === 'hangingPiece');
  const d = mem.days[today()] || { ok: 0, fail: 0 };
  const count = (f) => P.filter(f).length;
  view().innerHTML = `<div class="menu">
    <button class="hero" id="m-hanging"><b>Stop hanging pieces</b><span>${hang ? `Your biggest leak: ${plural(hang.count, 'mistake')} in ${DATA.profile.games} games.` : 'Your biggest leak.'} ${count(FILTERS.hanging)} puzzles. Find the free piece, or spot yours before it's taken.</span></button>
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
  const why = p.origin === 'my-mistake' ? `From <b>your game</b>: you played <b>${esc(p.yourMove)}</b> here. Find the move you should have played.`
    : p.yourMove ? `From <b>your game</b>: your opponent had just erred and you played <b>${esc(p.yourMove)}</b>. Was there better?` : 'Your opponent just made a mistake. Punish it.';
  $('info').innerHTML = `<div class="msg"><b>${sideName(p.side)} to move.</b> Find the best move.<div class="small muted">${why}</div>
    <div style="margin-top:6px"><span class="tag">Puzzle ${S.i + 1} of ${S.list.length}</span><span class="tag">${'★'.repeat(p.difficulty)}${'☆'.repeat(5 - p.difficulty)}</span>${p.solution.length > 1 ? `<span class="tag">${Math.ceil(p.solution.length / 2)}-move idea</span>` : ''}</div></div>`;
  if (p.setup) { await sleep(450); await board.play(p.setup.move); }
  board.locked = false; buttons();
}
function buttons() {
  if (S.cur.done) return;
  $('btns').innerHTML = '<button id="hint" class="ghost">Hint</button><button id="show" class="ghost">Show solution</button>';
  $('hint').onclick = hint; $('show').onclick = giveUp;
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
  const before = board.fen();
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
  const c = S.cur; c.done = true; board.locked = true; S.results[S.i] = true; dots();
  record(c.p, true, c.wrong === 0 && c.hints === 0);
  $('feed').innerHTML += `<div class="msg ok"><b>${c.wrong === 0 && !c.hints ? 'Solved first try.' : 'Solved.'}</b> <span class="tag">${esc(c.p.themeLabel)}</span>${reveal(c.p)}</div>`;
  $('btns').innerHTML = `<button class="primary" id="next">${S.i + 1 >= S.list.length ? 'Finish' : 'Next puzzle'}</button>`; $('next').onclick = next;
}
function giveUp() {
  const c = S.cur; c.done = true; board.locked = true; S.results[S.i] = false; dots();
  record(c.p, false, false);
  if (!S.retried.has(c.p.id) && S.list.length < 14) { S.retried.add(c.p.id); S.list.push(c.p); } // missed ones come back once, at the end
  $('feed').innerHTML = `<div class="msg no"><b>The solution:</b> ${esc(c.p.reveal.line)}<span class="tag">${esc(c.p.themeLabel)}</span>${reveal(c.p)}<div class="small muted">This one comes back at the end of the session.</div></div>`;
  $('btns').innerHTML = `<button id="watch">Watch it</button><button class="primary" id="next">${S.i + 1 >= S.list.length ? 'Finish' : 'Next puzzle'}</button>`;
  $('next').onclick = next;
  $('watch').onclick = async () => { board.load(c.p.fen); board.interactive = false; for (const san of c.p.solutionSan) { await sleep(700); await board.playSan(san); } board.interactive = true; };
  board.load(c.p.fen); board.setArrows([{ from: c.p.solution[0].slice(0, 2), to: c.p.solution[0].slice(2, 4) }]);
}
function next() { S.i++; if (S.i >= S.list.length) finish(); else load1(); }
function finish() {
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
  const g = DATA.progress; const th = mem.themes; const labels = {};
  P.forEach((p) => { labels[p.theme] = p.themeLabel; });
  const d = (a, b, lowerBetter) => { const x = +(a - b).toFixed(2); if (!x) return '–'; const good = lowerBetter ? x < 0 : x > 0; return `<span class="${good ? 'up' : 'down'}">${x > 0 ? '+' : ''}${x}</span>`; };
  const row = (name, k, lb) => `<tr><td>${name}</td><td>${g.before[k]}</td><td>${g.streak[k]}</td><td>${d(g.streak[k], g.before[k], lb)}</td></tr>`;
  const row2 = (name, k, lb) => `<tr><td>${name}</td><td>${g.older[k]}</td><td>${g.newer[k]}</td><td>${d(g.newer[k], g.older[k], lb)}</td></tr>`;
  view().innerHTML = `<h2>Progress</h2>
    <div class="card" style="margin-bottom:12px"><h3>Your recent streak vs everything before it</h3><p class="muted small">${g.streak.games} live games in the streak (plus a daily win) against ${g.before.games} before. Four games is a small sample, so treat it as encouraging, not proven.</p>
    <div class="scroll"><table><tr><th></th><th>Before</th><th>Streak</th><th>Change</th></tr>${row('Accuracy %', 'accuracy')}${row('Blunders per game', 'blunders', 1)}${row('Mistakes per game', 'mistakes', 1)}${row('Inaccuracies per game', 'inaccuracies', 1)}${row('Hung pieces per game', 'hanging', 1)}</table></div></div>
    <div class="card" style="margin-bottom:12px"><h3>First half vs second half of your reviewed games</h3><p class="muted small">${g.older.games} games each. This is the longer trend.</p>
    <div class="scroll"><table><tr><th></th><th>Older</th><th>Newer</th><th>Change</th></tr>${row2('Accuracy %', 'accuracy')}${row2('Blunders per game', 'blunders', 1)}${row2('Mistakes per game', 'mistakes', 1)}${row2('Hung pieces per game', 'hanging', 1)}</table></div></div>
    <div class="card"><h3>Your drills on this device</h3>${Object.keys(th).length ? `<div class="scroll"><table><tr><th>Theme</th><th>Solved</th><th>Missed</th><th>First try</th></tr>${Object.entries(th).map(([k, v]) => `<tr><td>${esc(labels[k] || k)}</td><td>${v.ok}</td><td>${v.fail}</td><td>${v.clean}</td></tr>`).join('')}</table></div>` : '<p class="muted">Solve a few puzzles and your results show up here. They are saved in this browser only.</p>'}</div>`;
}

show('drill');
