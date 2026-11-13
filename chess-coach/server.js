'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { EnginePool } = require('./src/engine');
const cc = require('./src/chesscom');
const { analyzeGame } = require('./src/analyze');
const store = require('./src/store');
const coach = require('./src/coach');
const P = require('./src/puzzles');
const { buildProfile } = require('./src/profile');
const library = require('./src/library');
const { LESSONS } = require('./src/lessons');
const { THEME_LABEL } = require('./src/themes');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/chess.js', express.static(path.join(__dirname, 'node_modules/chess.js/dist/esm/chess.js')));

let _pool = null;
const pool = () => (_pool || (_pool = new EnginePool()));

// ---------- background jobs ----------
const jobs = new Map();
function startJob(type, fn) {
  const job = { id: crypto.randomUUID(), type, status: 'running', progress: 0, result: null, error: null, started: Date.now() };
  jobs.set(job.id, job);
  fn((p, extra) => { job.progress = Math.max(job.progress, Math.min(1, p)); if (extra) job.info = extra; })
    .then((r) => { job.result = r; job.status = 'done'; job.progress = 1; })
    .catch((e) => { job.status = 'error'; job.error = e.message; console.error(type, e); });
  return job;
}
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  const status = e.status && e.status >= 400 && e.status < 600 ? (e.status === 404 ? 404 : e.status) : 500;
  res.status(status).json({ error: e.status === 404 ? 'That chess.com user was not found.' : e.message });
});

app.get('/api/config', (req, res) => res.json({ ai: coach.hasClaude(), model: process.env.COACH_MODEL || 'claude-sonnet-5-5', themes: THEME_LABEL, library: P.stats() }));

app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'unknown job' });
  res.json(j);
});

// ---------- chess.com connector ----------
app.get('/api/connect', wrap(async (req, res) => {
  const user = req.query.user;
  const profile = await cc.getProfile(user);
  const games = await cc.getRecentGames(user, { months: +req.query.months || 2, max: +req.query.max || 40 });
  const mark = games.map((g) => {
    const a = store.loadAnalysis(profile.username, g.id);
    return { ...g, pgn: undefined, analyzed: !!a, summary: a && a.summary };
  });
  res.json({ profile, games: mark });
}));

// ---------- game review ----------
async function reviewGame(user, gameId, onProgress) {
  const games = await cc.getRecentGames(user, { months: 6, max: 300 });
  const g = games.find((x) => x.id === gameId);
  if (!g) { const e = new Error('Game not found in your recent chess.com games'); e.status = 404; throw e; }
  const a = await analyzeGame(g, pool(), { depth: 14, onProgress: (p) => onProgress(p * 0.7) });
  // turn your own mistakes into personal puzzles
  const found = await P.mineAnalysis(a, pool(), { user: a.user });
  const added = P.add(found.filter((p) => p.owner));
  a.puzzlesAdded = added;
  store.saveAnalysis(a);
  onProgress(1);
  return a;
}

app.post('/api/analyze', wrap(async (req, res) => {
  const { user, gameId } = req.body;
  const cached = store.loadAnalysis(user, gameId);
  if (cached && !req.body.force) return res.json({ done: true, analysis: cached });
  const job = startJob('analyze', (progress) => reviewGame(user, gameId, progress).then((a) => ({ gameId: a.gameId, user: a.user })));
  res.json({ jobId: job.id });
}));

app.post('/api/review-batch', wrap(async (req, res) => {
  const { user, count = 10 } = req.body;
  const job = startJob('review-batch', async (progress) => {
    const games = (await cc.getRecentGames(user, { months: 3, max: Math.min(+count, 30), timeClasses: req.body.timeClasses })).filter((g) => !store.loadAnalysis(g.me.username, g.id));
    let i = 0;
    for (const g of games) {
      await reviewGame(user, g.id, (p) => progress((i + p) / Math.max(1, games.length)));
      i++;
    }
    return { reviewed: games.length };
  });
  res.json({ jobId: job.id });
}));

app.get('/api/analysis', wrap((req, res) => {
  const a = store.loadAnalysis(req.query.user, req.query.gameId);
  if (!a) return res.status(404).json({ error: 'not analysed yet' });
  res.json(a);
}));

