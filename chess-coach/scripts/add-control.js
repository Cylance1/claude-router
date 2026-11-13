'use strict';
// Add "squares White controls" (c) and "squares Black controls" (cb) bitmasks to the scan positions in drill/data.json.
// Cheap: no engine involved.
const fs = require('fs'); const path = require('path');
const { Chess } = require('chess.js');
const { makeControl } = require('../public/js/control.js');
const C = makeControl(Chess);
const file = path.join(__dirname, '..', 'drill', 'data.json');
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
let n = 0;
for (const x of d.scan) {
  try { const fen = `${x.f} - - 0 1`; x.c = C.mask(fen, 'w'); x.cb = C.mask(fen, 'b'); n++; } catch (e) { delete x.c; delete x.cb; }
}
fs.writeFileSync(file, JSON.stringify(d));
const stat = (key, color) => { const v = d.scan.filter((x) => x[key]).map((x) => C.count(x[key], 'both', color)).sort((a, b) => a - b); return `min ${v[0]}, median ${v[v.length >> 1]}, max ${v[v.length - 1]}`; };
console.log('masks added:', n, '| White-controlled squares per position:', stat('c', 'w'), '| Black:', stat('cb', 'b'));
