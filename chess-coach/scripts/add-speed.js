'use strict';
// Add the clock/speed analysis to an existing drill/data.json without recomputing puzzles.
const fs = require('fs'); const path = require('path');
const store = require('../src/store'); const { computeSpeed } = require('../src/speed');
const f = path.join(__dirname, '..', 'drill', 'data.json');
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
d.speed = computeSpeed(store.listAnalyses(d.user).filter((a) => ['rapid', 'blitz'].includes(a.game.timeClass)));
fs.writeFileSync(f, JSON.stringify(d)); console.log(JSON.stringify(d.speed));
