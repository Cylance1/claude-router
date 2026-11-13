'use strict';
// Add "squares White controls" bitmasks to the scan positions in drill/data.json (cheap: no engine involved).
const fs = require('fs'); const path = require('path');
const { Chess } = require('chess.js');
const { makeControl } = require('../public/js/control.js');
const C = makeControl(Chess);
const file = path.join(__dirname, '..', 'drill', 'data.json');
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
let n = 0;
for (const x of d.scan) { try { x.c = C.mask(`${x.f} - - 0 1`, 'w'); n++; } catch (e) { delete x.c; } }
fs.writeFileSync(file, JSON.stringify(d));
const counts = d.scan.filter((x) => x.c).map((x) => C.count(x.c, 'both'));
console.log('masks added:', n, '| white-controlled squares per position: min', Math.min(...counts), 'median', counts.sort((a, b) => a - b)[counts.length >> 1], 'max', Math.max(...counts));
