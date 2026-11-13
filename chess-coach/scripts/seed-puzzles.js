'use strict';
// Build data/seed-puzzles.json: a starter puzzle library mined from real games of club-level players.
// Usage: node scripts/seed-puzzles.js [targetPerTheme=14] [maxPlayers=60]
const fs = require('fs');
const path = require('path');
const { EnginePool } = require('../src/engine');
const cc = require('../src/chesscom');
const P = require('../src/puzzles');

const OUT = path.join(__dirname, '..', 'data', 'seed-puzzles.json');
const target = +process.argv[2] || 14;
const maxPlayers = +process.argv[3] || 60;
const THEMES = ['hangingPiece', 'fork', 'pin', 'skewer', 'discoveredAttack', 'mate', 'backRankMate', 'sacrifice', 'winsMaterial', 'promotion', 'endgame', 'positional'];

(async () => {
  const res = await fetch('https://api.chess.com/pub/club/chess-com-developer-community/members', { headers: { 'User-Agent': 'ChessCoach/0.1' } });
  const j = await res.json();
  const names = [...new Set([...(j.weekly || []), ...(j.monthly || []), ...(j.all_time || [])].map((x) => x.username))];
  // deterministic pseudo-random sample
  let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const players = []; while (players.length < maxPlayers * 3) players.push(names[Math.floor(rnd() * names.length)]);
  const pool = new EnginePool();
  const have = {}; const out = new Map();
  try { for (const p of JSON.parse(fs.readFileSync(OUT, 'utf8'))) { out.set(p.id, p); for (const t of p.themes) have[t] = (have[t] || 0) + 1; } } catch (e) { /* fresh */ }
  let tried = 0;
  for (const pl of players) {
    if (tried >= maxPlayers) break;
    const lacking = THEMES.filter((t) => (have[t] || 0) < target);
    if (!lacking.length) break;
    try {
      const games = await cc.getRecentGames(pl, { months: 1, max: 5, timeClasses: ['rapid', 'blitz', 'daily'] });
      if (!games.length) continue;
      tried++;
      const found = await P.mineGames(games, pool, {});
      for (const f of found) {
        f.owner = null; f.yourMove = null; f.source = { ...f.source, white: undefined, black: undefined, game: f.source.game };
        if (out.has(f.id)) continue;
        // keep the library balanced: don't over-collect common themes
        if ((have[f.theme] || 0) >= target * 2 && f.theme !== 'positional') continue;
        out.set(f.id, f); for (const t of f.themes) have[t] = (have[t] || 0) + 1;
      }
      fs.writeFileSync(OUT, JSON.stringify([...out.values()]));
      console.log(`[${tried}/${maxPlayers}] ${pl}: ${found.length} found, library=${out.size}`, JSON.stringify(have));
    } catch (e) { /* skip */ }
  }
  pool.close();
  console.log('done', out.size);
})();