app.post('/api/explain', wrap(async (req, res) => {
  const { user, gameId, ply } = req.body;
  const a = store.loadAnalysis(user, gameId);
  if (!a) return res.status(404).json({ error: 'not analysed yet' });
  const m = a.moves[ply - 1];
  if (!m) return res.status(400).json({ error: 'bad ply' });
  a.explanations = a.explanations || {};
  const cached = a.explanations[ply];
  if (cached && (cached.source === 'claude' || !coach.hasClaude()) && !req.body.refresh) return res.json(cached);
  const ex = await coach.explainMove(m, a.game);
  if (ex.source === 'claude' || !coach.hasClaude()) { a.explanations[ply] = ex; store.saveAnalysis(a); }
  res.json(ex);
}));

app.post('/api/ask', wrap(async (req, res) => res.json(await coach.ask(req.body))));

app.get('/api/profile', wrap((req, res) => {
  const analyses = store.listAnalyses(req.query.user);
  res.json({ ...buildProfile(analyses), progress: store.getProgress(req.query.user) });
}));

// ---------- puzzles ----------
const safeView = (p) => P.publicView(p);
app.get('/api/puzzles', wrap((req, res) => {
  const { user, theme, count = 10, mode } = req.query;
  let themes = theme ? String(theme).split(',') : [];
  if (mode === 'weakness' && user) {
    themes = buildProfile(store.listAnalyses(user)).weaknesses.slice(0, 3).map((w) => w.theme);
  }
  const progress = store.getProgress(user).puzzles;
  const origin = mode === 'mine' ? 'my-mistake' : undefined;
  let list = P.pick({ themes, owner: user && cc.clean(user), count: +count, progress, origin, maxDifficulty: +req.query.maxDifficulty || 5 });
  if (mode === 'mine') list = list.filter((p) => p.owner);
  res.json({ themes, puzzles: list.map(safeView), library: P.stats() });
}));

app.post('/api/puzzles/generate', wrap(async (req, res) => {
  const { user, themes = [], perTheme = 6 } = req.body;
  const job = startJob('library', (progress) => library.build({ user: cc.clean(user), themes, perTheme, pool: pool(), onProgress: progress }));
  res.json({ jobId: job.id });
}));

app.post('/api/puzzle/check', wrap(async (req, res) => {
  const { puzzleId, step, move } = req.body;
  const p = P.get(puzzleId);
  if (!p) return res.status(404).json({ error: 'unknown puzzle' });
  res.json(await P.checkMove(pool(), p, +step, move));
}));
// judge one move against the engine's best move at an arbitrary position (used by "try it yourself" in reviews)
app.post('/api/judge', wrap(async (req, res) => {
  const { fen, best, bestSan, move } = req.body;
  const tmp = { fen, solution: [best], solutionSan: [bestSan] };
  res.json(await P.checkMove(pool(), tmp, 0, move));
}));
app.post('/api/puzzle/hint', wrap((req, res) => {
  const p = P.get(req.body.puzzleId);
  if (!p) return res.status(404).json({ error: 'unknown puzzle' });
  res.json(P.hints(p)[Math.min(2, Math.max(0, +req.body.level || 0))] || {});
}));
app.post('/api/puzzle/reveal', wrap((req, res) => {
  const p = P.get(req.body.puzzleId);
  if (!p) return res.status(404).json({ error: 'unknown puzzle' });
  res.json({ solution: p.solution, solutionSan: p.solutionSan, ...P.describeSolution(p), yourMove: p.yourMove, source: p.source });
}));
app.post('/api/puzzle/result', wrap((req, res) => {
  const p = P.get(req.body.puzzleId);
  if (!p) return res.status(404).json({ error: 'unknown puzzle' });
  const prog = store.recordResult(req.body.user || 'guest', p, req.body);
  res.json({ themes: prog.themes });
}));

// ---------- lessons ----------
app.get('/api/lessons', (req, res) => {
  const by = P.stats().byTheme;
  res.json(Object.entries(LESSONS).map(([theme, l]) => ({ theme, title: l.title, summary: l.summary, puzzles: by[theme] || 0 })));
});
app.get('/api/lessons/:theme', wrap((req, res) => {
  const l = LESSONS[req.params.theme];
  if (!l) return res.status(404).json({ error: 'no such lesson' });
  const examples = P.pick({ themes: [req.params.theme], count: 3, maxDifficulty: 3 }).filter((p) => p.theme === req.params.theme)
    .map((p) => ({ ...safeView(p), solution: p.solution, solutionSan: p.solutionSan, ...P.describeSolution(p) }));
  res.json({ theme: req.params.theme, ...l, examples });
}));

const port = +process.env.PORT || 3000;
if (require.main === module) {
  app.listen(port, () => console.log(`Chess Coach running on http://localhost:${port}  (AI coach: ${coach.hasClaude() ? 'on' : 'off – set ANTHROPIC_API_KEY'})`));
}
module.exports = { app, pool };
