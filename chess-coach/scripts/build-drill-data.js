'use strict';
// Precompute everything the static "drill edition" needs, so it works with no engine and no server:
// for every puzzle step, the engine's verdict on EVERY legal move (accepted / wrong + why + refutation).
// Usage: node scripts/build-drill-data.js <username> [perThemeLimit=26]
const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');
const { EnginePool } = require('../src/engine');
const { stepData } = require('../src/drillstep');
const P = require('../src/puzzles');
const store = require('../src/store');
const { buildProfile } = require('../src/profile');
const { THEME_LABEL } = require('../src/themes');

const user = process.argv[2];
const limit = +process.argv[3] || 26;

(async () => {
  const all = P.all();
  const mine = all.filter((p) => p.owner === user);
  const byTheme = {};
  const chosen = [...mine];
  const ids = new Set(mine.map((p) => p.id));
  const seeds = all.filter((p) => !p.owner && !ids.has(p.id)).sort((a, b) => a.difficulty - b.difficulty || (a.id < b.id ? -1 : 1));
  for (const p of seeds) {
    byTheme[p.theme] = (byTheme[p.theme] || 0) + 1;
    const cap = p.theme === 'positional' ? 14 : p.theme === 'winsMaterial' ? 28 : limit;
    if (byTheme[p.theme] <= cap) chosen.push(p);
  }
  console.log('puzzles to precompute:', chosen.length, `(${mine.length} personal)`);
  const pool = new EnginePool();
  const out = [];
  let n = 0;
  for (const p of chosen) {
    const steps = [];
    for (let i = 0; i < p.solution.length; i += 2) steps.push(await stepData(pool, P.positionAt(p, i).fen(), p.solution[i]));
    const hints = P.hints(p);
    out.push({
      id: p.id, fen: p.fen, side: p.side, theme: p.theme, themeLabel: THEME_LABEL[p.theme], themes: p.themes, difficulty: p.difficulty,
      origin: p.origin, mine: !!p.owner, yourMove: p.yourMove || null, setup: p.setup ? { fen: p.setup.fen, move: p.setup.move, san: p.setup.san } : null,
      solution: p.solution, solutionSan: p.solutionSan, hints, reveal: P.describeSolution(p), steps,
    });
    if (++n % 20 === 0) console.log(n + '/' + chosen.length);
  }
  pool.close();

  // ---- profile + progress numbers from the reviewed games ----
  const analyses = store.listAnalyses(user).filter((a) => ['rapid', 'blitz'].includes(a.game.timeClass)).sort((a, b) => a.game.endTime - b.game.endTime);
  const prof = buildProfile(analyses);
  const stat = (as) => {
    const n = as.length; const mv = as.flatMap((a) => a.moves.filter((m) => m.mine)); const pr = buildProfile(as);
    const r = (c) => +(mv.filter((m) => m.cls === c).length / n).toFixed(2);
    const th = (t) => +(((pr.weaknesses.find((w) => w.theme === t) || { count: 0 }).count) / n).toFixed(2);
    return { games: n, accuracy: pr.avgAccuracy, blunders: r('blunder'), mistakes: r('mistake'), inaccuracies: r('inaccuracy'), hanging: th('hangingPiece'), exchanges: th('winsMaterial'), record: pr.results };
  };
  const cut = Date.parse('2026-11-13T03:00:00Z') / 1000;
  const half = Math.floor(analyses.length / 2);
  const data = {
    user, built: new Date().toISOString().slice(0, 10),
    puzzles: out,
    profile: { games: prof.games, accuracy: prof.avgAccuracy, perGame: prof.perGame, results: prof.results, phases: prof.phases,
      weaknesses: prof.weaknesses.slice(0, 7).map((w) => ({ theme: w.theme, label: w.label, count: w.count, blunders: w.blunders, advice: w.advice, lesson: w.lesson })) },
    speed: require('../src/speed').computeSpeed(analyses),
    progress: { streak: stat(analyses.filter((a) => a.game.endTime >= cut)), before: stat(analyses.filter((a) => a.game.endTime < cut)), older: stat(analyses.slice(0, half)), newer: stat(analyses.slice(half)) },
  };
  fs.writeFileSync(path.join(__dirname, '..', 'drill', 'data.json'), JSON.stringify(data));
  console.log('wrote drill/data.json', (JSON.stringify(data).length / 1024 | 0) + ' KB', out.length, 'puzzles');
})();
