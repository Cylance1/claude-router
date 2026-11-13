'use strict';
// Move-by-move game review: engine eval for every position, classification of each move,
// the better line, the refutation, and the tactical theme behind each mistake.
const { Chess } = require('chess.js');
const { lineCp, winPct } = require('./engine');
const { analyzeLine, pvToSan, uciToSan, THEME_LABEL } = require('./themes');

const CLASS_LABEL = { best: 'Best', excellent: 'Excellent', good: 'Good', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder' };

function classify(loss, isBest) {
  if (isBest || loss < 1) return 'best';
  if (loss < 4) return 'excellent';
  if (loss < 8) return 'good';
  if (loss < 15) return 'inaccuracy';
  if (loss < 28) return 'mistake';
  return 'blunder';
}

function replay(pgn) {
  const c = new Chess();
  c.loadPgn(pgn);
  const hist = c.history({ verbose: true });
  const start = new Chess();
  const positions = [start.fen()];
  if (hist.length && hist[0].before) positions[0] = hist[0].before;
  for (const m of hist) positions.push(m.after);
  return { hist, positions, over: c.isGameOver(), checkmate: c.isCheckmate() };
}

/**
 * @param pool EnginePool
 * @returns analysis object (JSON-serialisable)
 */
async function analyzeGame(game, pool, { depth = 14, onProgress } = {}) {
  const { hist, positions, checkmate } = replay(game.pgn);
  let done = 0;
  const evals = await Promise.all(positions.map(async (fen, i) => {
    if (i === positions.length - 1 && checkmate) {
      // side to move is mated: score is lost for them
      return { lines: [{ multipv: 1, mate: 0, cp: undefined, pv: [] }], best: null, terminal: 'mate' };
    }
    const r = await pool.analyze(fen, { depth });
    if (!r.best) r.terminal = 'draw';
    done++;
    if (onProgress) onProgress(done / positions.length);
    return r;
  }));

  // convert each to White's point of view
  const whiteCp = evals.map((r, i) => {
    const stm = new Chess(positions[i]).turn();
    if (r.terminal === 'mate') return stm === 'w' ? -10000 : 10000;
    if (r.terminal === 'draw') return 0;
    return (stm === 'w' ? 1 : -1) * lineCp(r.lines[0]);
  });

  const moves = hist.map((m, i) => {
    const mover = m.color;
    const sign = mover === 'w' ? 1 : -1;
    const before = whiteCp[i];
    const after = whiteCp[i + 1];
    const loss = Math.max(0, winPct(sign * before) - winPct(sign * after));
    const top = evals[i].lines[0];
    const best = evals[i].best;
    const playedUci = m.from + m.to + (m.promotion || '');
    const cls = classify(loss, best === playedUci);
    const rec = {
      ply: i + 1, moveNumber: Math.floor(i / 2) + 1, color: mover, san: m.san, uci: playedUci,
      fenBefore: positions[i], fenAfter: positions[i + 1],
      evalBefore: before, evalAfter: after, winLoss: +loss.toFixed(1), cls,
      mine: mover === game.myColor,
      bestUci: best, bestSan: best ? uciToSan(positions[i], best) : null,
    };
    if (cls === 'inaccuracy' || cls === 'mistake' || cls === 'blunder') {
      const bestPv = top.pv;
      rec.bestLine = pvToSan(positions[i], bestPv, 8);
      const refPv = (evals[i + 1].lines[0] || {}).pv || [];
      rec.refutationLine = pvToSan(positions[i + 1], refPv, 6);
      const refRes = refPv.length ? analyzeLine(positions[i + 1], refPv.slice(0, 5), evals[i + 1].lines[0].mate) : null;
      const missRes = bestPv.length ? analyzeLine(positions[i], bestPv.slice(0, 5), top.mate) : null;
      rec.missed = missRes ? { themes: missRes.themes, primary: missRes.primary, detail: missRes.detail, gain: missRes.gain } : null;
      rec.allowed = refRes ? { themes: refRes.themes, primary: refRes.primary, detail: refRes.detail, gain: refRes.gain } : null;
      // which lesson is this? If the opponent punishes us with a real tactic, we "allowed" it;
      // otherwise we "missed" something better.
      const tactical = (r) => r && r.primary !== 'positional' && r.primary !== 'endgame';
      const allowedTactic = tactical(rec.allowed) && rec.allowed.gain >= 2 || (rec.allowed && rec.allowed.themes.includes('mate'));
      if (allowedTactic && (rec.allowed.gain >= 2 || rec.allowed.themes.includes('mate'))) rec.lesson = { kind: 'allowed', theme: rec.allowed.primary };
      else if (tactical(rec.missed)) rec.lesson = { kind: 'missed', theme: rec.missed.primary };
      else rec.lesson = { kind: 'positional', theme: rec.missed && rec.missed.primary === 'endgame' ? 'endgame' : 'positional' };
      rec.lesson.label = THEME_LABEL[rec.lesson.theme];
    }
    return rec;
  });

  const mine = moves.filter((m) => m.mine);
  const count = (c) => mine.filter((m) => m.cls === c).length;
  const avgLoss = mine.length ? mine.reduce((s, m) => s + m.winLoss, 0) / mine.length : 0;
  const out = {
    gameId: game.id, user: game.me.username, myColor: game.myColor, analyzedAt: Date.now(), depth,
    game: { ...game, pgn: undefined },
    pgn: game.pgn,
    startFen: positions[0],
    evalCurve: whiteCp.map((c) => Math.max(-1000, Math.min(1000, c))),
    summary: {
      moves: mine.length, blunders: count('blunder'), mistakes: count('mistake'), inaccuracies: count('inaccuracy'),
      accuracy: +(Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * avgLoss) - 3.1669))).toFixed(1),
    },
    moves,
  };
  Object.defineProperty(out, '_raw', { value: { evals, positions, whiteCp }, enumerable: false, writable: true });
  return out;
}

module.exports = { analyzeGame, replay, classify, CLASS_LABEL };
