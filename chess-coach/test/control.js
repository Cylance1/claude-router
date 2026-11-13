'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Chess } = require('chess.js');
const { makeControl } = require('../public/js/control.js');
const C = makeControl(Chess);
const sq = (fen, color = 'w') => Object.keys(C.controlled(fen, color)).sort();

test('control: start position — White controls ranks 1-3 exactly', () => {
  const s = sq('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  // every square of rank 3 and rank 2 is covered; on rank 1 the corner rooks have no defender, the other six squares are defended
  for (const f of 'abcdefgh') { assert.ok(s.includes(f + '3'), f + '3'); assert.ok(s.includes(f + '2'), f + '2'); }
  assert.ok(!s.includes('a1') && !s.includes('h1'));
  for (const x of ['b1', 'c1', 'd1', 'e1', 'f1', 'g1']) assert.ok(s.includes(x), x);
  assert.ok(!s.some((x) => +x[1] >= 4));
});
test('control: pawns control the two squares diagonally ahead, not the square in front', () => {
  const s = sq('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
  assert.ok(s.includes('d3') && s.includes('f3')); assert.ok(!s.includes('e3') && !s.includes('e4'));
});
test('control: a knight controls its jumps even when surrounded by pieces', () => {
  const s = sq('4k3/8/8/8/8/PPP5/PNP5/4K3 w - - 0 1');
  // Nb2 is boxed in by pawns on a2, c2, a3, b3, c3 yet still covers a4, c4, d1 and d3
  for (const x of ['a4', 'c4', 'd1', 'd3']) assert.ok(s.includes(x), x);
});
test('control: sliders stop at the first piece they meet (and do not see through it)', () => {
  // Ra1, own pawn a3: the rook controls a2 and a3 (defending the pawn) but not a4
  const s = sq('4k3/8/8/8/8/P7/8/R3K3 w - - 0 1');
  assert.ok(s.includes('a2') && s.includes('a3')); assert.ok(!s.includes('a4'));
  // an ENEMY piece is attacked, but the line stops there too
  const t = sq('4k3/8/8/p7/8/8/8/R3K3 w - - 0 1');
  assert.ok(t.includes('a5')); assert.ok(!t.includes('a6'));
});
test('control: a square only counts as controlled when another White piece covers an occupied one', () => {
  // Nc3 is not defended by anything: c3 itself is not controlled
  const s = sq('4k3/8/8/8/8/2N5/8/4K3 w - - 0 1');
  assert.ok(!s.includes('c3')); assert.ok(s.includes('e4') && s.includes('d5'));
});
test('control: bishops and queens work along long diagonals across the board', () => {
  const s = sq('4k3/8/8/8/8/8/8/B3K3 w - - 0 1');
  ['b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8'].forEach((x) => assert.ok(s.includes(x), x));
});
test('control: the king covers its neighbours', () => {
  const s = sq('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  ['d1', 'f1', 'd2', 'e2', 'f2'].forEach((x) => assert.ok(s.includes(x), x));
});
test('control: mask round-trips and splits into near and far halves', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const m = C.mask(fen); assert.strictEqual(m.length, 16);
  const both = C.count(m, 'both'); const near = C.count(m, 'near', 'w'); const far = C.count(m, 'far', 'w');
  assert.strictEqual(both, near + far); assert.strictEqual(both, sq(fen).length);
  assert.strictEqual(far, 0); // White controls nothing past rank 3 at the start, so the far half is empty
  assert.strictEqual(near, 22); // all of ranks 2 and 3 (16) plus b1..g1 (6)
});
test('control: near/far are relative to the colour being read', () => {
  assert.ok(C.inRegion('e2', 'near', 'w') && !C.inRegion('e2', 'far', 'w'));
  assert.ok(C.inRegion('e7', 'near', 'b') && !C.inRegion('e7', 'far', 'b'));
  assert.ok(C.inRegion('e7', 'far', 'w') && C.inRegion('e2', 'far', 'b'));
  assert.ok(C.inRegion('d4', 'near', 'w') && C.inRegion('d5', 'far', 'w') && C.inRegion('d5', 'near', 'b') && C.inRegion('d4', 'far', 'b'));
  // the same position seen from Black: its far half mirrors White's
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  assert.strictEqual(C.count(C.mask(fen, 'b'), 'near', 'b'), 22); assert.strictEqual(C.count(C.mask(fen, 'b'), 'far', 'b'), 0);
});
test('control: Black can be asked too (same engine, other colour)', () => {
  const b = sq('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'b');
  assert.ok(b.includes('a6') && b.includes('h6') && !b.some((x) => +x[1] <= 5));
});
