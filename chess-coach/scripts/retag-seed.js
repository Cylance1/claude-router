'use strict';
// Re-run the theme detector over the seed library (after changing src/themes.js).
const fs = require('fs'); const path = require('path');
const { analyzeLine, pvToSan } = require('../src/themes');
const f = path.join(__dirname, '..', 'data', 'seed-puzzles.json');
const puzzles = JSON.parse(fs.readFileSync(f, 'utf8'));
for (const p of puzzles) {
  const r = analyzeLine(p.fen, p.solution, p.mateIn || 0);
  Object.assign(p, { theme: r.primary, themes: r.themes, detail: r.detail, mateIn: r.mateIn, gain: r.gain, solutionSan: pvToSan(p.fen, p.solution) });
}
fs.writeFileSync(f, JSON.stringify(puzzles));
const c = {}; puzzles.forEach((p) => { c[p.theme] = (c[p.theme] || 0) + 1; });
console.log(puzzles.length, c);
