'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Chess } = require('chess.js');
const T = require('../src/themes');
const { classify } = require('../src/analyze');
const P = require('../src/puzzles');
const { EnginePool, winPct } = require('../src/engine');
const { templateExplain } = require('../src/coach');

test('theme detector: knight fork', () => {
  const r = T.analyzeLine('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', ['d5c7', 'e8d8', 'c7a8']);
  assert.strictEqual(r.primary, 'fork');
});
test('theme detector: back-rank mate', () => {
  const r = T.analyzeLine('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', ['a1a8']);
  assert.ok(r.themes.includes('backRankMate'));
  assert.strictEqual(r.mateIn, 1);
});
test('theme detector: free piece beats incidental pin', () => {
  const r = T.analyzeLine('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1', ['d1d5']);
  assert.strictEqual(r.primary, 'hangingPiece');
});
test('theme detector: pin only counts when the pinned piece is won', () => {
  const win = T.analyzeLine('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', ['f1b5', 'e8d8', 'b5c6']);
  assert.ok(win.themes.includes('pin'), JSON.stringify(win.themes));
  // same pattern, but nothing is won afterwards -> not a pin lesson
  const idle = T.analyzeLine('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', ['f1b5', 'e8d8', 'e1e2']);
  assert.ok(!idle.themes.includes('pin'), JSON.stringify(idle.themes));
});
test('move classification thresholds', () => {
  assert.strictEqual(classify(0.2, false), 'best');
  assert.strictEqual(classify(10, false), 'inaccuracy');
  assert.strictEqual(classify(20, false), 'mistake');
  assert.strictEqual(classify(40, false), 'blunder');
  assert.ok(winPct(0) === 50 && winPct(1000) > 95);
});
test('seed library: every solution is legal and ends with a winning move for the side to move', () => {
  const all = P.all();
  assert.ok(all.length >= 100, 'seed library should ship with puzzles');
  for (const p of all) {
    const c = new Chess(p.fen);
    assert.strictEqual(c.turn(), p.side, p.id);
    assert.strictEqual(p.solution.length % 2, 1, 'solution ends on the student\'s move: ' + p.id);
    for (const u of p.solution) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    if (p.setup) { const s = new Chess(p.setup.fen); s.move({ from: p.setup.move.slice(0, 2), to: p.setup.move.slice(2, 4), promotion: p.setup.move[4] }); assert.strictEqual(s.fen().split(' ').slice(0, 4).join(' '), p.fen.split(' ').slice(0, 4).join(' '), 'setup leads to puzzle: ' + p.id); }
  }
});
test('every theme has a lesson and a hint', () => {
  const { LESSONS } = require('../src/lessons');
  for (const t of T.THEME_ORDER) assert.ok(LESSONS[t], t);
});
test('puzzle checking with the real engine: correct, alternative and wrong answers', async () => {
  const pool = new EnginePool(2);
  try {
    // mate in one: Qxg7# (alternatives that also mate are accepted)
    const puzzle = { id: 'x', fen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', solution: ['a1a8'], solutionSan: ['Ra8#'], theme: 'backRankMate', themes: ['backRankMate'] };
    const ok = await P.checkMove(pool, puzzle, 0, 'a1a8');
    assert.ok(ok.correct && ok.done);
    const bad = await P.checkMove(pool, puzzle, 0, 'e1e2');
    assert.strictEqual(bad.correct, false);
    assert.ok(bad.why && bad.why.length > 5);
    const illegal = await P.checkMove(pool, puzzle, 0, 'a1h8');
    assert.ok(illegal.illegal);
    // coach template explains a synthetic blunder without crashing
    const m = { color: 'w', moveNumber: 5, san: 'Qh5', evalBefore: 30, evalAfter: -400, winLoss: 40, cls: 'blunder', fenBefore: puzzle.fen, fenAfter: puzzle.fen, bestSan: 'Ra8#', bestLine: ['Ra8#'], refutationLine: ['Kf8'], lesson: { kind: 'missed', theme: 'backRankMate', label: 'Back-rank mate' }, missed: { themes: ['backRankMate', 'mate'], primary: 'backRankMate', detail: { mate: { in: 1, move: 'Ra8#' } }, gain: 0 }, allowed: null };
    const ex = templateExplain(m, {});
    assert.match(ex.sections.why, /back-rank/i);
  } finally { pool.close(); }
});
require('./loose.js');
