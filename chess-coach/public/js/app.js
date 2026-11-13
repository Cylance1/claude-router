import { Board } from '/js/board.js';

const $ = (s, el = document) => el.querySelector(s);
const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };
const PIECE_BASE = 'https://images.chesscomfiles.com/chess-themes/pieces/neo/300/'; // loaded from chess.com by your browser; nothing is copied into this project
const applyPieces = () => { window.PIECE_IMGS = (store.get('cc_pieces') || 'chesscom') === 'chesscom' ? Object.fromEntries(['w', 'b'].flatMap((c) => ['p', 'n', 'b', 'r', 'q', 'k'].map((t) => [c + t, `${PIECE_BASE}${c}${t}.png`]))) : null; };
applyPieces();
const toast = (m) => { const t = el('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500); };

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
async function runJob(jobId, onProgress) {
  for (;;) {
    const j = await api('/api/jobs/' + jobId);
    if (onProgress) onProgress(j.progress, j);
    if (j.status === 'done') return j.result;
    if (j.status === 'error') throw new Error(j.error);
    await sleep(700);
  }
}
const progressBar = (id) => `<div class="progress"><i id="${id}"></i></div>`;
const setBar = (id, p) => { const b = el(id); if (b) b.style.width = Math.round(p * 100) + '%'; };

const S = { user: store.get('cc_user') || '', profile: null, games: [], cfg: {}, analysis: null, ply: 0, tab: 'games' };
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
const THEME = () => S.cfg.themes || {};

// ---------- tabs ----------
function showTab(name) {
  S.tab = name;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  for (const t of ['games', 'review', 'train', 'lessons', 'profile']) el('tab-' + t).hidden = t !== name;
  ({ games: renderGames, review: renderReview, train: renderTrainMenu, lessons: renderLessons, profile: renderProfile })[name]();
}
el('nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

function renderWho() {
  const ps = store.get('cc_pieces') || 'chesscom';
  el('who').innerHTML = `<label class="small muted" for="pset">Pieces</label><select id="pset"><option value="chesscom"${ps === 'chesscom' ? ' selected' : ''}>chess.com</option><option value="original"${ps === 'original' ? ' selected' : ''}>original</option></select>` + (S.user ? `<span>${esc(S.profile ? S.profile.username : S.user)}</span><button class="ghost small" id="logout">Switch</button>` : '') +
    `<span class="badge ${S.cfg.ai ? 'ai' : ''}" title="${S.cfg.ai ? 'Claude writes the explanations' : 'Set ANTHROPIC_API_KEY for AI explanations and chat'}">${S.cfg.ai ? 'AI coach on' : 'Engine coach'}</span>`;
  el('pset').onchange = (e) => { store.set('cc_pieces', e.target.value); location.reload(); };
  const lo = el('logout'); if (lo) lo.onclick = () => { S.user = ''; S.profile = null; S.games = []; store.set('cc_user', ''); renderWho(); showTab('games'); };
}

// ---------- GAMES ----------
async function connect(user) {
  const box = el('tab-games');
  box.innerHTML = `<div class="hero card"><span class="spin"></span> Connecting to chess.com…</div>`;
  try {
    const r = await api('/api/connect?user=' + encodeURIComponent(user));
    S.profile = r.profile; S.games = r.games; S.user = r.profile.username; store.set('cc_user', S.user);
  } catch (e) { S.user = ''; renderGames(e.message); return; }
  renderWho(); renderGames();
}

function renderGames(error) {
  const box = el('tab-games');
  if (!S.user || !S.profile) {
    box.innerHTML = `<div class="hero card"><h1>Your personal chess coach</h1>
      <p class="muted">Connect your chess.com username. I'll review every move of your games, explain what went wrong and why, show the better line — then build puzzles around the exact ideas you keep missing.</p>
      <form id="cform"><input id="cuser" placeholder="chess.com username" autocomplete="off" value="${esc(S.user)}" autofocus><button class="primary">Connect</button></form>
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      <p class="small muted">Only your public username is used (chess.com's public API). No password needed.</p></div>`;
    el('cform').onsubmit = (e) => { e.preventDefault(); const u = el('cuser').value.trim(); if (u) connect(u); };
    return;
  }
  const p = S.profile;
  const rt = Object.entries(p.ratings || {}).map(([k, v]) => `<span class="tag">${k} ${v}</span>`).join('');
  box.innerHTML = `<div class="profile card">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : '<div class="logo">♟</div>'}
      <div style="flex:1"><h2 style="margin:0">${esc(p.username)}</h2><div>${rt}</div></div>
      <div><button class="primary" id="batch">Review my last 10 games</button></div></div>
    ${goalHtml(p)}
    <div id="batchstat"></div>
    <h3>Recent games</h3><div class="games" id="glist"></div>`;
  el('batch').onclick = batchReview;
  bindGoal();
  el('glist').innerHTML = S.games.length ? S.games.map((g, i) => gameRow(g, i)).join('') : '<p class="muted">No recent standard chess games found.</p>';
  el('glist').onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) openGame(S.games[+b.dataset.i]); };
}
function goalHtml(p) {
  const mode = store.get('cc_goal_mode') || 'rapid'; const target = +store.get('cc_goal') || 2000;
  const cur = (p.ratings || {})[mode] || 0; const pct = Math.max(1.5, Math.min(100, cur / target * 100));
  const next = [500, 800, 1000, 1200, 1500, 1800, 2000, 2200, 2500].find((m) => m > cur && m <= Math.max(target, cur + 1)) || target;
  return `<div class="card" style="margin-bottom:1rem"><div class="row" style="justify-content:space-between"><b>Road to <span id="gt">${target}</span></b>
    <span class="row"><select id="gmode"><option value="rapid"${mode === 'rapid' ? ' selected' : ''}>rapid</option><option value="blitz"${mode === 'blitz' ? ' selected' : ''}>blitz</option></select>
    <input id="gin" type="number" min="200" max="3500" value="${target}" style="width:90px" aria-label="Goal rating"></span></div>
    <div class="progress" style="height:14px;margin:.6rem 0" role="progressbar" aria-valuenow="${cur}" aria-valuemax="${target}"><i style="width:${pct}%"></i></div>
    <div class="row small"><span><b>${cur}</b> now</span><span class="muted">${Math.max(0, target - cur).toLocaleString()} to go</span><span class="muted">next stop ${next} (${Math.max(0, next - cur)} away)</span></div></div>`;
}
function bindGoal() {
  const m = el('gmode'); const g = el('gin'); if (!m || !g) return;
  m.onchange = () => { store.set('cc_goal_mode', m.value); renderGames(); };
  g.onchange = () => { const v = Math.round(+g.value); if (v >= 200 && v <= 3500) { store.set('cc_goal', String(v)); renderGames(); } };
}
function gameRow(g, i) {
  const date = new Date(g.endTime * 1000).toLocaleDateString();
  const sm = g.summary ? `<span class="tag">${g.summary.accuracy}% accuracy</span><span class="tag">${g.summary.blunders}?? ${g.summary.mistakes}? ${g.summary.inaccuracies}?!</span>` : '';
  return `<div class="card game"><div class="res ${g.result}">${g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D'}</div>
    <div><b>vs ${esc(g.opponent.username)}</b> <span class="muted">(${g.opponent.rating})</span> · as ${g.myColor === 'w' ? 'White' : 'Black'}<br>
    <span class="small muted">${esc(g.timeClass)} · ${esc(g.opening || 'Unknown opening')} · ${date}</span> ${sm}</div>
    <div class="small muted">${esc(g.how)}</div><button data-i="${i}" class="${g.analyzed ? '' : 'primary'}">${g.analyzed ? 'Open review' : 'Review'}</button></div>`;
}
async function batchReview() {
  const st = el('batchstat'); el('batch').disabled = true;
  st.innerHTML = `<div class="card"><b>Reviewing your last 10 games…</b> <span class="muted small">(about 10–20 s per game)</span>${progressBar('bp')}</div>`;
  try {
    const { jobId } = await api('/api/review-batch', { user: S.user, count: 10 });
    await runJob(jobId, (p) => setBar('bp', p));
    await connect(S.user);
    toast('Games reviewed — see "My weaknesses".');
    showTab('profile');
  } catch (e) { st.innerHTML = `<p class="err">${esc(e.message)}</p>`; el('batch').disabled = false; }
}
async function openGame(g) {
  showTab('review');
  const box = el('tab-review');
  box.innerHTML = `<div class="card"><b>Analysing ${g.analyzed ? '' : 'game with Stockfish… '}</b>${progressBar('ap')}<p class="muted small">Checking every position, then finding the better line and the idea behind each mistake.</p></div>`;
  try {
    const r = await api('/api/analyze', { user: S.user, gameId: g.id });
    if (r.done) S.analysis = r.analysis; else {
      await runJob(r.jobId, (p) => setBar('ap', p));
      S.analysis = await api(`/api/analysis?user=${encodeURIComponent(S.user)}&gameId=${encodeURIComponent(g.id)}`);
      g.analyzed = true; g.summary = S.analysis.summary;
    }
  } catch (e) { box.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
  const firstBad = S.analysis.moves.find((m) => m.mine && ['blunder', 'mistake'].includes(m.cls));
  S.ply = firstBad ? firstBad.ply : 0;
  renderReview();
}

// ---------- REVIEW ----------
let rboard = null; let rmode = 'view';
const MISTAKE = ['inaccuracy', 'mistake', 'blunder'];
const CLS = { best: 'Best', excellent: 'Excellent', good: 'Good', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder' };
function renderReview() {
  const box = el('tab-review');
  const a = S.analysis;
  if (!a) { box.innerHTML = `<div class="card"><h2>Game review</h2><p class="muted">Pick a game from the Games tab to get a move-by-move review.</p><button class="primary" id="pickgame">Choose a game</button></div>`; el('pickgame').onclick = () => showTab('games'); return; }
  const g = a.game; const sm = a.summary;
  box.innerHTML = `<div class="layout"><div>
      <div class="boardwrap"><div class="evalbar" id="ebar"><i id="efill"></i></div><div id="rb" style="flex:1"></div></div>
      <div class="boardtools"><button id="b-first">⏮</button><button id="b-prev">◀</button><button id="b-next">▶</button><button id="b-last">⏭</button>
        <button id="b-flip">Flip</button><button id="b-prevbad">← Prev mistake</button><button id="b-nextbad">Next mistake →</button></div>
      <svg class="graph" id="graph" viewBox="0 0 400 70" preserveAspectRatio="none"></svg>
    </div><div>
      <div class="row"><h2 style="margin:0">${esc(g.white.username)} vs ${esc(g.black.username)}</h2><a class="small" href="${esc(g.url)}" target="_blank" rel="noopener">chess.com ↗</a></div>
      <div class="summary"><div class="stat"><b>${sm.accuracy}%</b><span>accuracy</span></div><div class="stat"><b style="color:var(--blun)">${sm.blunders}</b><span>blunders</span></div><div class="stat"><b style="color:var(--mist)">${sm.mistakes}</b><span>mistakes</span></div><div class="stat"><b style="color:var(--warn)">${sm.inaccuracies}</b><span>inaccuracies</span></div></div>
      <div class="moves" id="mlist"></div>
      <div class="card coachbox" id="coach"></div>
    </div></div>`;
  rboard = new Board(el('rb'), { interactive: false, onMove: onRetryMove });
  rboard.flip(a.myColor);
  const rows = [];
  a.moves.forEach((m, i) => {
    if (i % 2 === 0) rows.push(`<div class="n">${m.moveNumber}.</div>`);
    rows.push(`<button data-ply="${m.ply}" title="${CLS[m.cls]}"><span class="dot ${m.cls}"></span>${esc(m.san)}</button>`);
  });
  el('mlist').innerHTML = rows.join('');
  el('mlist').onclick = (e) => { const b = e.target.closest('button'); if (b) showPly(+b.dataset.ply); };
  const N = a.moves.length;
  el('b-first').onclick = () => showPly(0); el('b-prev').onclick = () => showPly(Math.max(0, S.ply - 1));
  el('b-next').onclick = () => showPly(Math.min(N, S.ply + 1)); el('b-last').onclick = () => showPly(N);
  el('b-flip').onclick = () => rboard.flip();
  const bad = () => a.moves.filter((m) => m.mine && MISTAKE.includes(m.cls)).map((m) => m.ply);
  el('b-nextbad').onclick = () => { const n = bad().find((p) => p > S.ply); if (n) showPly(n); else toast('No more mistakes — nice!'); };
  el('b-prevbad').onclick = () => { const n = [...bad()].reverse().find((p) => p < S.ply); if (n) showPly(n); };
  drawGraph();
  showPly(S.ply);
}
function drawGraph() {
  const a = S.analysis; const n = a.evalCurve.length;
  const x = (i) => (i / Math.max(1, n - 1)) * 400; const y = (cp) => 70 - (winPct(cp) / 100) * 70;
  const pts = a.evalCurve.map((c, i) => `${x(i).toFixed(1)},${y(c).toFixed(1)}`);
  const dots = a.moves.filter((m) => m.mine && MISTAKE.includes(m.cls)).map((m) => `<circle cx="${x(m.ply)}" cy="${y(a.evalCurve[m.ply])}" r="3.5" fill="var(${m.cls === 'blunder' ? '--blun' : m.cls === 'mistake' ? '--mist' : '--warn'})"/>`).join('');
  el('graph').innerHTML = `<rect width="400" height="70" fill="none"/><line x1="0" y1="35" x2="400" y2="35" stroke="var(--line)"/><polyline points="0,70 ${pts.join(' ')} 400,70" fill="rgba(150,150,150,.25)" stroke="var(--ink)" stroke-width="1" vector-effect="non-scaling-stroke"/>${dots}<line id="gcur" x1="0" x2="0" y1="0" y2="70" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  el('graph').onclick = (e) => { const r = el('graph').getBoundingClientRect(); showPly(Math.round(((e.clientX - r.left) / r.width) * (n - 1))); };
}
function setEval(cp) {
  const w = winPct(cp); const f = el('efill'); f.style.height = w + '%';
  const flipped = rboard && rboard.orientation === 'b';
  f.style.top = flipped ? '0' : 'auto'; f.style.bottom = flipped ? 'auto' : '0'; // White's share sits next to White's side
  const lab = Math.abs(cp) >= 9000 ? 'M' : (cp / 100).toFixed(1);
  el('ebar').title = `Eval ${cp > 0 ? '+' : ''}${lab} (White's view)`;
}
function showPly(k) {
  const a = S.analysis; if (!a) return;
  rmode = 'view'; rboard.interactive = false;
  S.ply = k;
  document.querySelectorAll('#mlist button').forEach((b) => b.classList.toggle('on', +b.dataset.ply === k));
  const cur = $('#mlist button.on'); if (cur) { const ml = el('mlist'); ml.scrollTop = cur.offsetTop - ml.clientHeight / 2; } // scroll the list only, never the page
  const n = a.evalCurve.length; const gc = el('gcur'); if (gc) { gc.setAttribute('x1', (k / Math.max(1, n - 1)) * 400); gc.setAttribute('x2', (k / Math.max(1, n - 1)) * 400); }
  const coach = el('coach');
  if (k === 0) { rboard.load(a.startFen); setEval(a.evalCurve[0]); coach.innerHTML = `<h3>Game start</h3><p class="muted">Use ▶, click a move, or jump to <b>Next mistake</b>. Red dots on the graph are your mistakes.</p>`; return; }
  const m = a.moves[k - 1];
  const isMistake = m.mine && MISTAKE.includes(m.cls);
  if (isMistake) {
    rboard.load(m.fenBefore); setEval(m.evalBefore);
    const prev = a.moves[k - 2]; if (prev) rboard.lastMove = { from: prev.uci.slice(0, 2), to: prev.uci.slice(2, 4) };
    rboard.render();
    rboard.setArrows([{ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), cls: 'bad' }, { from: m.bestUci.slice(0, 2), to: m.bestUci.slice(2, 4) }]);
    coachMistake(m);
  } else {
    rboard.load(m.fenAfter); rboard.lastMove = { from: m.uci.slice(0, 2), to: m.uci.slice(2, 4) }; rboard.render(); setEval(m.evalAfter);
    const who = m.mine ? 'Your move' : "Opponent's move";
    const bestNote = m.cls === 'best' ? 'the engine\'s top choice' : m.cls === 'excellent' || m.cls === 'good' ? 'a solid move' : 'a mistake by your opponent';
    const oppErr = !m.mine && MISTAKE.includes(m.cls);
    coach.innerHTML = `<div class="row"><span class="cls ${m.cls}">${CLS[m.cls]}</span><b>${m.moveNumber}${m.color === 'w' ? '.' : '...'} ${esc(m.san)}</b></div>
      <p class="muted">${who}: ${bestNote}${m.cls !== 'best' && m.bestSan ? ` (engine's first choice: ${esc(m.bestSan)})` : ''}.</p>
      ${oppErr ? `<p>Your opponent slipped here — did you take advantage? <button id="seeopp">Show what they missed</button></p>` : ''}`;
    const so = el('seeopp'); if (so) so.onclick = () => { rboard.load(m.fenBefore); rboard.setArrows([{ from: m.bestUci.slice(0, 2), to: m.bestUci.slice(2, 4) }]); };
  }
}
async function coachMistake(m) {
  const coach = el('coach');
  const head = `<div class="row"><span class="cls ${m.cls}">${CLS[m.cls]}</span><b>${m.moveNumber}${m.color === 'w' ? '.' : '...'} ${esc(m.san)}</b>
    <span class="muted small">−${Math.round(m.winLoss)}% winning chances</span>${m.lesson ? `<span class="tag">${esc(m.lesson.label)}</span>` : ''}</div>`;
  coach.innerHTML = head + `<p class="muted"><span class="spin"></span> The coach is looking at this position…</p>`;
  const tools = `<div class="boardtools"><button id="t-better" class="primary">▶ Play the better line</button><button id="t-mine">▶ What happens after ${esc(m.san)}</button><button id="t-try">Try it yourself</button><button id="t-reset">Reset</button></div><div id="tryfb"></div>`;
  let ex;
  try { ex = await api('/api/explain', { user: S.user, gameId: S.analysis.gameId, ply: m.ply }); } catch (e) { ex = null; }
  if (S.ply !== m.ply) return;
  let body;
  if (!ex) body = '<p class="err">Could not load the explanation.</p>';
  else if (ex.text) body = md(ex.text);
  else {
    const s = ex.sections;
    body = `<div class="sec"><div class="h">What happened</div>${md(s.happened)}</div><div class="sec"><div class="h">Why it's a problem</div>${md(s.why)}</div>
      <div class="sec better"><div class="h">The better move</div>${md(s.better)}</div><div class="sec remember"><div class="h">Remember</div>${md(s.takeaway)}</div>`;
  }
  const slip = ex && ex.slip ? `<div class="pmsg"><b>Possible slip?</b> <b>${esc(ex.slip.san)}</b> (${ex.slip.kind === 'destination' ? 'the same piece, one square over' : 'the piece next to it'}) would have been ${esc(ex.slip.cls)}. If you meant ${esc(m.san)}, it was a chess error; if not, it was a mis-click, and that is a different thing to fix.</div>` : '';
  const chat = S.cfg.ai ? `<div class="chat"><input id="q" placeholder="Ask the coach about this position…"><button id="ask">Ask</button></div><div id="ans"></div>` : '';
  coach.innerHTML = head + (ex && ex.note ? `<p class="small muted">${esc(ex.note)}</p>` : '') + body + slip + tools + chat;
  el('t-better').onclick = () => playLine(m.fenBefore, m.bestLine, 'good');
  el('t-mine').onclick = () => playLine(m.fenBefore, [m.san, ...(m.refutationLine || [])], 'bad');
  el('t-try').onclick = () => startRetry(m);
  el('t-reset').onclick = () => showPly(m.ply);
  if (S.cfg.ai) el('ask').onclick = async () => {
    const q = el('q').value.trim(); if (!q) return;
    el('ans').innerHTML = '<div class="answer"><span class="spin"></span></div>';
    try { const r = await api('/api/ask', { fen: rboard.fen(), question: q, context: `The student (rating ${S.analysis.game.me.rating}) played ${m.san}; the engine prefers ${m.bestSan}.` }); el('ans').innerHTML = `<div class="answer">${esc(r.answer)}</div>`; } catch (e) { el('ans').innerHTML = `<div class="answer err">${esc(e.message)}</div>`; }
  };
}
let playToken = 0;
async function playLine(fen, sans, kind) {
  const my = ++playToken;
  rboard.load(fen); rboard.interactive = false;
  for (const san of sans) {
    await sleep(650); if (my !== playToken) return;
    if (!(await rboard.playSan(san))) break;
  }
  const last = rboard.lastMove; if (last && kind) rboard.setMarks({ [last.to]: kind === 'good' ? 'good' : 'bad' });
}
function startRetry(m) {
  playToken++; rmode = 'retry';
  rboard.load(m.fenBefore); rboard.interactive = true; rboard.locked = false;
  el('tryfb').innerHTML = `<div class="pmsg">Your turn: find a better move than <b>${esc(m.san)}</b> for ${m.color === 'w' ? 'White' : 'Black'}. <button id="hintbtn" class="ghost">Hint</button></div>`;
  el('hintbtn').onclick = () => { rboard.setMarks({ [m.bestUci.slice(0, 2)]: 'hl' }); };
  rboard._retry = m;
}
async function onRetryMove(uci) {
  if (rmode !== 'retry') return;
  const m = rboard._retry; const fb = el('tryfb');
  rboard.locked = true;
  const before = rboard.fen();
  await rboard.play(uci);
  fb.innerHTML = '<div class="pmsg"><span class="spin"></span> Checking with the engine…</div>';
  let r;
  try { r = await api('/api/judge', { fen: before, best: m.bestUci, bestSan: m.bestSan, move: uci }); } catch (e) { fb.innerHTML = `<div class="pmsg no">${esc(e.message)}</div>`; rboard.load(before); rboard.locked = false; return; }
  if (r.correct) {
    fb.innerHTML = `<div class="pmsg ok"><b>${esc(r.san)}</b> — ${r.alternative ? esc(r.message) : 'that is the engine\'s choice! Well done.'}</div>`;
    return;
  }
  fb.innerHTML = `<div class="pmsg no">${md(r.why)}${r.refutation && r.refutation.length ? `<p class="small">Likely continuation: ${esc(r.refutation.join(' '))}</p>` : ''}${r.nearly ? '<p class="small">It\'s not terrible — but there is something stronger.</p>' : ''}<button id="again" class="primary">Try again</button></div>`;
  rboard.setMarks({ [uci.slice(2, 4)]: 'bad' });
  el('again').onclick = () => { rboard.load(before); rboard.interactive = true; rboard.locked = false; fb.innerHTML = '<div class="pmsg">Try another move.</div>'; };
}

// ---------- TRAIN ----------
let tb = null; let T = null;
async function renderTrainMenu() {
  const box = el('tab-train');
  if (T && T.active) { renderPuzzleUI(); return; }
  const stats = (await api('/api/config')).library; S.cfg.library = stats;
  let prof = null; if (S.user) prof = await api('/api/profile?user=' + encodeURIComponent(S.user)).catch(() => null);
  const weak = prof && prof.weaknesses.slice(0, 3);
  const themes = Object.entries(THEME()).filter(([t]) => (stats.byTheme[t] || 0) > 0);
  box.innerHTML = `<h2>Train</h2>
    <div class="modes">
      <button class="card mode" id="m-weak"><b>🎯 Train my weaknesses</b><span class="muted small">${weak && weak.length ? 'Focus: ' + weak.map((w) => esc(w.label)).join(', ') : 'Review a few games first so I know what to target. (Mixed puzzles until then.)'}</span></button>
      <button class="card mode" id="m-mine"><b>♟ My own mistakes</b><span class="muted small">Positions from <i>your</i> games where a better move existed. ${prof && prof.games ? '' : 'Review games to unlock.'}</span></button>
      <button class="card mode" id="m-mix"><b>🔀 Mixed set</b><span class="muted small">${stats.total} puzzles from real games, easiest first.</span></button>
    </div>
    <div class="card" style="margin-top:1rem"><h3>Pick a theme</h3><div class="row"><select id="theme">${themes.map(([t, l]) => `<option value="${t}">${esc(l)} (${stats.byTheme[t]})</option>`).join('')}</select>
      <button id="m-theme" class="primary">Start</button><button id="m-gen">Find more like this</button></div><div id="genstat"></div>
      <p class="small muted">“Find more” searches recent games of players around your level and mines new verified puzzles for that theme (takes about a minute).</p></div>`;
  const go = (qs, label) => startSession(qs, label);
  el('m-weak').onclick = () => go(weak && weak.length ? `mode=weakness` : '', 'Weakness training');
  el('m-mine').onclick = () => go('mode=mine', 'My own mistakes');
  el('m-mix').onclick = () => go('maxDifficulty=3', 'Mixed set');
  el('m-theme').onclick = () => go('theme=' + el('theme').value, THEME()[el('theme').value]);
  el('m-gen').onclick = async () => {
    const th = el('theme').value; const gs = el('genstat'); el('m-gen').disabled = true;
    gs.innerHTML = `<p>Mining new ${esc(THEME()[th])} puzzles…</p>${progressBar('gp')}`;
    try { const { jobId } = await api('/api/puzzles/generate', { user: S.user || 'guest', themes: [th], perTheme: (stats.byTheme[th] || 0) + 6 }); const r = await runJob(jobId, (p, j) => { setBar('gp', p); }); toast(`Added ${r.added} new puzzles.`); renderTrainMenu(); }
    catch (e) { gs.innerHTML = `<p class="err">${esc(e.message)}</p>`; el('m-gen').disabled = false; }
  };
}
async function startSession(qs, label) {
  const box = el('tab-train');
  box.innerHTML = '<div class="card"><span class="spin"></span> Choosing puzzles for you…</div>';
  const r = await api(`/api/puzzles?count=10&user=${encodeURIComponent(S.user || 'guest')}&${qs}`);
  if (!r.puzzles.length) { box.innerHTML = `<div class="card"><h3>No puzzles yet for that</h3><p class="muted">${qs.includes('mine') ? 'Review some of your games first — your own mistakes become puzzles automatically.' : 'Try “Find more like this”.'}</p><button id="tback">Back</button></div>`; el('tback').onclick = renderTrainMenu; T = null; return; }
  T = { active: true, label, list: r.puzzles, i: 0, results: [], focus: r.themes };
  renderPuzzleUI();
  loadPuzzle();
}
function renderPuzzleUI() {
  const box = el('tab-train');
  box.innerHTML = `<div class="layout"><div><div class="boardwrap"><div id="pb" style="flex:1"></div></div>
      <div class="boardtools"><button id="p-flip">Flip</button></div></div>
    <div><div class="row"><h2 style="margin:0">${esc(T.label)}</h2><button class="ghost small" id="p-quit">End session</button></div>
      <div class="dots" id="pdots"></div><div id="pinfo"></div><div id="pfeed"></div><div class="boardtools" id="pbtns"></div></div></div>`;
  tb = new Board(el('pb'), { onMove: onPuzzleMove });
  el('p-flip').onclick = () => tb.flip();
  el('p-quit').onclick = () => finishSession();
  drawDots();
}
function drawDots() { el('pdots').innerHTML = T.list.map((p, i) => `<i class="${T.results[i] === undefined ? '' : T.results[i] ? 'ok' : 'no'} ${i === T.i ? 'cur' : ''}"></i>`).join(''); }
const sideName = (s) => (s === 'w' ? 'White' : 'Black');
async function loadPuzzle() {
  const p = T.list[T.i]; if (!p) return finishSession();
  T.cur = { p, step: 0, attempts: 0, hints: 0, done: false, hintLevel: 0 };
  drawDots();
  tb.flip(p.side); tb.locked = true; tb.interactive = true;
  tb.load(p.setup ? p.setup.fen : p.fen);
  el('pfeed').innerHTML = ''; el('pbtns').innerHTML = '';
  const orig = p.origin === 'my-mistake' ? `From <b>your game</b>: you played <b>${esc(p.yourMove)}</b> here. Find the move you should have played.` : p.yourMove ? `From <b>your game</b>: your opponent had just erred — you played <b>${esc(p.yourMove)}</b>. Was there better?` : 'Your opponent just made a mistake. Punish it.';
  el('pinfo').innerHTML = `<div class="pmsg"><b>${sideName(p.side)} to move</b> — find the best move.<br><span class="small muted">${orig}</span><div style="margin-top:.4rem"><span class="tag">Puzzle ${T.i + 1}/${T.list.length}</span><span class="tag">${'★'.repeat(p.difficulty)}${'☆'.repeat(5 - p.difficulty)}</span>${p.plies > 1 ? `<span class="tag">${Math.ceil(p.plies / 2)}-move idea</span>` : ''}</div></div>`;
  if (p.setup) { await sleep(500); await tb.play(p.setup.move); }
  tb.locked = false;
  setButtons();
}
function setButtons() {
  const c = T.cur; const b = el('pbtns');
  if (c.done) return;
  b.innerHTML = `<button id="p-hint" class="ghost">💡 Hint</button><button id="p-show" class="ghost">Show solution</button>`;
  el('p-hint').onclick = doHint; el('p-show').onclick = () => giveUp();
}
async function doHint() {
  const c = T.cur; const level = Math.min(2, c.hintLevel); c.hintLevel++; c.hints++;
  const h = await api('/api/puzzle/hint', { puzzleId: c.p.id, level });
  if (typeof h === 'string' || h.text === undefined) { el('pfeed').innerHTML = `<div class="pmsg">💡 ${esc(h.text || h)}</div>`; return; }
  const mark = {}; if (h.from) mark[h.from] = 'hl';
  tb.setMarks(mark);
  if (h.to) tb.setArrows([{ from: h.from, to: h.to }]);
  el('pfeed').innerHTML = `<div class="pmsg">💡 ${esc(h.text)}</div>`;
}
async function onPuzzleMove(uci) {
  const c = T.cur; if (c.done) return;
  const fenBefore = tb.fen();
  tb.locked = true; tb.setMarks({}); tb.setArrows([]);
  await tb.play(uci);
  let r;
  try { r = await api('/api/puzzle/check', { puzzleId: c.p.id, step: c.step, move: uci }); } catch (e) { toast(e.message); tb.load(fenBefore); tb.locked = false; return; }
  if (r.illegal) { tb.load(fenBefore); tb.locked = false; return; }
  if (r.correct) {
    if (r.alternative) { el('pfeed').innerHTML = `<div class="pmsg ok">✅ ${esc(r.message)}</div>`; return solved(); }
    el('pfeed').innerHTML = `<div class="pmsg ok">✅ <b>${esc(r.san)}</b> — correct!</div>`;
    if (r.done) return solved();
    await sleep(450); await tb.playSan(r.replySan); c.step = r.nextStep; tb.locked = false;
    el('pfeed').innerHTML += `<div class="pmsg">Your opponent replied <b>${esc(r.replySan)}</b>. Keep going — what's next?</div>`;
    return;
  }
  c.attempts++;
  const last = uci.slice(2, 4); tb.setMarks({ [last]: 'bad' });
  el('pfeed').innerHTML = `<div class="pmsg no"><b>✗ Not quite.</b> ${md(r.why)}${r.refutation && r.refutation.length ? `<p class="small">e.g. ${esc(r.refutation.join(' '))}</p>` : ''}
    ${c.attempts >= 2 && c.hintLevel === 0 ? '<p class="small">Stuck? Try the 💡 hint.</p>' : ''}${r.nearly ? '<p class="small">That\'s a decent move, but there\'s something stronger.</p>' : ''}</div>`;
  await sleep(1100);
  tb.load(fenBefore); tb.lastMove = null; tb.render(); tb.locked = false;
}
async function solved() {
  const c = T.cur; c.done = true; tb.locked = true;
  T.results[T.i] = true; drawDots();
  await api('/api/puzzle/result', { user: S.user || 'guest', puzzleId: c.p.id, solved: true, attempts: c.attempts + 1, hintsUsed: c.hints }).catch(() => {});
  const rv = await api('/api/puzzle/reveal', { puzzleId: c.p.id });
  const clean = c.attempts === 0 && c.hints === 0;
  el('pfeed').innerHTML += `<div class="pmsg ok"><b>${clean ? 'Solved first try! 🎉' : 'Solved.'}</b> <span class="tag">${esc(c.p.themeLabel)}</span><p>${esc(rv.idea)}</p><p class="small">Line: ${esc(rv.line)}</p><p class="small"><b>Remember:</b> ${esc(rv.takeaway)}</p></div>`;
  el('pbtns').innerHTML = `<button class="primary" id="p-next">${T.i + 1 >= T.list.length ? 'Finish' : 'Next puzzle →'}</button>`;
  el('p-next').onclick = next;
}
async function giveUp() {
  const c = T.cur; c.done = true; tb.locked = true;
  T.results[T.i] = false; drawDots();
  await api('/api/puzzle/result', { user: S.user || 'guest', puzzleId: c.p.id, solved: false, attempts: c.attempts, hintsUsed: c.hints }).catch(() => {});
  const rv = await api('/api/puzzle/reveal', { puzzleId: c.p.id });
  el('pfeed').innerHTML = `<div class="pmsg no"><b>The solution:</b> ${esc(rv.line)}<p>${esc(rv.idea)}</p><p class="small"><b>Remember:</b> ${esc(rv.takeaway)}</p><span class="tag">${esc(c.p.themeLabel)}</span> <span class="small muted">I'll bring this one back later.</span></div>`;
  el('pbtns').innerHTML = `<button id="p-replay">▶ Watch it</button><button class="primary" id="p-next">${T.i + 1 >= T.list.length ? 'Finish' : 'Next puzzle →'}</button>`;
  el('p-next').onclick = next;
  el('p-replay').onclick = async () => {
    tb.load(c.p.fen); tb.interactive = false;
    for (const san of rv.solutionSan) { await sleep(700); await tb.playSan(san); }
    tb.interactive = true;
  };
  tb.load(c.p.fen); tb.setArrows([{ from: rv.solution[0].slice(0, 2), to: rv.solution[0].slice(2, 4) }]);
}
function next() { T.i++; if (T.i >= T.list.length) finishSession(); else loadPuzzle(); }
function finishSession() {
  const box = el('tab-train');
  const done = T.results.filter((r) => r !== undefined);
  const ok = done.filter(Boolean).length;
  const byTheme = {};
  T.list.forEach((p, i) => { if (T.results[i] === undefined) return; const t = byTheme[p.theme] || (byTheme[p.theme] = { label: p.themeLabel, ok: 0, n: 0 }); t.n++; if (T.results[i]) t.ok++; });
  const missed = Object.entries(byTheme).filter(([, t]) => t.ok < t.n).map(([k]) => k);
  box.innerHTML = `<div class="card"><h2>Session complete</h2><div class="summary"><div class="stat"><b>${ok}/${done.length}</b><span>solved</span></div></div>
    ${Object.values(byTheme).map((t) => `<p><b>${esc(t.label)}</b>: ${t.ok}/${t.n}</p>`).join('')}
    <div class="row"><button class="primary" id="again">New session</button>${missed.length ? `<button id="drill">Drill ${esc(THEME()[missed[0]])}</button><button id="learn">Read the lesson</button>` : ''}</div></div>`;
  T = null;
  el('again').onclick = renderTrainMenu;
  if (missed.length) { el('drill').onclick = () => startSession('theme=' + missed[0], THEME()[missed[0]]); el('learn').onclick = () => { showTab('lessons'); openLesson(missed[0]); }; }
}

// ---------- LESSONS ----------
async function renderLessons() {
  const box = el('tab-lessons');
  const list = await api('/api/lessons');
  box.innerHTML = `<h2>Lessons</h2><p class="muted">Short, practical lessons on the ideas that decide club games. Each has real examples from played games.</p>
    <div class="grid2">${list.map((l) => `<button class="card lesson" data-t="${l.theme}"><h3>${esc(l.title)}</h3><span class="muted small">${esc(l.summary.slice(0, 120))}…</span><br><span class="tag">${l.puzzles} ${l.puzzles === 1 ? 'puzzle' : 'puzzles'}</span></button>`).join('')}</div>`;
  box.onclick = (e) => { const b = e.target.closest('button[data-t]'); if (b) openLesson(b.dataset.t); };
}
async function openLesson(theme) {
  const box = el('tab-lessons');
  const l = await api('/api/lessons/' + theme);
  box.innerHTML = `<button class="ghost" id="lback">← All lessons</button><h2>${esc(l.title)}</h2><p>${esc(l.summary)}</p>
    <div class="card"><h3>How to spot it</h3><ul class="spot">${l.spot.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><p><b>Habit:</b> ${esc(l.habit)}</p><p><b>Takeaway:</b> ${esc(l.takeaway)}</p></div>
    <div class="row" style="margin:1rem 0"><button class="primary" id="lpractice">Practice ${esc(l.title)} puzzles</button></div>
    <h3>Examples from real games</h3><div class="grid2" id="ex"></div>`;
  el('lback').onclick = renderLessons;
  el('lpractice').onclick = () => { showTab('train'); startSession('theme=' + theme, l.title); };
  const ex = el('ex');
  if (!l.examples.length) ex.innerHTML = '<p class="muted">No examples yet — use “Find more like this” in Train.</p>';
  l.examples.forEach((p, i) => {
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<div id="eb${i}"></div><p class="small"><b>${sideName(p.side)} to move.</b> ${esc(p.idea)}</p><div class="boardtools"><button data-a="prev">◀</button><button data-a="next" class="primary">Next move ▶</button><button data-a="reset">Reset</button></div><p class="small muted" id="el${i}">Solution: ${esc(p.line)}</p>`;
    ex.appendChild(card);
    const b = new Board(card.querySelector('#eb' + i), { interactive: false });
    b.flip(p.side); b.load(p.setup ? p.setup.fen : p.fen);
    let idx = -1;
    const setup = async () => { if (p.setup) { await b.play(p.setup.move); } };
    setup();
    card.onclick = async (e) => {
      const a = e.target.closest('button')?.dataset.a; if (!a) return;
      if (a === 'reset') { idx = -1; b.load(p.setup ? p.setup.fen : p.fen); await setup(); return; }
      if (a === 'next' && idx < p.solutionSan.length - 1) { idx++; await b.playSan(p.solutionSan[idx]); }
      if (a === 'prev' && idx >= 0) { idx--; b.load(p.fen); for (let j = 0; j <= idx; j++) await b.playSan(p.solutionSan[j], { animate: false }); }
    };
  });
}

// ---------- PROFILE ----------
async function renderProfile() {
  const box = el('tab-profile');
  if (!S.user) { box.innerHTML = '<div class="card"><p>Connect your chess.com account first.</p></div>'; return; }
  box.innerHTML = '<div class="card"><span class="spin"></span> Loading…</div>';
  const p = await api('/api/profile?user=' + encodeURIComponent(S.user));
  if (!p.games) { box.innerHTML = `<div class="card"><h2>My weaknesses</h2><p class="muted">I haven't reviewed any of your games yet. Review a few and I'll show you the patterns that keep costing you points.</p><button class="primary" id="go">Review my last 10 games</button></div>`; el('go').onclick = () => { showTab('games'); setTimeout(() => el('batch') && el('batch').click(), 300); }; return; }
  const max = Math.max(1, ...p.weaknesses.map((w) => w.score));
  const th = p.progress.themes || {};
  box.innerHTML = `<h2>My weaknesses</h2>
    <div class="summary"><div class="stat"><b>${p.games}</b><span>games reviewed</span></div><div class="stat"><b>${p.avgAccuracy}%</b><span>avg accuracy</span></div>
    <div class="stat"><b style="color:var(--blun)">${p.perGame.blunders}</b><span>blunders / game</span></div><div class="stat"><b style="color:var(--mist)">${p.perGame.mistakes}</b><span>mistakes / game</span></div>
    <div class="stat"><b>${p.results.win}-${p.results.loss}-${p.results.draw}</b><span>W-L-D</span></div></div>
    <div class="card" style="margin-bottom:1rem"><h3>Where you lose the most (avg % winning chances lost per move)</h3>
      ${['opening', 'middlegame', 'endgame'].map((k) => `<div class="row"><span style="width:6.5rem">${k}</span><div class="bar" style="flex:1"><i style="width:${Math.min(100, (p.phases[k] || 0) * 4)}%"></i></div><b>${p.phases[k] ?? '–'}</b></div>`).join('')}</div>
    <h3>Recurring patterns in your mistakes</h3>
    ${p.weaknesses.length ? p.weaknesses.map((w) => `<div class="card weak"><div class="row"><b style="font-size:1.05rem">${esc(w.label)}</b><span class="tag">${w.count} ${w.count === 1 ? 'time' : 'times'}</span>${w.blunders ? `<span class="tag">${w.blunders} ${w.blunders === 1 ? 'blunder' : 'blunders'}</span>` : ''}
      <span style="flex:1"></span><button data-train="${w.theme}" class="primary">Train this</button><button data-learn="${w.theme}">Lesson</button></div>
      <div class="bar" style="margin:.4rem 0"><i style="width:${(w.score / max) * 100}%"></i></div>
      <p style="margin:.2rem 0">${esc(w.advice)}</p><p class="small muted" style="margin:.2rem 0">${esc(w.lesson || '')}</p>
      <div class="small">${w.examples.map((e) => `<button class="ghost small" data-game="${esc(e.gameId)}" data-ply="${e.ply}">${esc(e.san)} (${e.cls})</button>`).join(' ')}</div>
      ${th[w.theme] ? `<p class="small muted">Training so far: ${th[w.theme].solved} solved, ${th[w.theme].failed} missed.</p>` : ''}</div>`).join('') : '<p class="muted">No recurring mistakes found — impressive. Keep reviewing games.</p>'}`;
  box.onclick = async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.train) { showTab('train'); startSession('theme=' + t.dataset.train, THEME()[t.dataset.train]); }
    else if (t.dataset.learn) { showTab('lessons'); openLesson(t.dataset.learn); }
    else if (t.dataset.game) {
      const a = await api(`/api/analysis?user=${encodeURIComponent(S.user)}&gameId=${encodeURIComponent(t.dataset.game)}`); S.analysis = a; S.ply = +t.dataset.ply; showTab('review');
    }
  };
}

// ---------- boot ----------
(async function boot() {
  S.cfg = await api('/api/config').catch(() => ({}));
  renderWho();
  if (!S.user && S.cfg.defaultUser) S.user = S.cfg.defaultUser;
  if (S.user) connect(S.user); else renderGames();
})();

window.cc = { S, get T() { return T; } }; // debugging hook
