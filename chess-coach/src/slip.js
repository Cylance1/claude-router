'use strict';
// Possible mouse slips / miss-taps: a mistake where a GOOD move was exactly one square from the move played
//   (a) same piece, destination one square off   (b) the piece one square over, same destination
const { Chess } = require('chess.js');
const { lineCp, winPct } = require('./engine');
const { classify } = require('./analyze');

const adj = (a, b) => a !== b && Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(+a[1] - +b[1])) === 1;

function adjacentMoves(fen, played) {
  const pf = played.slice(0, 2); const pt = played.slice(2, 4);
  return new Chess(fen).moves({ verbose: true }).filter((x) => {
    const u = x.from + x.to + (x.promotion || ''); if (u === played) return false;
    return (x.from === pf && adj(x.to, pt)) || (x.to === pt && adj(x.from, pf));
  });
}

/** Best adjacent alternative for move record `m` (from analyzeGame), or null. Alt must grade best / excellent / good. */
async function nearMiss(pool, m, depth = 14) {
  if (!m.winLoss || m.winLoss < 8) return null;
  const sg = m.color === 'w' ? 1 : -1; const bestWin = winPct(sg * m.evalBefore);
  const alts = adjacentMoves(m.fenBefore, m.uci);
  const res = await Promise.all(alts.map(async (x) => {
    const ch = new Chess(m.fenBefore); ch.move(x);
    let cp;
    if (ch.isCheckmate()) cp = 10000; else if (ch.isGameOver()) cp = 0; else cp = -lineCp((await pool.analyze(ch.fen(), { depth })).lines[0]);
    const loss = Math.max(0, bestWin - winPct(cp)); const uci = x.from + x.to + (x.promotion || '');
    return { san: x.san, uci, loss: +loss.toFixed(1), cls: classify(loss, uci === m.bestUci), kind: x.from === m.uci.slice(0, 2) ? 'destination' : 'piece' };
  }));
  return res.filter((r) => ['best', 'excellent', 'good'].includes(r.cls)).sort((a, b) => a.loss - b.loss)[0] || null;
}
module.exports = { nearMiss, adjacentMoves };
