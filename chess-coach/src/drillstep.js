'use strict';
// For one position: the engine's verdict on EVERY legal move (accepted alternatives vs. wrong + why). Used to precompute drills for static hosting.
const { Chess } = require('chess.js');
const { lineCp, winPct } = require('./engine');
const P = require('./puzzles');

async function stepData(pool, fen, solutionMove) {
  const base = new Chess(fen);
  const legal = base.moves({ verbose: true });
  const res = await Promise.all(legal.map(async (m) => {
    const ch = new Chess(fen); ch.move(m);
    const uci = m.from + m.to + (m.promotion || '');
    if (ch.isCheckmate()) return { uci, san: m.san, cp: 10000, refPv: [], afterFen: ch.fen(), mated: true };
    if (ch.isGameOver()) return { uci, san: m.san, cp: 0, refPv: [], afterFen: ch.fen() };
    const r = await pool.analyze(ch.fen(), { depth: 11 });
    const l = r.lines[0];
    return { uci, san: m.san, cp: -lineCp(l), refPv: l.pv, refMate: l.mate, afterFen: ch.fen() };
  }));
  const best = Math.max(...res.map((r) => r.cp));
  const ok = res.filter((r) => r.uci === solutionMove || winPct(best) - winPct(r.cp) < 5).map((r) => r.uci);
  const bad = {};
  for (const r of res) {
    if (ok.includes(r.uci)) continue;
    const f = P.wrongFeedback({ san: r.san, afterFen: r.afterFen, refPv: r.refPv, refMate: r.refMate, topCp: best, afterCp: r.cp, wasCheckmate: r.mated });
    bad[r.uci] = [f.why, f.refutation, f.nearly ? 1 : 0];
  }
  return { ok, bad };
}

module.exports = { stepData };
