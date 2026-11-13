'use strict';
// Precompute safety-scan positions (who defends what, who attacks what) so the page does no heavy work at runtime.
// Samples positions from the player's real games plus the puzzle positions, merges them into drill/data.json as `scan`.
// Usage: node scripts/build-scan.js <username> [perGame=9]
const fs = require('fs'); const path = require('path');
const { Chess } = require('chess.js');
const { makeLoose } = require('../public/js/loose.js');
const store = require('../src/store');
const L = makeLoose(Chess);
const file = path.join(__dirname, '..', 'drill', 'data.json');
const user = process.argv[2]; const perGame = +process.argv[3] || 9;
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const seen = new Set(); const cands = [];
const add = (fen, side, mine) => { const k = fen.split(' ').slice(0, 4).join(' '); if (seen.has(k)) return; seen.add(k); cands.push({ fen: fen.split(' ').slice(0, 4).join(' ') + ' 0 1', side, mine }); };
d.puzzles.forEach((p) => add(p.fen, p.side, !!p.mine));
for (const a of store.listAnalyses(user).filter((x) => ['rapid', 'blitz'].includes(x.game.timeClass))) {
  const idx = a.moves.map((_, i) => i).filter((i) => a.moves[i].ply >= 8 && a.moves[i].ply <= 70);
  for (let n = 0; n < perGame && idx.length; n++) { const i = idx.splice(Math.floor(rnd() * idx.length), 1)[0]; add(a.moves[i].fenBefore, a.moves[i].color, true); }
}
console.log('positions to analyse:', cands.length);
const out = []; const t0 = Date.now();
for (const c of cands) {
  let pieces; try { pieces = L.analyze(c.fen); } catch (e) { continue; }
  if (pieces.length < 2) continue;
  out.push({ f: c.fen.split(' ').slice(0, 2).join(' '), m: c.mine ? 1 : 0, p: pieces.map((x) => [x.square, x.color, x.type, x.defenders.map((y) => y.square + y.type), x.blocked.map((y) => y.square + y.type), x.attackers.map((y) => y.square + y.type), x.gain]) });
}
d.scan = out;
fs.writeFileSync(file, JSON.stringify(d));
console.log('scan positions:', out.length, '|', ((Date.now() - t0) / 1000).toFixed(0) + 's |', (JSON.stringify(out).length / 1024 | 0) + ' KB | data.json', (JSON.stringify(d).length / 1024 | 0) + ' KB');
