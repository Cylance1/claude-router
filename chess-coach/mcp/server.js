#!/usr/bin/env node
'use strict';
// MCP (Model Context Protocol) connector: lets Claude Desktop / Claude Code read your chess.com games
// and review them with the Stockfish-backed coach engine in this repo.
//
//   claude mcp add chess-coach -- node /path/to/chess-coach/mcp/server.js
//
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const cc = require('../src/chesscom');
const { EnginePool } = require('../src/engine');
const { analyzeGame } = require('../src/analyze');
const { templateExplain } = require('../src/coach');
const { buildProfile } = require('../src/profile');
const store = require('../src/store');
const P = require('../src/puzzles');
const { formatLine } = require('../src/themes');

let _pool; const pool = () => (_pool || (_pool = new EnginePool(2)));
const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] });
const server = new McpServer({ name: 'chess-coach', version: '0.1.0' });

server.registerTool('list_games', {
  description: 'List a chess.com player\'s most recent standard-chess games (newest first) with ids, opponent, result and opening.',
  inputSchema: { username: z.string(), max: z.number().int().min(1).max(50).default(15) },
}, async ({ username, max }) => {
  const games = await cc.getRecentGames(username, { months: 2, max });
  return text(games.map((g) => ({ id: g.id, url: g.url, date: new Date(g.endTime * 1000).toISOString().slice(0, 10), color: g.myColor === 'w' ? 'white' : 'black', opponent: `${g.opponent.username} (${g.opponent.rating})`, result: g.result, how: g.how, timeClass: g.timeClass, opening: g.opening, accuracy: g.accuracy })));
});

server.registerTool('review_game', {
  description: 'Run Stockfish over every move of one of the player\'s games and return their mistakes: for each, the move played, why it was wrong (the tactic allowed or missed), the better line, and the lesson theme. Takes ~10-30 s.',
  inputSchema: { username: z.string(), game_id: z.string().describe('id from list_games'), include_inaccuracies: z.boolean().default(false) },
}, async ({ username, game_id, include_inaccuracies }) => {
  let a = store.loadAnalysis(username, game_id);
  if (!a) {
    const games = await cc.getRecentGames(username, { months: 6, max: 300 });
    const g = games.find((x) => x.id === game_id);
    if (!g) return text('Game not found among the recent games.');
    a = await analyzeGame(g, pool(), { depth: 14 });
    const found = await P.mineAnalysis(a, pool(), { user: a.user });
    P.add(found.filter((p) => p.owner));
    store.saveAnalysis(a);
  }
  const bad = a.moves.filter((m) => m.mine && (['mistake', 'blunder'].includes(m.cls) || (include_inaccuracies && m.cls === 'inaccuracy')));
  return text({
    summary: a.summary, color: a.myColor === 'w' ? 'white' : 'black',
    mistakes: bad.map((m) => {
      const ex = templateExplain(m, a.game);
      return {
        move: `${m.moveNumber}${m.color === 'w' ? '.' : '...'} ${m.san}`, classification: m.cls, winningChancesLostPercent: Math.round(m.winLoss), fenBeforeMove: m.fenBefore,
        theme: m.lesson && m.lesson.label, whatWentWrong: ex.sections.why, betterMove: m.bestSan, betterLine: formatLine(m.fenBefore, m.bestLine), opponentReplyToYourMove: formatLine(m.fenAfter, (m.refutationLine || []).slice(0, 4)),
      };
    }),
  });
});

server.registerTool('weakness_profile', {
  description: 'Summarise recurring weaknesses (hanging pieces, forks, back-rank mates...) across all games that have been reviewed for this player.',
  inputSchema: { username: z.string() },
}, async ({ username }) => text(buildProfile(store.listAnalyses(username))));

server.registerTool('get_puzzles', {
  description: 'Get training puzzles (FEN + side to move, solutions withheld unless reveal=true) for a theme or from the player\'s own mistakes.',
  inputSchema: { username: z.string().optional(), theme: z.string().optional().describe('fork, pin, skewer, hangingPiece, mate, backRankMate, discoveredAttack, sacrifice, ...'), count: z.number().int().min(1).max(20).default(5), reveal: z.boolean().default(false) },
}, async ({ username, theme, count, reveal }) => {
  const list = P.pick({ themes: theme ? [theme] : [], owner: username && cc.clean(username), count });
  return text(list.map((p) => ({ id: p.id, fen: p.fen, sideToMove: p.side === 'w' ? 'white' : 'black', theme: p.theme, difficulty: p.difficulty, ...(reveal ? { solution: p.solutionSan.join(' ') } : {}) })));
});

(async () => { await server.connect(new StdioServerTransport()); })();
