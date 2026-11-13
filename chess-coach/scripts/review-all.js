'use strict';
// Review every live (rapid/blitz) game for a user and save the analyses. Usage: node scripts/review-all.js <username>
const cc = require('../src/chesscom');
const { EnginePool } = require('../src/engine');
const { analyzeGame } = require('../src/analyze');
const store = require('../src/store');
const P = require('../src/puzzles');
(async () => {
  const user = process.argv[2];
  const games = await cc.getRecentGames(user, { months: 12, max: 500, timeClasses: ['rapid', 'blitz'] });
  const pool = new EnginePool();
  let n = 0;
  for (const g of games) {
    n++;
    if (store.loadAnalysis(g.me.username, g.id)) continue;
    try {
      const a = await analyzeGame(g, pool, { depth: 14 });
      P.add((await P.mineAnalysis(a, pool, { user: a.user })).filter((p) => p.owner));
      store.saveAnalysis(a);
    } catch (e) { console.error('skip', g.id, e.message); }
    console.log(`${n}/${games.length}`);
  }
  pool.close(); console.log('done');
})();
