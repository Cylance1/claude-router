// Loose / hanging piece detection that only counts REAL recaptures.
// "Touching" a piece is not defending it: a pinned piece cannot recapture, and a king cannot recapture onto a square
// that is still attacked. Works in the browser (global makeLoose) and in Node (module.exports).
(function (root) {
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const other = (c) => (c === 'w' ? 'b' : 'w');
  const TARGETS = ['n', 'b', 'r', 'q']; // pawns and kings are not part of the drill

  function makeLoose(Chess) {
    const withTurn = (fen, color) => { const f = fen.split(' '); f[1] = color; f[3] = '-'; return f.join(' '); };
    const kingSquare = (c, color) => { for (const row of c.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square; return null; };

    /**
     * Who REALLY defends the piece on `sq`?  If an enemy piece can capture it, play the cheapest legal capture and see who can
     * legally recapture (so pins, kings stepping into check and x-rays are all handled). If nothing attacks it yet, test each
     * touching piece by letting it step onto the square. `blocked` = touches the piece but cannot recapture.
     */
    function defenders(chess, sq) {
      const target = chess.get(sq); const list = []; const blocked = [];
      if (!target) return { list, blocked };
      const enemy = other(target.color); const kingSq = kingSquare(chess, target.color);
      const touching = chess.attackers(sq, target.color);
      const why = (type) => (type === 'k' ? 'the king would step into check' : 'it is pinned');
      const atts = attackersOf(chess.fen(), sq, target.color).sort((x, y) => VALUE[x.type] - VALUE[y.type]);
      if (atts.length) {
        const c = new Chess(withTurn(chess.fen(), enemy));
        const first = c.moves({ verbose: true }).find((m) => m.to === sq && m.from === atts[0].square && m.captured);
        c.move({ from: first.from, to: first.to, promotion: first.promotion });
        const recaps = c.moves({ verbose: true }).filter((m) => m.to === sq && m.captured).map((m) => ({ square: m.from, type: m.piece, why: '' }));
        recaps.forEach((r) => list.push(r));
        touching.filter((t) => !recaps.some((r) => r.square === t)).forEach((t) => blocked.push({ square: t, type: chess.get(t).type, why: why(chess.get(t).type) }));
        return { list, blocked };
      }
      for (const from of touching) {
        const d = chess.get(from);
        const sim = new Chess(chess.fen());
        sim.remove(from); sim.remove(sq); sim.put({ type: d.type, color: d.color }, sq);
        const guard = d.type === 'k' ? sq : kingSq;
        const unsafe = guard ? sim.isAttacked(guard, enemy) : false;
        (unsafe ? blocked : list).push({ square: from, type: d.type, why: unsafe ? why(d.type) : '' });
      }
      return { list, blocked };
    }

    /** Pieces that can legally capture on `sq` if it were their turn. */
    function attackersOf(fen, sq, color) {
      const c = new Chess(withTurn(fen, other(color)));
      return c.moves({ verbose: true }).filter((m) => m.to === sq && m.captured).map((m) => ({ square: m.from, type: m.piece }));
    }

    /** Best net material the side to move can win by capturing on sq (a chain of captures, they may stop at any time). */
    function gain(fen, sq, depth = 0) {
      const c = new Chess(fen);
      const caps = c.moves({ verbose: true }).filter((m) => m.to === sq && m.captured);
      if (!caps.length || depth > 8) return 0;
      let best = 0;
      for (const m of caps) {
        c.move({ from: m.from, to: m.to, promotion: m.promotion });
        best = Math.max(best, VALUE[m.captured] - gain(c.fen(), sq, depth + 1));
        c.undo();
      }
      return best;
    }

    /** Every knight/bishop/rook/queen with its defenders, attackers and whether it can be won right now. */
    function analyze(fen) {
      const chess = new Chess(fen); const out = [];
      for (const row of chess.board()) for (const p of row) {
        if (!p || !TARGETS.includes(p.type)) continue;
        const def = defenders(chess, p.square);
        const att = attackersOf(fen, p.square, p.color);
        let g = 0; try { g = att.length ? gain(withTurn(fen, other(p.color)), p.square) : 0; } catch (e) { g = 0; }
        out.push({ square: p.square, color: p.color, type: p.type, defenders: def.list, blocked: def.blocked, attackers: att,
          undefended: def.list.length === 0, hanging: g > 0, gain: g });
      }
      return out;
    }

    const nm = (x) => `${NAME[x.type]} on ${x.square}`;
    const join = (xs) => xs.map(nm).join(' and ');
    /** Plain-English reason for one piece. */
    function explain(l) {
      const who = `${l.color === 'w' ? 'White' : 'Black'} ${NAME[l.type]} on ${l.square}`;
      const parts = [];
      parts.push(l.defenders.length ? `defended by the ${join(l.defenders)}` : 'not defended by anything');
      if (l.blocked.length) parts.push(`the ${l.blocked.map((b) => `${nm(b)} (${b.why})`).join(' and the ')} touches it but cannot recapture`);
      if (l.attackers.length) parts.push(`attacked by the ${join(l.attackers)}`); else parts.push('not attacked right now');
      if (l.hanging) parts.push(`it can be won (the capture nets ${l.gain} point${l.gain === 1 ? '' : 's'})`);
      else if (l.attackers.length) parts.push('capturing it would lose material');
      return `${who}: ${parts.join('; ')}.`;
    }
    return { analyze, defenders, attackersOf, gain, explain, withTurn };
  }
  root.makeLoose = makeLoose;
  if (typeof module !== 'undefined' && module.exports) module.exports = { makeLoose };
})(typeof window !== 'undefined' ? window : globalThis);
