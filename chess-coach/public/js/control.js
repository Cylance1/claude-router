// Square control: which squares does a colour attack?
// "Control" = some piece of that colour attacks the square (pawns diagonally forward, knights jump, sliders stop at the first
// piece they meet, the king covers its neighbours). Squares holding the colour's own pieces count when another piece defends them.
// Pins are ignored: a pinned piece still attacks along its lines, which is how players normally count control.
// Works in the browser (global makeControl) and in Node (module.exports).
(function (root) {
  const FILES = 'abcdefgh';
  const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

  function makeControl(Chess) {
    /** {square: [{square, type}]} for every square the colour attacks. */
    function controlled(fen, color = 'w') {
      const c = new Chess(fen); const out = {};
      for (let f = 0; f < 8; f++) for (let r = 1; r <= 8; r++) {
        const sq = FILES[f] + r;
        const att = c.attackers(sq, color);
        if (att.length) out[sq] = att.map((a) => ({ square: a, type: c.get(a).type }));
      }
      return out;
    }
    /** 64-bit mask as a hex string: bit (file + 8 * (rank - 1)) is set when the colour controls that square. */
    function mask(fen, color = 'w') {
      let m = 0n;
      for (const sq of Object.keys(controlled(fen, color))) m |= 1n << BigInt(FILES.indexOf(sq[0]) + 8 * (+sq[1] - 1));
      return m.toString(16).padStart(16, '0');
    }
    const inRegion = (sq, region) => region === 'both' || (region === 'queen' ? FILES.indexOf(sq[0]) < 4 : FILES.indexOf(sq[0]) >= 4);
    /** Count of controlled squares in a region, from a hex mask. */
    function count(hex, region = 'both') {
      const m = BigInt('0x' + hex); let n = 0;
      for (let f = 0; f < 8; f++) if (inRegion(FILES[f] + '1', region)) for (let r = 0; r < 8; r++) if ((m >> BigInt(f + 8 * r)) & 1n) n++;
      return n;
    }
    const names = (list) => list.map((a) => `${NAME[a.type]} on ${a.square}`).join(' and ');
    return { controlled, mask, count, inRegion, names, FILES };
  }
  root.makeControl = makeControl;
  if (typeof module !== 'undefined' && module.exports) module.exports = { makeControl };
})(typeof window !== 'undefined' ? window : globalThis);
