'use strict';
// Heuristic tactic detection on engine lines. Given a position and the engine's best line for the
// side to move, name the idea ("fork", "pin", "back-rank mate"...) so we can teach it and group puzzles.
const { Chess } = require('chess.js');

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const FILES = 'abcdefgh';
const other = (c) => (c === 'w' ? 'b' : 'w');

// priority: the first theme present becomes the "primary" one
const THEME_ORDER = ['backRankMate', 'mate', 'hangingPiece', 'fork', 'pin', 'skewer', 'discoveredAttack', 'sacrifice',
  'promotion', 'winsMaterial', 'endgame', 'positional'];

function pieces(chess) {
  const out = [];
  for (const row of chess.board()) for (const p of row) if (p) out.push(p);
  return out;
}
function material(chess, color) {
  return pieces(chess).filter((p) => p.color === color && p.type !== 'k').reduce((s, p) => s + VAL[p.type], 0);
}
function phase(chess) {
  const nonPawn = pieces(chess).filter((p) => p.type !== 'k' && p.type !== 'p').reduce((s, p) => s + VAL[p.type], 0);
  return nonPawn <= 14 ? 'endgame' : 'middlegame';
}
function xy(sq) { return [FILES.indexOf(sq[0]), +sq[1] - 1]; }
function sq(x, y) { return x < 0 || x > 7 || y < 0 || y > 7 ? null : FILES[x] + (y + 1); }
const DIRS = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
DIRS.q = [...DIRS.b, ...DIRS.r];

/** All pin / skewer relations created by sliders of `color` in the given position. */
function lines(chess, color) {
  const res = [];
  for (const row of chess.board()) for (const p of row) {
    if (!p || p.color !== color || !DIRS[p.type] || p.type === 'k' || p.type === 'p' || p.type === 'n') continue;
    for (const [dx, dy] of DIRS[p.type]) {
      let [x, y] = xy(p.square);
      let first = null; let second = null;
      for (;;) {
        x += dx; y += dy;
        const s = sq(x, y); if (!s) break;
        const t = chess.get(s);
        if (!t) continue;
        if (!first) { if (t.color === color) break; first = { ...t, square: s }; continue; }
        if (t.color !== color) second = { ...t, square: s };
        break;
      }
      if (first && second) {
        if (second.type === 'k' && first.type !== 'k') res.push({ kind: 'pin', slider: p, front: first, back: second });
        else if (first.type === 'k') res.push({ kind: 'skewer', slider: p, front: first, back: second });
        else if (first.type !== 'p' && VAL[second.type] >= VAL[first.type] + 2) res.push({ kind: 'pin', slider: p, front: first, back: second });
        else if (VAL[first.type] >= 5 && VAL[second.type] >= 3 && VAL[first.type] > VAL[second.type]) res.push({ kind: 'skewer', slider: p, front: first, back: second });
      }
    }
  }
  return res;
}
const lineKey = (l) => `${l.kind}${l.slider.square}${l.front.square}${l.back.square}`;

function attackedTargets(chess, from, color) {
  const them = other(color);
  return pieces(chess).filter((p) => p.color === them && chess.attackers(p.square, color).includes(from));
}

/**
 * Walk `pv` (UCI moves) from `fen`; our moves are the even indices. Returns
 * { themes: [...], primary, detail, mateIn, material, phase }.
 */
