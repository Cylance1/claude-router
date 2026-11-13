'use strict';
// Puzzle mining, library storage, selection and live move checking.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Chess } = require('chess.js');
const { lineCp, winPct } = require('./engine');
const { analyzeLine, pvToSan, uciToSan, THEME_LABEL, VAL } = require('./themes');
const { analyzeGame, replay } = require('./analyze');
const { hints } = require('./coach');

const DATA = path.join(__dirname, '..', 'data');
const LIB_FILE = path.join(DATA, 'puzzles.json');
const SEED_FILE = path.join(DATA, 'seed-puzzles.json');

const MISSED = ['inaccuracy', 'mistake', 'blunder'];
const id = (fen) => crypto.createHash('sha1').update(fen.split(' ').slice(0, 4).join(' ')).digest('hex').slice(0, 10);

// ---------- storage ----------
let lib = null;
function load() {
  if (lib) return lib;
  lib = new Map();
  for (const f of [SEED_FILE, LIB_FILE]) {
    try { for (const p of JSON.parse(fs.readFileSync(f, 'utf8'))) lib.set(p.id, p); } catch (e) { /* none yet */ }
  }
  return lib;
}
function save() {
  fs.mkdirSync(DATA, { recursive: true });
  const mine = [...load().values()].filter((p) => p.owner);
  fs.writeFileSync(LIB_FILE, JSON.stringify(mine));
}
function add(puzzles) {
  const L = load();
  let n = 0;
  for (const p of puzzles) if (!L.has(p.id)) { L.set(p.id, p); n++; }
  if (n) save();
  return n;
}
const all = () => [...load().values()];
const get = (pid) => load().get(pid);
function publicView(p) {
  const { solution, solutionSan, ...rest } = p;
  return { ...rest, plies: solution.length, themeLabel: THEME_LABEL[p.theme] };
}
function stats() {
  const by = {};
  for (const p of all()) by[p.theme] = (by[p.theme] || 0) + 1;
  return { total: load().size, byTheme: by };
}

// ---------- mining ----------
function isTrivialRecapture(prevMove, firstUci) {
  return prevMove && prevMove.captured && firstUci.slice(2, 4) === prevMove.to;
}

function buildPuzzle({ fen, top, theme, origin, setup, source, yourMove, prevMove }) {
  const pv = top.pv;
  let n = top.mate > 0 ? Math.min(pv.length, top.mate * 2 - 1) : Math.min(pv.length, 5);
  if (n % 2 === 0) n--;
  const solution = pv.slice(0, n);
  const c = new Chess(fen);
  const first = c.move({ from: solution[0].slice(0, 2), to: solution[0].slice(2, 4), promotion: solution[0][4] });
  const res = analyzeLine(fen, solution, top.mate);
  const quiet = !first.captured && !first.san.includes('+');
  const difficulty = Math.max(1, Math.min(5, 1 + (quiet ? 1 : 0) + (solution.length >= 5 ? 1 : 0) + (res.themes.includes('sacrifice') ? 1 : 0) + (res.mateIn >= 3 ? 1 : 0)));
  const sideToMove = new Chess(fen).turn();
  return {
    id: id(fen), fen, side: sideToMove, solution, solutionSan: pvToSan(fen, solution), theme: res.primary, themes: res.themes,
    detail: res.detail, mateIn: res.mateIn, gain: res.gain, difficulty, origin, setup, source, yourMove, owner: null,
    eval: lineCp(top),
  };
}

/**
 * Find puzzle candidates in an analysed game (analysis._raw required) and verify each with a deeper search.
 * Two kinds:
 *  - "opponent-blunder": the opponent just erred; find the punishing move.
 *  - "my-mistake": the player blundered here; find the move they should have played.
 */
