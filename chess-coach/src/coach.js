'use strict';
// The "teacher". Every explanation is built from engine-verified facts (best line, refutation, theme).
// If ANTHROPIC_API_KEY is set, Claude rewrites those facts into a personal explanation; otherwise a
// rule-based explainer produces the same structure.
const { formatLine, NAMES, THEME_LABEL } = require('./themes');
const { LESSONS } = require('./lessons');

const MODEL = process.env.COACH_MODEL || 'claude-sonnet-5-5';
let client = null;
function claude() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) { const Anthropic = require('@anthropic-ai/sdk'); client = new (Anthropic.default || Anthropic)(); }
  return client;
}
const hasClaude = () => !!process.env.ANTHROPIC_API_KEY;

/** Centipawns (White POV) -> text from `color`'s point of view. */
function evalText(cp, color) {
  const v = color === 'w' ? cp : -cp;
  if (Math.abs(v) >= 9000) return v > 0 ? 'a forced win' : 'a forced loss';
  const p = (v / 100).toFixed(1);
  return (v > 0 ? '+' : '') + p;
}
function evalWords(cp, color) {
  const v = color === 'w' ? cp : -cp;
  if (v >= 9000) return 'you have a forced checkmate';
  if (v <= -9000) return 'you are getting checkmated by force';
  if (v > 300) return 'you are winning';
  if (v > 120) return 'you are clearly better';
  if (v > 40) return 'you are slightly better';
  if (v >= -40) return 'the position is equal';
  if (v >= -120) return 'you are slightly worse';
  if (v >= -300) return 'you are clearly worse';
  return 'you are losing';
}

function describeIdea(r, side) {
  // r = {primary, themes, detail, gain}; side = 'you' | 'your opponent'
  if (!r) return null;
  const d = r.detail || {};
  const T = r.themes || [];
  if (T.includes('backRankMate')) return `a back-rank checkmate (${d.mate && d.mate.move || ''})`;
  if (T.includes('mate')) return d.mate && d.mate.in ? `a forced checkmate in ${d.mate.in}` : 'a forced checkmate';
  if (r.primary === 'fork' && d.fork) return `a ${d.fork.piece} fork on ${d.fork.square}, hitting the ${d.fork.targets.join(' and the ')}`;
  if (r.primary === 'pin' && d.pin) return `a pin: the ${d.pin.pinned} cannot move without exposing the ${d.pin.behind}`;
  if (r.primary === 'skewer' && d.skewer) return `a skewer: when the ${d.skewer.front} moves, the ${d.skewer.behind} falls`;
  if (r.primary === 'discoveredAttack' && d.discoveredAttack) return `a discovered attack: moving the ${d.discoveredAttack.mover} unleashes the ${d.discoveredAttack.slider} on the ${d.discoveredAttack.target}`;
  if (r.primary === 'sacrifice') return 'a sacrifice that wins everything back and more';
  if (r.primary === 'hangingPiece' && d.hangingPiece) return `a free piece: the ${d.hangingPiece.piece} on ${d.hangingPiece.square} could simply be taken`;
  if (r.primary === 'promotion') return 'a pawn promotion';
  if (r.gain >= 2) return `a sequence that wins about ${Math.round(r.gain)} points of material`;
  return null;
}

