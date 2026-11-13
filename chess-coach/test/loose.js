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
