'use strict';
// Grow the puzzle library on demand from real games of players around the student's level.
const cc = require('./chesscom');
const P = require('./puzzles');

const FALLBACK_PLAYERS = ['bananaboli', 'achillnoob', 'alxtakes', 'antrixian', 'bobsoapwins', 'blitz2300', 'adenny5702', 'basarabiaq', 'atlas01382', 'amrathechicken', 'awesomeatti', 'biitzel'];

async function build({ user, themes = [], perTheme = 6, pool, onProgress, maxGames = 40 }) {
  let opponents = [];
  try {
    const mine = await cc.getRecentGames(user, { months: 2, max: 60 });
    opponents = [...new Set(mine.map((g) => cc.clean(g.opponent.username)))];
  } catch (e) { /* use fallback only */ }
  const players = [...opponents.slice(0, 20), ...FALLBACK_PLAYERS];
  const countFor = () => {
    const c = {};
    for (const p of P.all()) if (!p.owner || p.owner === user) for (const t of p.themes) c[t] = (c[t] || 0) + 1;
    return c;
  };
  const need = () => { const c = countFor(); return themes.filter((t) => (c[t] || 0) < perTheme); };
  let added = 0; let gamesDone = 0;
  for (const player of players) {
    if (themes.length && !need().length) break;
    if (gamesDone >= maxGames) break;
    try {
      const games = await cc.getRecentGames(player, { months: 1, max: 6, timeClasses: ['rapid', 'blitz', 'daily'] });
      const found = await P.mineGames(games, pool, { user: undefined });
      for (const f of found) f.owner = null;
      added += P.add(found);
      gamesDone += games.length;
    } catch (e) { /* skip player */ }
    if (onProgress) onProgress(Math.min(0.99, gamesDone / maxGames), { added, gamesDone });
  }
  return { added, gamesDone, library: P.stats() };
}
module.exports = { build };
