'use strict';
// Merge the mouse-slip analysis (data/slips.json from scripts/slips.js) into drill/data.json.
const fs = require('fs'); const path = require('path');
const store = require('../src/store');
const f = path.join(__dirname, '..', 'drill', 'data.json');
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
const slips = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'slips.json'), 'utf8'));
const analyses = store.listAnalyses(d.user).filter((a) => ['rapid', 'blitz'].includes(a.game.timeClass));
const strong = (x) => x.nearMiss && x.loss >= 15 && x.alt.loss < 5;
const mine = slips.filter((x) => x.mine); const opp = slips.filter((x) => !x.mine);
const rate = (arr, pred) => arr.filter(pred).length;
const acc = (loss) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
// accuracy as played vs. accuracy if each likely slip had been the adjacent good move
const fix = new Map(mine.filter(strong).map((x) => [x.game + ':' + x.ply, x.alt.loss]));
let now = 0, adj = 0, n = 0;
for (const a of analyses) {
  const mv = a.moves.filter((m) => m.mine); if (!mv.length) continue;
  now += acc(mv.reduce((s, m) => s + m.winLoss, 0) / mv.length);
  adj += acc(mv.reduce((s, m) => s + (fix.has(a.gameId + ':' + m.ply) ? fix.get(a.gameId + ':' + m.ply) : m.winLoss), 0) / mv.length); n++;
}
const blunders = analyses.flatMap((a) => a.moves.filter((m) => m.mine && m.cls === 'blunder')).length;
const oppBl = analyses.flatMap((a) => a.moves.filter((m) => !m.mine && m.cls === 'blunder')).length;
d.slips = {
  games: n, blunders,
  strong: rate(mine, strong), oppStrong: rate(opp, strong),
  fast: rate(mine, (x) => strong(x) && x.seconds != null && x.seconds < 3),
  blunderNearRate: +(100 * rate(mine, (x) => x.cls === 'blunder' && x.nearMiss) / blunders).toFixed(1),
  oppBlunderNearRate: +(100 * rate(opp, (x) => x.cls === 'blunder' && x.nearMiss) / oppBl).toFixed(1),
  accuracyNow: +(now / n).toFixed(1), accuracyAdjusted: +(adj / n).toFixed(1),
  list: mine.filter(strong).sort((a, b) => (a.seconds ?? 99) - (b.seconds ?? 99)).slice(0, 8).map((x) => ({
    url: x.url, move: `${x.moveNumber}${x.color === 'w' ? '.' : '...'} ${x.san}`, alt: x.alt.san, altCls: x.alt.cls, kind: x.alt.kind, seconds: x.seconds == null ? null : +x.seconds.toFixed(1), loss: Math.round(x.loss), cls: x.cls })),
};
fs.writeFileSync(f, JSON.stringify(d)); console.log(JSON.stringify({ ...d.slips, list: d.slips.list.length + ' items' }));
