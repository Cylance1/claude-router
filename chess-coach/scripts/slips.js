'use strict';
// Look for possible mouse slips / miss-taps: mistakes where a good move was ONE SQUARE away from the move played.
//  (a) same piece, destination one square off     (b) piece one square over, same destination
// Opponents' mistakes are run through the same test as a control: if you slip no more than they "coincidentally" do, there is no pattern.
// Usage: node scripts/slips.js <username> [out.json]
const fs = require('fs');
const { Chess } = require('chess.js');
const { EnginePool } = require('../src/engine');
const { nearMiss, adjacentMoves } = require('../src/slip');
const store = require('../src/store');

const user = process.argv[2];
const clk = (s) => { const [h, m, x] = s.split(':'); return +h * 3600 + +m * 60 + +x; };

function moveTimes(a) {
  const c = [...a.pgn.matchAll(/\{\[%clk ([\d:.]+)\]\}/g)].map((m) => clk(m[1]));
  if (c.length !== a.moves.length) return null;
  const [base, inc] = String(a.game.timeControl).split('+').map(Number); const last = { w: base, b: base };
  return a.moves.map((m, i) => { const t = Math.max(0, last[m.color] - c[i] + (inc || 0)); last[m.color] = c[i]; return t; });
}

(async () => {
  const analyses = store.listAnalyses(user).filter((a) => ['rapid', 'blitz'].includes(a.game.timeClass));
  const pool = new EnginePool();
  const jobs = [];
  for (const a of analyses) {
    const times = moveTimes(a);
    a.moves.forEach((m, i) => {
      if (m.winLoss < 8) return; // inaccuracy or worse
      if (adjacentMoves(m.fenBefore, m.uci).length) jobs.push({ a, m, i, t: times ? times[i] : null });
    });
  }
  console.log('mistakes with at least one adjacent alternative:', jobs.length);
  const out = [];
  let k = 0;
  for (const j of jobs) {
    const alt = await nearMiss(pool, j.m);
    out.push({ game: j.a.gameId, url: j.a.game.url, mine: j.m.mine, ply: j.m.ply, moveNumber: j.m.moveNumber, color: j.m.color, san: j.m.san, cls: j.m.cls, loss: j.m.winLoss, seconds: j.t, alt, nearMiss: !!alt });
    if (++k % 50 === 0) console.log(k + '/' + jobs.length);
  }
  pool.close();
  fs.writeFileSync(process.argv[3] || require('path').join(__dirname, '..', 'data', 'slips.json'), JSON.stringify(out));
  const all = analyses.flatMap((a) => a.moves.filter((m) => m.winLoss >= 8).map((m) => ({ mine: m.mine, cls: m.cls })));
  const summarize = (who) => {
    const base = all.filter((x) => x.mine === who);
    const row = (clsSet) => { const b = base.filter((x) => clsSet.includes(x.cls)).length; const s = out.filter((o) => o.mine === who && o.nearMiss && clsSet.includes(o.cls)).length; return `${s} of ${b} (${b ? (100 * s / b).toFixed(1) : 0}%)`; };
    return { 'all mistakes (inaccuracy+)': row(['inaccuracy', 'mistake', 'blunder']), 'mistakes+blunders': row(['mistake', 'blunder']), blunders: row(['blunder']) };
  };
  console.log('YOU     ', JSON.stringify(summarize(true)));
  console.log('OPPONENT', JSON.stringify(summarize(false)));
})();