/** Rule-based explanation. */
function templateExplain(m, game) {
  const color = m.color;
  const before = evalText(m.evalBefore, color);
  const after = evalText(m.evalAfter, color);
  const L = m.lesson || { kind: 'positional', theme: 'positional' };
  const lesson = LESSONS[L.theme] || LESSONS.positional;
  const label = { inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder' }[m.cls] || m.cls;
  const bestLine = formatLine(m.fenBefore, m.bestLine || [m.bestSan].filter(Boolean));
  const refLine = m.refutationLine && m.refutationLine.length ? formatLine(m.fenAfter, m.refutationLine.slice(0, 4)) : null;

  const happened = `You played **${m.san}**. Your evaluation went from ${before} to ${after} — before it, ${evalWords(m.evalBefore, color)}; after it, ${evalWords(m.evalAfter, color)}.`;
  let why;
  if (L.kind === 'allowed') {
    const idea = describeIdea(m.allowed, 'opponent');
    why = `${m.san} lets your opponent play **${m.refutationLine[0]}**` + (idea ? `, which is ${idea}.` : '.') + (refLine ? ` The likely continuation is ${refLine}.` : '');
  } else if (L.kind === 'missed') {
    const idea = describeIdea(m.missed, 'you');
    why = `There was something better available: **${m.bestSan}**` + (idea ? ` — ${idea}.` : '.') + ` ${m.san} lets that chance slip.`;
  } else {
    why = `No immediate tactic here, but **${m.bestSan}** is the more accurate move: it keeps your advantage and improves your position, while ${m.san} gives up ${Math.round(m.winLoss)}% of your winning chances.`;
  }
  const better = `**${m.bestSan}** — main line: ${bestLine}.`;
  const takeaway = `**${lesson.title}:** ${lesson.takeaway}\n\n*Habit:* ${lesson.habit}`;
  return {
    source: 'engine', headline: `${label}: ${m.moveNumber}${m.color === 'w' ? '.' : '...'} ${m.san}`,
    sections: { happened, why, better, takeaway }, theme: L.theme, themeLabel: THEME_LABEL[L.theme],
  };
}

const SYSTEM = `You are a warm, precise chess coach reviewing one move of a student's game.
You are given engine-verified facts. NEVER invent moves, evaluations or tactics beyond those facts; if you mention a move it must come from the facts.
Write for a club player: plain language, concrete, no jargon without a short explanation, no engine-speak like "centipawns".
Return exactly four short markdown sections with these bold headings and nothing else:
**What happened** (1-2 sentences, what the student's move did)
**Why it's a problem** (2-3 sentences: explain the idea behind the refutation / missed chance and what the student probably didn't see)
**Better** (name the best move, explain in 1-2 sentences why it works, and give the key line)
**Remember** (one memorable rule of thumb the student can apply next time, tied to the theme)
Use "you". Total under 170 words.`;

async function claudeExplain(m, game, base) {
  const c = claude();
  if (!c) return null;
  const facts = {
    studentRating: game && game.me && game.me.rating,
    color: m.color === 'w' ? 'White' : 'Black',
    moveNumber: m.moveNumber, movePlayed: m.san, classification: m.cls,
    winChanceLostPercent: Math.round(m.winLoss),
    evalBeforeForStudent: evalText(m.evalBefore, m.color), evalAfterForStudent: evalText(m.evalAfter, m.color),
    fen: m.fenBefore,
    bestMove: m.bestSan, bestLine: formatLine(m.fenBefore, m.bestLine || []),
    opponentBestReplyToStudentMove: m.refutationLine && m.refutationLine[0], refutationLine: m.refutationLine && formatLine(m.fenAfter, m.refutationLine),
    lessonKind: m.lesson && m.lesson.kind, theme: m.lesson && m.lesson.label,
    tacticOpponentGets: describeIdea(m.allowed), tacticStudentMissed: describeIdea(m.missed),
  };
  const res = await c.messages.create({
    model: MODEL, max_tokens: 600, system: SYSTEM,
    messages: [{ role: 'user', content: 'Facts (JSON):\n' + JSON.stringify(facts, null, 1) }],
  });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return { ...base, source: 'claude', text };
}

async function explainMove(m, game) {
  const base = templateExplain(m, game);
  if (!hasClaude()) return base;
  try { return (await claudeExplain(m, game, base)) || base; } catch (e) { return { ...base, note: 'AI coach unavailable (' + (e.status || e.message) + ') — showing the engine explanation.' }; }
}

/** Free-form question about a position. */
async function ask({ fen, question, history = [], context = '' }) {
  const c = claude();
  if (!c) return { answer: 'The conversational coach needs an ANTHROPIC_API_KEY on the server. The move-by-move reviews and puzzles work without it.' };
  const res = await c.messages.create({
    model: MODEL, max_tokens: 700,
    system: 'You are a friendly chess coach. Answer briefly and concretely. Only discuss moves that are legal in the FEN you are given, and say when you are unsure. ' + context,
    messages: [...history.slice(-6), { role: 'user', content: `Position (FEN): ${fen}\n\n${question}` }],
  });
  return { answer: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() };
}

const HINT1 = {
  fork: 'Look for a move that attacks two valuable pieces at once.',
  pin: 'Look for a line (diagonal / file) where an enemy piece is in front of something more valuable.',
  skewer: 'A big piece is on a line with something behind it — attack it so it has to move.',
  discoveredAttack: 'One of your pieces is blocking another. What happens if the blocker moves with a threat?',
  mate: 'Your opponent\'s king has very few escape squares. Look at every check.',
  backRankMate: 'The enemy king is boxed in by its own pawns. Can a rook or queen reach the back rank?',
  sacrifice: 'Think about giving something up — what does the sacrifice force your opponent to do?',
  hangingPiece: 'Something is unprotected. Check every enemy piece: who defends it?',
  promotion: 'A pawn is close to promoting. Can you clear the way or remove a defender?',
  winsMaterial: 'There is a sequence of captures that leaves you ahead. Count it to the end.',
  endgame: 'Think about king activity, passed pawns and the opposition.',
  positional: 'No flashy tactic — think about the safest, most useful move for your worst-placed piece.',
};
function hints(puzzle) {
  const first = puzzle.solution[0];
  return [
    HINT1[puzzle.theme] || HINT1.positional,
    { text: 'Move this piece.', from: first.slice(0, 2) },
    { text: 'The solution:', from: first.slice(0, 2), to: first.slice(2, 4) },
  ];
}

module.exports = { explainMove, templateExplain, ask, hints, hasClaude, evalText, evalWords, describeIdea };
