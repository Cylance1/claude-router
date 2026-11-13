'use strict';
// Download chess.com's default piece set (Neo) into data/pieces/neo for embedding in the hosted drill page.
// For your own private use only: these are chess.com's drawings. The files are git-ignored and never committed.
const fs = require('fs'); const path = require('path');
const dir = path.join(__dirname, '..', 'data', 'pieces', 'neo'); fs.mkdirSync(dir, { recursive: true });
(async () => {
  for (const c of ['w', 'b']) for (const t of ['p', 'n', 'b', 'r', 'q', 'k']) {
    const r = await fetch(`https://images.chesscomfiles.com/chess-themes/pieces/neo/300/${c}${t}.png`, { headers: { 'User-Agent': 'ChessCoach/0.1' } });
    if (!r.ok) throw new Error(`${c}${t}: HTTP ${r.status}`);
    fs.writeFileSync(path.join(dir, `${c}${t}.png`), Buffer.from(await r.arrayBuffer()));
  }
  console.log('saved 12 pieces to', dir);
})();
