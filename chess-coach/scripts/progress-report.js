'use strict';
// Compare older vs newer reviewed games. Usage: node scripts/progress-report.js <username>
const store = require('../src/store');
const { buildProfile } = require('../src/profile');
const user = process.argv[2];
const all = store.listAnalyses(user).filter((a) => ['rapid', 'blitz'].includes(a.game.timeClass)).sort((a, b) => a.game.endTime - b.game.endTime);
const half = Math.floor(all.length / 2);
const groups = { older: all.slice(0, half), newer: all.slice(half) };
const stat = (as) => {
  const p = buildProfile(as);
  const mv = as.flatMap((a) => a.moves.filter((m) => m.mine));
  const n = as.length;
  const lens = as.map((a) => a.moves.length / 2);
  const early = mv.filter((m) => m.ply <= 20);
  const pct = (xs, f) => (xs.length ? +(100 * xs.filter(f).length / xs.length).toFixed(1) : null);
  const avgLoss = (xs) => (xs.length ? +(xs.reduce((s, m) => s + m.winLoss, 0) / xs.length).toFixed(2) : null);
  const rate = (c) => +(mv.filter((m) => m.cls === c).length / n).toFixed(2);
  return {
    games: n, from: new Date(as[0].game.endTime * 1000).toISOString().slice(0, 10), to: new Date(as[n - 1].game.endTime * 1000).toISOString().slice(0, 10),
    record: p.results, rating: [as[0].game.me.rating, as[n - 1].game.me.rating], accuracy: p.avgAccuracy, avgMovesPerGame: +(lens.reduce((s, x) => s + x, 0) / n).toFixed(1),
    perGame: { blunders: rate('blunder'), mistakes: rate('mistake'), inaccuracies: rate('inaccuracy') },
    avgWinLossPerMove: avgLoss(mv), phases: p.phases,
    openingBlunders: +(early.filter((m) => m.cls === 'blunder').length / n).toFixed(2),
    bestMovePct: pct(mv, (m) => m.cls === 'best'),
    themesPerGame: Object.fromEntries(p.weaknesses.map((w) => [w.label, +(w.count / n).toFixed(2)])),
    hanging: p.weaknesses.find((w) => w.theme === 'hangingPiece'),
    asColor: ['w', 'b'].map((c) => { const g = as.filter((a) => a.myColor === c); return `${c === 'w' ? 'White' : 'Black'}: ${g.filter((a) => a.game.result === 'win').length}W/${g.length}`; }),
  };
};
console.log('total reviewed live games:', all.length);
const out = { older: stat(groups.older), newer: stat(groups.newer) };
console.log(JSON.stringify(out, null, 1));
// biggest repeated single-position mistakes & openings
const mistakes = all.flatMap((a) => a.moves.filter((m) => m.mine && m.cls === 'blunder').map((m) => ({ g: a.gameId.slice(0, 6), t: new Date(a.game.endTime * 1000).toISOString().slice(0, 10), ply: m.ply, san: m.san, theme: m.lesson && m.lesson.label, kind: m.lesson && m.lesson.kind, best: m.bestSan })));
console.log('blunders by theme/kind:', JSON.stringify(mistakes.reduce((o, m) => { const k = `${m.theme}/${m.kind}`; o[k] = (o[k] || 0) + 1; return o; }, {})));
const phase = (m) => (m.ply <= 20 ? 'opening' : 'later');
console.log('blunder timing (ply buckets):', JSON.stringify(mistakes.reduce((o, m) => { const k = m.ply <= 10 ? '1-10' : m.ply <= 20 ? '11-20' : m.ply <= 40 ? '21-40' : '41+'; o[k] = (o[k] || 0) + 1; return o; }, {})));
const op = {}; all.forEach((a) => { const k = `${a.myColor === 'w' ? 'W' : 'B'}: ${a.game.opening || '?'}`; const o = op[k] || (op[k] = { n: 0, w: 0, acc: 0 }); o.n++; if (a.game.result === 'win') o.w++; o.acc += a.summary.accuracy; });
console.log('openings:', JSON.stringify(Object.entries(op).filter(([, v]) => v.n >= 3).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${k} ${v.w}/${v.n} acc ${(v.acc / v.n).toFixed(0)}`)));
// results by how game ended + time trouble proxies
const how = {}; all.forEach((a) => { const k = `${a.game.result}:${a.game.how}`; how[k] = (how[k] || 0) + 1; }); console.log('how games ended:', JSON.stringify(how));