async function mineAnalysis(a, pool, { verifyDepth = 15, user } = {}) {
  const raw = a._raw;
  if (!raw) return [];
  const { positions } = raw;
  const cands = [];
  const seen = new Set();
  for (let i = 0; i < a.moves.length; i++) {
    const m = a.moves[i];
    if (m.ply < 8) continue; // skip pure opening theory
    const prev = a.moves[i - 1];
    const list = [];
    // A: previous mover blundered -> this position is a chance
    if (prev && prev.winLoss >= 20) list.push({ kind: 'opponent-blunder', yourMove: m.mine && MISSED.includes(m.cls) ? m.san : null, prevMove: prev }); // only a "missed chance" if you really played worse
    // B: the player blundered here -> find what should have been played
    if (m.mine && m.winLoss >= 22 && m.cls !== 'best') list.push({ kind: 'my-mistake', yourMove: m.san, prevMove: null });
    for (const cd of list) {
      const fen = positions[i];
      const pid = id(fen);
      if (seen.has(pid)) continue;
      const g = new Chess(fen);
      if (g.isGameOver() || g.moves().length < 2) continue;
      seen.add(pid);
      cands.push({ ...cd, fen, i, m });
    }
  }
  const verified = await Promise.all(cands.map(async (cd) => {
    const r = await pool.analyze(cd.fen, { depth: verifyDepth, multipv: 3 });
    const [t1, t2] = r.lines;
    if (!t1 || !t1.pv.length || t1.mate < 0) return null;
    const c1 = lineCp(t1);
    const c2 = t2 ? lineCp(t2) : -10000;
    const gap = winPct(c1) - winPct(c2);
    if (cd.kind === 'opponent-blunder') { if (c1 < 150 || gap < 14) return null; } else if (c1 < -150 || gap < 14) return null;
    if (t2 && t1.mate > 0 && t2.mate > 0 && Math.abs(t2.mate - t1.mate) <= 1) return null; // several mates: not unique
    if (cd.prevMove && /x/.test(cd.prevMove.san) && t1.pv[0].slice(2, 4) === cd.prevMove.uci.slice(2, 4) && !(t1.mate > 0)) {
      const r0 = analyzeLine(cd.fen, t1.pv.slice(0, 3), t1.mate); // plain recapture: only keep if it hides a tactic
      if (r0.primary === 'winsMaterial' || r0.primary === 'positional') return null;
    }
    const setup = cd.prevMove ? { fen: positions[cd.i - 1], move: cd.prevMove.uci, san: cd.prevMove.san } : null;
    const p = buildPuzzle({
      fen: cd.fen, top: t1, origin: cd.kind, setup, yourMove: cd.yourMove,
      source: { game: a.game.url, ply: cd.m.ply, white: a.game.white.username, black: a.game.black.username, date: a.game.endTime },
    });
    if (cd.kind === 'my-mistake' || (cd.yourMove && user)) p.owner = user || a.user; // your own positions are personal
    return p;
  }));
  return verified.filter(Boolean);
}

/** Analyse a list of games quickly and mine puzzles from them. */
async function mineGames(games, pool, { depth = 12, verifyDepth = 15, onProgress, user, stopWhen } = {}) {
  const found = [];
  for (let gi = 0; gi < games.length; gi++) {
    try {
      const a = await analyzeGame(games[gi], pool, { depth });
      found.push(...(await mineAnalysis(a, pool, { verifyDepth, user })));
    } catch (e) { /* skip unreadable game */ }
    if (onProgress) onProgress((gi + 1) / games.length, found);
    if (stopWhen && stopWhen(found)) break;
  }
  return found;
}

// ---------- selection ----------
function pick({ themes, owner, count = 10, progress = {}, origin, maxDifficulty = 5, minDifficulty = 1, exclude = [] }) {
  const now = Date.now();
  const pool = all().filter((p) => (!p.owner || p.owner === owner) && !exclude.includes(p.id) &&
    p.difficulty >= minDifficulty && p.difficulty <= maxDifficulty && (!origin || p.origin === origin));
  const score = (p) => {
    const pr = progress[p.id];
    let s = Math.random();
    if (themes && themes.length && themes.includes(p.theme)) s += 3;
    else if (themes && themes.length && p.themes.some((t) => themes.includes(t))) s += 1.5;
    if (p.owner && p.owner === owner) s += 2.5; // your own positions first
    if (pr) {
      if (pr.lastResult === 'failed' && now - pr.last > 3600e3) s += 2; // due for review
      else if (pr.solved && now - pr.last < 7 * 86400e3) s -= 4;
      else s -= 1;
    }
    return s;
  };
  return pool.map((p) => [score(p), p]).sort((a, b) => b[0] - a[0]).slice(0, count).map(([, p]) => p);
}

