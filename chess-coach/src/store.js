'use strict';
// Tiny JSON-file persistence: saved analyses and training progress.
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const AN = path.join(DATA, 'analyses');
const PROG = path.join(DATA, 'progress.json');
const safe = (s) => String(s).toLowerCase().replace(/[^a-z0-9_-]/g, '');

function saveAnalysis(a) {
  fs.mkdirSync(AN, { recursive: true });
  fs.writeFileSync(path.join(AN, `${safe(a.user)}__${safe(a.gameId)}.json`), JSON.stringify(a));
}
function loadAnalysis(user, gameId) {
  try { return JSON.parse(fs.readFileSync(path.join(AN, `${safe(user)}__${safe(gameId)}.json`), 'utf8')); } catch (e) { return null; }
}
function listAnalyses(user) {
  try {
    return fs.readdirSync(AN).filter((f) => f.startsWith(safe(user) + '__')).map((f) => JSON.parse(fs.readFileSync(path.join(AN, f), 'utf8')));
  } catch (e) { return []; }
}

function readProg() { try { return JSON.parse(fs.readFileSync(PROG, 'utf8')); } catch (e) { return {}; } }
function writeProg(p) { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(PROG, JSON.stringify(p)); }

function getProgress(user) { return readProg()[safe(user)] || { puzzles: {}, themes: {}, days: {} }; }
function recordResult(user, puzzle, { solved, attempts = 1, hintsUsed = 0 }) {
  const all = readProg();
  const u = safe(user);
  const p = all[u] || { puzzles: {}, themes: {}, days: {} };
  const now = Date.now();
  const prev = p.puzzles[puzzle.id] || { tries: 0 };
  p.puzzles[puzzle.id] = { tries: prev.tries + 1, solved: solved || prev.solved, lastResult: solved ? 'solved' : 'failed', last: now, hintsUsed };
  const t = p.themes[puzzle.theme] || { solved: 0, failed: 0, clean: 0 };
  if (solved) { t.solved++; if (attempts === 1 && !hintsUsed) t.clean++; } else t.failed++;
  p.themes[puzzle.theme] = t;
  const day = new Date(now).toISOString().slice(0, 10);
  const d = p.days[day] || { solved: 0, failed: 0 };
  if (solved) d.solved++; else d.failed++;
  p.days[day] = d;
  all[u] = p;
  writeProg(all);
  return p;
}
module.exports = { saveAnalysis, loadAnalysis, listAnalyses, getProgress, recordResult };
