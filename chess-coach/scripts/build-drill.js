'use strict';
// Assemble drill/index.html: one self-contained page (code + data inlined) for static hosting.
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const strip = (s) => s.replace(/^import .*$/gm, '').replace(/^export \{[^}]*\};?$/gm, '').replace(/^export (class|function|const) /gm, '$1 ').replace(/\/\/# sourceMappingURL=.*$/m, '');
const chess = strip(rd('node_modules/chess.js/dist/esm/chess.js'));
const code = `const { Chess } = (() => {\n${chess}\nreturn { Chess };\n})();\n${strip(rd('public/js/pieces.js'))}\n${strip(rd('public/js/board.js'))}\n${rd('public/js/loose.js')}\n${rd('public/js/control.js')}\n${rd('drill/drill.js')}`;
const data = JSON.stringify(JSON.parse(rd('drill/data.json'))).replace(/</g, '\\u003c');
let pieces = '';
const pdir = path.join(root, 'data', 'pieces', 'neo');
if (fs.existsSync(pdir)) {
  const map = {};
  for (const c of ['w', 'b']) for (const t of ['p', 'n', 'b', 'r', 'q', 'k']) { const f = path.join(pdir, c + t + '.png'); if (fs.existsSync(f)) map[c + t] = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'); }
  if (Object.keys(map).length === 12) pieces = `<script>window.PIECE_IMGS_NEO = ${JSON.stringify(map)};</script>\n`;
}
const html = `<title>Chess Coach Drills</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap">
<style>
${rd('drill/drill.css')}
</style>
<div class="wrap">
  <header class="top"><div class="brand">Chess Coach <small>drills</small></div>
    <div class="row"><button id="pset" class="ghost small" title="Switch piece style"></button><nav><button data-tab="drill" class="on">Drill</button><button data-tab="weak">Weak spots</button><button data-tab="progress">Progress</button></nav></div></header>
  <main id="view"></main>
</div>
${pieces}<script type="application/json" id="data">${data}</script>
<script type="module">
${code}
</script>
`;
fs.writeFileSync(path.join(root, 'drill', 'index.html'), html);
console.log('drill/index.html', (html.length / 1024 | 0) + ' KB');
