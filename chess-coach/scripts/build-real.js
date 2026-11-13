'use strict';
// Turn the player's REAL mistakes into drill positions and merge them (plus rating history) into drill/data.json.
// Usage: node scripts/build-real.js <username>
const fs = require('fs'); const path = require('path');
const { Chess } = require('chess.js');
const { EnginePool } = require('../src/engine');
const { stepData } = require('../src/drillstep');
const store = require('../src/store');
const cc = require('../src/chesscom');
const P = require('../src/puzzles');
const C = require('../src/coach');
const { formatLine, THEME_LABEL } = require('../src/themes');
const { LESSONS } = require('../src/lessons');

const user = process.argv[2];
const file = path.join(__dirname, '..', 'drill', 'data.json');

(async () => {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const analyses = store.listAnalyses(user).sort((a, b) => a.game.endTime - b.game.endTime);
  const seen = new Map(); // fen -> candidate (keeps the worst occurrence, counts repeats)
  for (const a of analyses) {
    a.moves.forEach((m, i) => {
      if (!m.mine || m.ply < 3 || m.winLoss < 12 || !m.bestUci) return;
      const ev = m.evalBefore * (m.color === 'w' ? 1 : -1);
      if (ev < -600 || ev > 900) return;
      const k = m.fenBefore.split(' ').slice(0, 4).join(' ');
      const prev = a.moves[i - 1];
      const c = seen.get(k);
      if (c) { c.times++; return; }
      seen.set(k, { a, m, prev, times: 1 });
    });
  }
  const cands = [...seen.values()];
  console.log('real positions:', cands.length);
  const pool = new EnginePool();
  const out = []; let n = 0;
  for (const { a, m, prev, times } of cands) {
    const g = a.game;
    const step = await stepData(pool, m.fenBefore, m.bestUci);
    const theme = (m.lesson && m.lesson.theme) || 'positional';
    const ex = C.templateExplain(m, g);
    const clean = (t) => t.replace(/\*\*/g, '').replace(/\*/g, '');
    const fake = { theme, solution: [m.bestUci] };
    const opening = (g.opening || '').trim();
    out.push({
      id: P.id(m.fenBefore) + 'r', fen: m.fenBefore, side: m.color, theme, themeLabel: THEME_LABEL[theme], themes: [theme],
      difficulty: Math.max(1, Math.min(5, 1 + Math.round(m.winLoss / 20))), origin: 'my-mistake', mine: true, real: true,
      phase: m.ply <= 20 ? 'opening' : 'later', color: a.myColor, ply: m.ply, times,
      ctx: `${a.myColor === 'w' ? 'White' : 'Black'}${opening ? ', ' + opening : ''} (${g.result === 'win' ? 'a win' : g.result === 'loss' ? 'a loss' : 'a draw'}), move ${m.moveNumber}`,
      yourMove: m.san, setup: prev ? { fen: prev.fenBefore, move: prev.uci, san: prev.san } : null,
      solution: [m.bestUci], solutionSan: [m.bestSan], hints: C.hints(fake),
      reveal: { line: formatLine(m.fenBefore, m.bestLine || [m.bestSan]), idea: clean(ex.sections.why), takeaway: (LESSONS[theme] || LESSONS.positional).takeaway },
      steps: [step],
    });
    if (++n % 25 === 0) console.log(n + '/' + cands.length);
  }
  pool.close();
  data.puzzles = data.puzzles.filter((p) => !p.real).concat(out);

  // rating history for the goal bar (chess.com Published-Data API)
  const ratings = {};
  for (const tc of ['rapid', 'blitz']) {
    const games = (await cc.getRecentGames(user, { months: 24, max: 1000, timeClasses: [tc] })).reverse();
    ratings[tc] = games.map((x) => [x.endTime, x.me.rating]);
  }
  data.ratings = ratings; data.goal = { rating: 2000, mode: 'rapid' };
  fs.writeFileSync(file, JSON.stringify(data));
  console.log('merged', out.length, 'real positions;', (JSON.stringify(data).length / 1024 | 0) + ' KB total');
})();
