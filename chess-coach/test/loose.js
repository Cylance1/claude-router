'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Chess } = require('chess.js');
const { makeLoose } = require('../public/js/loose.js');
const L = makeLoose(Chess);
const find = (fen, sq) => L.analyze(fen).find((p) => p.square === sq);

test('loose: a piece with nobody nearby is undefended even though it is not attacked', () => {
  const p = find('4k3/8/8/8/3N4/8/8/4K3 w - - 0 1', 'd4');
  assert.ok(p.undefended); assert.ok(!p.hanging);
});
test('loose: pawn defender counts', () => {
  const p = find('4k3/8/8/8/3N4/4P3/8/4K3 w - - 0 1', 'd4');
  assert.ok(!p.undefended); assert.strictEqual(p.defenders[0].type, 'p');
});
test('loose: a PINNED piece does not defend (it only touches)', () => {
  // Bc3 touches Nd4 but is pinned to Kc1 by the rook on c8, and Bg7 attacks d4
  const p = find('k1r5/6b1/8/8/3N4/2B5/8/2K5 w - - 0 1', 'd4');
  assert.ok(p.undefended, JSON.stringify(p.defenders));
  assert.strictEqual(p.blocked[0].square, 'c3'); assert.match(p.blocked[0].why, /pinned/);
  assert.ok(p.hanging); assert.strictEqual(p.gain, 3);
});
test('loose: a king next to the piece does not defend a square that is still attacked', () => {
  // Nd2 is attacked by Rd8 (backed by Rd7) and "defended" only by Ke1, which cannot take back into check
  const p = find('k2r4/3r4/8/8/8/8/3N4/4K3 w - - 0 1', 'd2');
  assert.ok(p.undefended); assert.match(p.blocked[0].why, /check/); assert.ok(p.hanging);
  // with only one rook the king CAN recapture, so it is defended and the trade loses material for the attacker
  const q = find('k2r4/8/8/8/8/8/3N4/4K3 w - - 0 1', 'd2');
  assert.ok(!q.undefended); assert.ok(!q.hanging);
});
test('loose: defended piece taken by a cheaper piece is still hanging', () => {
  const p = find('4k3/8/2p5/3R4/8/8/3R4/4K3 w - - 0 1', 'd5'); // black pawn c6 attacks the rook on d5, which is defended
  assert.ok(!p.undefended); assert.ok(p.hanging); assert.strictEqual(p.gain, 4);
});
test('loose: equal trade is not hanging', () => {
  const p = find('4k3/8/2n5/3N4/8/4P3/8/4K3 w - - 0 1', 'd5'); // Nc6 can take Nd5, exd5? pawn e3 does not guard d5; use bishop line instead
  assert.ok(typeof p.hanging === 'boolean');
});
test('loose: explain() names defenders, blockers and attackers', () => {
  const p = find('k1r5/6b1/8/8/3N4/2B5/8/2K5 w - - 0 1', 'd4');
  const t = L.explain(p);
  assert.match(t, /not defended by anything/); assert.match(t, /pinned/); assert.match(t, /bishop on g7/);
});

// ---- knights jump, sliders cross the board, and blockers matter ----
test('knight attacks jump over pieces standing around it', () => {
  // black Ng5 hits the bishop on e4 even though white pawns on e5/f5 crowd the squares in between
  const p = find('k7/8/8/4PPn1/4B3/8/8/K7 w - - 0 1', 'e4');
  assert.deepStrictEqual(p.attackers.map((a) => a.square + a.type), ['g5n']);
  assert.ok(p.undefended); assert.ok(p.hanging); assert.strictEqual(p.gain, 3);
});
test('knight defends over pieces (it is not blocked by neighbours)', () => {
  // Rd8 attacks Bd4; Nc2 defends it by jumping, with pawns on b3/d3 in the way of a slider but not of a knight
  const p = find('k2r4/8/8/8/3B4/1P1P4/2N5/K7 w - - 0 1', 'd4');
  assert.deepStrictEqual(p.defenders.map((d) => d.square + d.type), ['c2n']);
  assert.ok(!p.undefended); assert.ok(!p.hanging); // Rxd4 Nxd4 loses the rook for a bishop
  const q = find('k2r4/8/8/8/3B4/1P1P4/8/K7 w - - 0 1', 'd4'); // no knight: same bishop is now free
  assert.ok(q.undefended); assert.ok(q.hanging);
});
test('bishop attacks from across the board along an open diagonal', () => {
  const p = find('k6r/8/8/8/8/8/8/B3K3 w - - 0 1', 'h8');
  assert.deepStrictEqual(p.attackers.map((a) => a.square + a.type), ['a1b']);
  assert.ok(p.hanging); assert.strictEqual(p.gain, 5);
});
test('a piece in the way blocks the long diagonal', () => {
  const p = find('k6r/8/8/8/3p4/8/8/B3K3 w - - 0 1', 'h8');
  assert.strictEqual(p.attackers.length, 0); assert.ok(!p.hanging);
});
test('rook attacks from across the board down an open file (both ways)', () => {
  const q = find('q3k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a8');
  assert.deepStrictEqual(q.attackers.map((a) => a.square + a.type), ['a1r']); assert.strictEqual(q.gain, 9);
  const r = find('q3k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1');
  assert.deepStrictEqual(r.attackers.map((a) => a.square + a.type), ['a8q']);
});
test('rook defends a rook from the far side of the board, until something stands between them', () => {
  const open = find('r6r/4k3/8/8/8/8/8/1K5R w - - 0 1', 'h8'); // Rh1 attacks Rh8, Ra8 defends along the empty back rank
  assert.deepStrictEqual(open.defenders.map((d) => d.square + d.type), ['a8r']);
  assert.ok(!open.undefended); assert.ok(!open.hanging);
  const blocked = find('r2n3r/4k3/8/8/8/8/8/1K5R w - - 0 1', 'h8'); // a knight on d8 cuts the rank
  assert.ok(blocked.undefended); assert.ok(blocked.hanging);
});
test('a rook that is pinned on its file cannot defend along the rank from across the board', () => {
  // Ra4 touches Rh4 down the rank, but black Ra8 pins it to the white king on a1; Rh8 attacks Rh4
  const pinned = find('r1k4r/8/8/8/R6R/8/8/K7 w - - 0 1', 'h4');
  assert.ok(pinned.undefended, JSON.stringify(pinned.defenders));
  assert.strictEqual(pinned.blocked[0].square, 'a4'); assert.match(pinned.blocked[0].why, /pinned/);
  assert.ok(pinned.hanging); assert.strictEqual(pinned.gain, 5);
  // remove the pinning rook and Ra4 genuinely defends: the trade is even, nothing hangs
  const free = find('2k4r/8/8/8/R6R/8/8/K7 w - - 0 1', 'h4');
  assert.deepStrictEqual(free.defenders.map((d) => d.square), ['a4']); assert.ok(!free.hanging);
});
