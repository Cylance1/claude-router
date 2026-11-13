'use strict';
// Aggregate every reviewed game into a weakness profile: which ideas keep costing you games?
const { THEME_LABEL } = require('./themes');
const { LESSONS } = require('./lessons');

function adviceFor(t) {
  const { allowed, missed, positional } = t.kinds;
  if (positional >= allowed && positional >= missed) return 'No single tactic here — these were simply less accurate moves. Slow down: compare two or three candidate moves before you play.';
  if (allowed >= missed) return 'You tend to ALLOW this — before each move, check what it leaves open.';
  return 'You tend to MISS this — look for it (for both sides) before each move.';
}
const WEIGHT = { inaccuracy: 1, mistake: 2.5, blunder: 4 };

function buildProfile(analyses) {
  const themes = {}; const phases = { opening: [], middlegame: [], endgame: [] };
  let games = 0; let moves = 0; let blunders = 0; let mistakes = 0; let inaccuracies = 0; let accSum = 0;
  const results = { win: 0, loss: 0, draw: 0 };
  for (const a of analyses) {
    games++; accSum += a.summary.accuracy;
    if (a.game && a.game.result) results[a.game.result]++;
    for (const m of a.moves) {
      if (!m.mine) continue;
      moves++;
      const ph = m.ply <= 20 ? 'opening' : (m.fenBefore.split(' ')[0].replace(/[^a-zA-Z]/g, '').replace(/[pPkK]/g, '').length <= 8 ? 'endgame' : 'middlegame');
      phases[ph].push(m.winLoss);
      if (m.cls === 'blunder') blunders++; else if (m.cls === 'mistake') mistakes++; else if (m.cls === 'inaccuracy') inaccuracies++;
      if (!m.lesson || !WEIGHT[m.cls]) continue;
      const key = m.lesson.theme;
      const t = themes[key] || { theme: key, label: THEME_LABEL[key], count: 0, score: 0, blunders: 0, kinds: { allowed: 0, missed: 0, positional: 0 }, examples: [] };
      t.count++; t.score += WEIGHT[m.cls]; if (m.cls === 'blunder') t.blunders++;
      t.kinds[m.lesson.kind]++;
      if (t.examples.length < 4) t.examples.push({ gameId: a.gameId, ply: m.ply, san: m.san, cls: m.cls });
      themes[key] = t;
    }
  }
  const weaknesses = Object.values(themes).sort((x, y) => y.score - x.score).map((t) => ({
    ...t, lesson: LESSONS[t.theme] && LESSONS[t.theme].takeaway,
    advice: adviceFor(t),
  }));
  const avg = (xs) => (xs.length ? +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1) : null);
  return {
    games, moves, results, blunders, mistakes, inaccuracies, avgAccuracy: games ? +(accSum / games).toFixed(1) : null,
    perGame: games ? { blunders: +(blunders / games).toFixed(2), mistakes: +(mistakes / games).toFixed(2) } : null,
    phases: { opening: avg(phases.opening), middlegame: avg(phases.middlegame), endgame: avg(phases.endgame) }, // avg win% lost per move
    weaknesses,
  };
}
module.exports = { buildProfile };
