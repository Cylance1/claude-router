'use strict';
// chess.com connector — uses the free Published-Data API (https://www.chess.com/news/view/published-data-api).
// No login or token is needed: only the public username.
const fs = require('fs');
const path = require('path');

const BASE = 'https://api.chess.com/pub';
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
const UA = 'ChessCoach/0.1 (open-source chess training app)';

class ChessComError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

async function getJson(url, { ttlMs = 0 } = {}) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, Buffer.from(url).toString('base64url').slice(-120) + '.json');
  try {
    const st = fs.statSync(file);
    if (ttlMs === Infinity || Date.now() - st.mtimeMs < ttlMs) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { /* no cache */ }
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 404) throw new ChessComError('Not found on chess.com', 404);
    if (res.status === 429 || res.status >= 500) { lastErr = new ChessComError(`chess.com returned ${res.status}`, res.status); await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); continue; }
    if (!res.ok) throw new ChessComError(`chess.com returned ${res.status}`, res.status);
    const j = await res.json();
    fs.writeFileSync(file, JSON.stringify(j));
    return j;
  }
  throw lastErr;
}

const clean = (u) => String(u || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');

async function getProfile(username) {
  const u = clean(username);
  if (!u) throw new ChessComError('Enter a chess.com username', 400);
  const [profile, stats] = await Promise.all([
    getJson(`${BASE}/player/${u}`, { ttlMs: 3600e3 }),
    getJson(`${BASE}/player/${u}/stats`, { ttlMs: 3600e3 }).catch(() => ({})),
  ]);
  const ratings = {};
  for (const k of ['chess_rapid', 'chess_blitz', 'chess_bullet', 'chess_daily']) {
    if (stats[k] && stats[k].last) ratings[k.replace('chess_', '')] = stats[k].last.rating;
  }
  return { username: profile.username, avatar: profile.avatar, name: profile.name, country: profile.country, url: profile.url, ratings };
}

function normalize(g, user) {
  const me = clean(user);
  const w = g.white; const b = g.black;
  const myColor = clean(w.username) === me ? 'w' : 'b';
  const mine = myColor === 'w' ? w : b;
  const theirs = myColor === 'w' ? b : w;
  const draws = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];
  const result = mine.result === 'win' ? 'win' : draws.includes(mine.result) ? 'draw' : 'loss';
  const id = g.uuid || (g.url || '').split('/').pop();
  const opening = ((g.pgn.match(/\[ECOUrl "[^"]*\/openings\/([^"]+)"/) || [])[1] || '').replace(/-/g, ' ');
  return {
    id, url: g.url, pgn: g.pgn, endTime: g.end_time, timeClass: g.time_class, timeControl: g.time_control, rated: g.rated,
    myColor, result, how: mine.result === 'win' ? theirs.result : mine.result,
    me: { username: mine.username, rating: mine.rating }, opponent: { username: theirs.username, rating: theirs.rating },
    white: { username: w.username, rating: w.rating }, black: { username: b.username, rating: b.rating },
    accuracy: g.accuracies ? g.accuracies[myColor === 'w' ? 'white' : 'black'] : null,
    opening: opening.replace(/\s\d.*$/, '').replace(/\s(with|and|vs|accepted|declined)$/i, '').slice(0, 60),
  };
}

/** Most recent standard-chess games (newest first). */
async function getRecentGames(username, { months = 2, max = 40, timeClasses } = {}) {
  const u = clean(username);
  if (!u) throw new ChessComError('Enter a chess.com username', 400);
  const { archives } = await getJson(`${BASE}/player/${u}/games/archives`, { ttlMs: 600e3 });
  const out = [];
  const latest = archives.slice(-months).reverse();
  for (let i = 0; i < latest.length && out.length < max; i++) {
    const isCurrent = i === 0;
    const month = await getJson(latest[i], { ttlMs: isCurrent ? 300e3 : Infinity });
    const games = (month.games || []).filter((g) => g.rules === 'chess' && g.pgn && (!timeClasses || timeClasses.includes(g.time_class)));
    games.sort((a, b) => b.end_time - a.end_time);
    for (const g of games) { if (out.length >= max) break; out.push(normalize(g, u)); }
  }
  return out;
}

module.exports = { getProfile, getRecentGames, ChessComError, clean };