// ---------- live checking ----------
function positionAt(puzzle, step) {
  const c = new Chess(puzzle.fen);
  for (let i = 0; i < step; i++) {
    const u = puzzle.solution[i];
    c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  }
  return c;
}

/**
 * The student plays `uci` at solution index `step` (even). Returns feedback.
 */
async function checkMove(pool, puzzle, step, uci) {
  const expected = puzzle.solution[step];
  const pos = positionAt(puzzle, step);
  const fen = pos.fen();
  let move;
  try { move = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch (e) { return { illegal: true }; }
  const normalized = move.from + move.to + (move.promotion || '');
  if (normalized === expected) {
    const reply = puzzle.solution[step + 1] || null;
    return { correct: true, san: move.san, reply, replySan: reply ? uciToSan(positionAt(puzzle, step + 1).fen(), reply) : null, done: !reply, nextStep: step + 2 };
  }
  // Not the main line: is it an equally good alternative?
  const r = await pool.analyze(fen, { depth: 14, multipv: 4 });
  const top = r.lines[0];
  const topCp = lineCp(top);
  const alt = r.lines.find((l) => l.pv[0] === normalized);
  if (alt && winPct(topCp) - winPct(lineCp(alt)) < 5) {
    return { correct: true, alternative: true, san: move.san, done: true, line: pvToSan(fen, alt.pv, 6), mainSan: puzzle.solutionSan[step],
      message: `${move.san} also works (the engine agrees)! The main line was ${puzzle.solutionSan[step]}.` };
  }
  // Wrong: what punishes it?
  const after = new Chess(fen); after.move({ from: move.from, to: move.to, promotion: move.promotion });
  const wasCheckmate = after.isCheckmate();
  const rr = after.isGameOver() ? { lines: [], best: null } : await pool.analyze(after.fen(), { depth: 14, multipv: 1 });
  const refPv = rr.lines[0] ? rr.lines[0].pv : [];
  const afterCp = rr.lines[0] ? -lineCp(rr.lines[0]) : 0; // student's view
  const refSan = pvToSan(after.fen(), refPv, 4);
  const analysis = refPv.length ? analyzeLine(after.fen(), refPv.slice(0, 3), rr.lines[0].mate) : null;
  let why;
  if (analysis && analysis.themes.includes('mate') && rr.lines[0].mate > 0) why = `That walks into **${refSan[0]}** and forced checkmate.`;
  else if (analysis && analysis.gain >= 2) why = `After ${move.san}, your opponent plays **${refSan[0]}** and wins about ${Math.round(analysis.gain)} points of material.`;
  else if (winPct(topCp) - winPct(afterCp) > 15) why = `${move.san} isn't strong enough — your opponent can answer **${refSan[0] || '…'}** and the advantage disappears.`;
  else why = `${move.san} is playable, but it is not the best — there is a stronger idea.`;
  const better = winPct(topCp) - winPct(afterCp) < 12;
  return { correct: false, san: move.san, why, refutation: refSan, nearly: better, wasCheckmate };
}

function describeSolution(puzzle) {
  const { LESSONS } = require('./lessons');
  const { describeIdea } = require('./coach');
  const idea = describeIdea({ primary: puzzle.theme, themes: puzzle.themes, detail: puzzle.detail, gain: puzzle.gain });
  const lesson = LESSONS[puzzle.theme] || LESSONS.positional;
  const { formatLine } = require('./themes');
  return {
    line: formatLine(puzzle.fen, puzzle.solutionSan),
    idea: idea ? `The idea: ${idea}.` : 'The idea: improving your position while keeping every piece safe.',
    takeaway: lesson.takeaway,
  };
}

module.exports = { mineAnalysis, mineGames, add, all, get, load, pick, checkMove, publicView, stats, hints, describeSolution, id, positionAt };