function analyzeLine(fen, pv, mateScore) {
  const chess = new Chess(fen);
  const us = chess.turn();
  const them = other(us);
  const startPhase = phase(chess);
  const startDiff = material(chess, us) - material(chess, them);
  const themes = new Set();
  const detail = {};
  let minDiff = startDiff;
  let played = 0;
  let last = null;

  const cand = { fork: null, pin: null, skewer: null, discovered: null }; // patterns created by the FIRST move
  const laterCaptures = []; // our captures after the first move: [{sq, type}]
  for (let i = 0; i < pv.length; i++) {
    const uci = pv[i];
    const before = new Chess(chess.fen());
    let mv;
    try { mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch (e) { break; }
    played++;
    last = mv;
    const diff = material(chess, us) - material(chess, them);
    if (i % 2 === 1) minDiff = Math.min(minDiff, diff);
    if (i % 2 === 1) continue; // detectors run on our moves only

    if (mv.promotion) { themes.add('promotion'); detail.promotion = detail.promotion || { piece: NAMES[mv.promotion] }; }
    if (i > 0) { if (mv.captured) laterCaptures.push({ sq: mv.to, type: mv.captured }); continue; }

    // ---- first move only: what idea does it create? ----
    if (mv.captured && VAL[mv.captured] >= 3) {
      const defended = before.attackers(mv.to, them).length > 0;
      if (!defended) { themes.add('hangingPiece'); detail.hangingPiece = { piece: NAMES[mv.captured], square: mv.to, by: NAMES[mv.piece] }; }
    }
    // fork: the moved piece attacks 2+ valuable or undefended things
    if (!chess.isCheckmate() && mv.piece !== 'k') {
      const targets = attackedTargets(chess, mv.to, us).filter((t) =>
        t.type === 'k' || VAL[t.type] > VAL[mv.piece] || chess.attackers(t.square, them).filter((a) => a !== t.square).length === 0);
      const real = targets.filter((t) => VAL[t.type] >= 3 || t.type === 'k');
      if (real.length >= 2) cand.fork = { piece: NAMES[mv.piece], square: mv.to, targets: real.map((t) => `${NAMES[t.type]} on ${t.square}`), squares: real.map((t) => t.square) };
    }
    // new pins / skewers
    const had = new Set(lines(before, us).map(lineKey));
    for (const l of lines(chess, us)) {
      if (had.has(lineKey(l))) continue;
      if (l.kind === 'pin') cand.pin = cand.pin || { slider: NAMES[l.slider.type], pinned: `${NAMES[l.front.type]} on ${l.front.square}`, behind: `${NAMES[l.back.type]} on ${l.back.square}`, squares: [l.front.square] };
      else cand.skewer = cand.skewer || { slider: NAMES[l.slider.type], front: `${NAMES[l.front.type]} on ${l.front.square}`, behind: `${NAMES[l.back.type]} on ${l.back.square}`, squares: [l.back.square] };
    }
    // discovered attack: another slider of ours now attacks something valuable it did not attack before
    if (mv.piece !== 'k') {
      for (const p of pieces(chess)) {
        if (p.color !== us || p.square === mv.to || !DIRS[p.type] || p.type === 'k' || p.type === 'p') continue;
        for (const t of pieces(chess)) {
          if (t.color !== them || (VAL[t.type] < 3 && t.type !== 'k')) continue;
          if (chess.attackers(t.square, us).includes(p.square) && !before.attackers(t.square, us).includes(p.square)) {
            cand.discovered = cand.discovered || { slider: NAMES[p.type], target: `${NAMES[t.type]} on ${t.square}`, mover: NAMES[mv.piece], squares: [t.square] };
          }
        }
      }
    }
  }
  // A pattern only counts as the idea if it pays off: the victim is captured later in the line.
  const captured = (sqs) => laterCaptures.some((c) => sqs.includes(c.sq));
  const gainSoFar = material(chess, us) - material(chess, them) - startDiff;
  if (cand.pin && captured(cand.pin.squares)) { themes.add('pin'); detail.pin = cand.pin; }
  if (cand.skewer && captured(cand.skewer.squares)) { themes.add('skewer'); detail.skewer = cand.skewer; }
  if (cand.discovered && (captured(cand.discovered.squares) || gainSoFar >= 3)) { themes.add('discoveredAttack'); detail.discoveredAttack = cand.discovered; }
  if (cand.fork && (laterCaptures.some((c) => VAL[c.type] >= 3) || gainSoFar >= 3)) { themes.add('fork'); detail.fork = cand.fork; }

  const finalDiff = material(chess, us) - material(chess, them);
  const mated = chess.isCheckmate();
  const endsOurs = played % 2 === 1;
  const mateIn = mated && endsOurs ? Math.ceil(played / 2) : (mateScore > 0 ? mateScore : 0);
  if (mated && endsOurs) {
    themes.add('mate');
    detail.mate = { in: mateIn, move: last && last.san };
    const kingSq = pieces(chess).find((p) => p.color === them && p.type === 'k').square;
    if ((kingSq[1] === '1' || kingSq[1] === '8') && last && (last.piece === 'r' || last.piece === 'q') && last.to[1] === kingSq[1]) {
      themes.add('backRankMate');
    }
  } else if (mateScore > 0) {
    themes.add('mate'); detail.mate = { in: mateScore };
  }
  if (minDiff <= startDiff - 2 && (finalDiff >= startDiff - 1 || mated) && played >= 3) {
    themes.add('sacrifice'); detail.sacrifice = { gave: startDiff - minDiff };
  }
  if (finalDiff - startDiff >= 2) { themes.add('winsMaterial'); detail.winsMaterial = { gain: finalDiff - startDiff }; }
  // a pin / fork / skewer / discovery only counts if the line actually wins at least a minor piece
  // (otherwise it is just an exchange that happens to contain a pin)
  
  if (startPhase === 'endgame') themes.add('endgame');
  if (themes.size === 0 || (themes.size === 1 && themes.has('endgame'))) themes.add('positional');

  const ordered = THEME_ORDER.filter((t) => themes.has(t));
  // an endgame tag should not hide a more specific idea
  let primary = ordered.find((t) => t !== 'endgame') || ordered[0];
  if (primary === 'positional' && themes.has('endgame')) primary = 'endgame';
  return { themes: ordered, primary, detail, mateIn: mateIn || 0, startPhase, gain: finalDiff - startDiff };
}

/** Convert UCI move list to SAN from a FEN. Stops at the first illegal move. */
function pvToSan(fen, pv, max = 12) {
  const c = new Chess(fen);
  const out = [];
  for (const u of pv.slice(0, max)) {
    try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch (e) { break; }
  }
  return out;
}
function uciToSan(fen, uci) { return pvToSan(fen, [uci], 1)[0]; }

/** Human wording of "1. e4 e5 2. Nf3" style from a FEN and SAN list. */
function formatLine(fen, sans) {
  const c = new Chess(fen);
  let n = +fen.split(' ')[5] || 1;
  let white = c.turn() === 'w';
  const parts = [];
  sans.forEach((s, i) => {
    if (white) parts.push(`${n}. ${s}`);
    else parts.push(i === 0 ? `${n}... ${s}` : s);
    if (!white) n++;
    white = !white;
  });
  return parts.join(' ');
}

const THEME_LABEL = {
  backRankMate: 'Back-rank mate', mate: 'Checkmate', fork: 'Fork', pin: 'Pin', skewer: 'Skewer',
  discoveredAttack: 'Discovered attack', sacrifice: 'Sacrifice', hangingPiece: 'Hanging piece',
  promotion: 'Promotion', winsMaterial: 'Material & exchanges', endgame: 'Endgame technique', positional: 'Positional play',
};

module.exports = { analyzeLine, pvToSan, uciToSan, formatLine, material, phase, THEME_ORDER, THEME_LABEL, NAMES, VAL };
