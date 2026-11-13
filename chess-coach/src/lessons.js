'use strict';
// Short, practical lessons per tactical/strategic theme. Used by the Lessons tab and the coach's takeaways.
const LESSONS = {
  hangingPiece: {
    title: 'Hanging pieces',
    summary: 'A piece is "hanging" when it can be captured for free — nothing defends it, or it is worth more than its attacker. Most games under ~1500 are decided by one of these.',
    spot: ['Before every move, list the opponent\'s last move\'s threats: what does the piece that just moved attack now?', 'Look at every piece of yours and ask "who defends this?"', 'Look at every enemy piece the same way — they hang pieces too.'],
    habit: 'Blunder check: after choosing a move, ask "if I play this, what can my opponent capture or check?" before you click.',
    takeaway: 'Count attackers and defenders on every piece that could be captured. A piece defended once is fine; a piece defended zero times is a gift.',
  },
  fork: {
    title: 'Forks',
    summary: 'A fork is one piece attacking two or more targets at once, so the opponent can only save one. Knights are the classic forkers because their jumps can\'t be blocked, but queens, pawns and even kings fork too.',
    spot: ['Look for squares where a knight would attack the king and another piece (a "royal fork").', 'Check pawn forks: a pawn push that hits two pieces diagonally.', 'Loose pieces (undefended) are the usual victims — find them first.'],
    habit: 'Each move, find every undefended enemy piece and ask which of my pieces could attack two of them.',
    takeaway: 'Keep your pieces defended and off squares where a knight check would hit two of them.',
  },
  pin: {
    title: 'Pins',
    summary: 'A pin freezes a piece because moving it would expose something more valuable behind it (an absolute pin if that is the king). Pinned pieces can\'t defend properly, which is how you win them.',
    spot: ['Bishops, rooks and queens create pins — scan their lines for an enemy piece in front of the king or queen.', 'Attack the pinned piece again with a pawn; it can\'t run away.', 'Beware of your own pieces being pinned before you castle or move the queen.'],
    habit: 'Before moving a piece, check whether it is standing in front of your king or queen on a line.',
    takeaway: 'Add attackers to a pinned piece — it can\'t move, so it will fall.',
  },
  skewer: {
    title: 'Skewers',
    summary: 'A skewer is a reverse pin: attack a valuable piece so that when it moves, the piece behind it is captured.',
    spot: ['Check on a file or diagonal where the king stands in front of a queen or rook.', 'Queens and rooks lined up on the same file or rank are skewer targets.'],
    habit: 'Don\'t line up your king or queen with a rook or bishop of theirs on an open line.',
    takeaway: 'Force the big piece to move with a check or attack, then take what\'s behind it.',
  },
  discoveredAttack: {
    title: 'Discovered attacks',
    summary: 'Move one piece out of the way and reveal an attack from another piece behind it. The moving piece can make its own threat at the same time, so the opponent faces two problems at once.',
    spot: ['Find a bishop, rook or queen of yours with one of your own pieces in front of it, aimed at something valuable.', 'The most powerful version is a discovered check, where the moving piece can capture anything.'],
    habit: 'Look at lines where your pieces are "stacked" behind each other and aimed at the enemy king or queen.',
    takeaway: 'The piece that moves out gets a free move — use it to capture or attack something big.',
  },
  mate: {
    title: 'Checkmate patterns',
    summary: 'Forced checkmate ends the game. Learning a few repeating patterns (ladder, smothered, Anastasia, queen-and-bishop battery) lets you spot mates in 1–3 moves instantly.',
    spot: ['List every check you have — even ones that lose a piece. Do any leave the king with no escape?', 'Count the king\'s flight squares: who covers them?', 'Check your own king the same way before an attack.'],
    habit: 'Always look at every check, capture and threat for BOTH sides before moving.',
    takeaway: 'If the king has few escape squares, look for the move that takes the last one away.',
  },
  backRankMate: {
    title: 'Back-rank mates',
    summary: 'A king stuck behind its own pawns on the first (or eighth) rank can be mated by a rook or queen. It is the most common checkmate at club level — in both directions.',
    spot: ['Is the enemy back rank guarded? Can a rook or queen land on it with check?', 'Look at your own king: make "luft" (a flight square) with h3/h6 or g3/g6 when rooks are on the board.', 'Deflect or capture the back-rank defender.'],
    habit: 'When both sides have rooks, ask "does my king have an escape square?" before making a long-term plan.',
    takeaway: 'Give your king luft; and exploit opponents who didn\'t.',
  },
  sacrifice: {
    title: 'Sacrifices',
    summary: 'A sacrifice gives up material to get something bigger back: checkmate, a bigger piece, or a winning attack. The key is calculating the forced line to the end.',
    spot: ['Look at forcing moves first: checks, captures, threats.', 'Ask what the sacrifice forces the opponent to do — if every reply is forced, you can calculate it.', 'Count material at the END of the sequence, not in the middle.'],
    habit: 'Practice "candidate moves": list every check, capture and threat, and calculate each to a quiet position.',
    takeaway: 'A sacrifice works when the opponent has no good choice. Calculate all their replies.',
  },
  promotion: {
    title: 'Promotion tactics',
    summary: 'A pawn about to reach the last rank is worth far more than its value on the board. Promotion threats can deflect defenders and win games on the spot.',
    spot: ['Is a passed pawn on the 6th or 7th rank? Can it be supported or can a defender be removed?', 'Underpromotion (to a knight) sometimes gives check or avoids stalemate.'],
    habit: 'In every endgame, count the squares: can the king catch the pawn?',
    takeaway: 'Passed pawns must be pushed — and blockaded early if they are the opponent\'s.',
  },
  winsMaterial: {
    title: 'Winning material',
    summary: 'Often the tactic is just a short sequence of captures that leaves one side up material — the classic "who takes last wins" calculation.',
    spot: ['Before capturing, count attackers and defenders on the target square.', 'Look for in-between moves (zwischenzug): a check or bigger threat before recapturing.', 'Check whether your recapture leaves another piece loose.'],
    habit: 'Always recalculate trades to the end: the last capture decides the result.',
    takeaway: 'Don\'t stop calculating halfway through an exchange.',
  },
  endgame: {
    title: 'Endgame technique',
    summary: 'In simplified positions the king is a fighting piece, pawn structure is everything and the correct order of moves matters. Precise moves matter far more than in the middlegame.',
    spot: ['Activate your king toward the center and the pawns.', 'Rooks belong behind passed pawns; put them on open files and the 7th rank.', 'Count pawn races and learn the opposition.'],
    habit: 'In the endgame, ask "where is my king useful?" before every pawn or rook move.',
    takeaway: 'Centralize your king, create a passed pawn and use the opposition.',
  },
  positional: {
    title: 'Positional play',
    summary: 'When there is no immediate tactic, good moves improve your worst piece, fight for the center, keep your king safe, and avoid creating weaknesses.',
    spot: ['Which of your pieces is doing the least? Improve it.', 'Are there open files or diagonals you can take control of?', 'Don\'t create weaknesses (like moving pawns in front of your king) without a reason.'],
    habit: 'Choose a plan: develop, castle, connect rooks, fight for the center.',
    takeaway: 'Safe king, active pieces, central control. Tactics come from good positions.',
  },
};

module.exports = { LESSONS };
