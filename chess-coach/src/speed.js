'use strict';
// How move speed relates to accuracy, from the clock times chess.com stores in every PGN.
const clk = (s) => { const [h, m, x] = s.split(':'); return +h * 3600 + +m * 60 + +x; };
const BUCKETS = [[0, 3, 'under 3 s'], [3, 6, '3–6 s'], [6, 12, '6–12 s'], [12, 1e9, '12 s +']];

function moveTimes(analyses, tc = '600') {
  const rows = [];
  for (const a of analyses) {
    if (String(a.game.timeControl) !== tc) continue; // one time control keeps seconds comparable
    const c = [...a.pgn.matchAll(/\{\[%clk ([\d:.]+)\]\}/g)].map((m) => clk(m[1]));
    if (c.length !== a.moves.length) continue;
    const last = { w: +tc, b: +tc };
    a.moves.forEach((m, i) => {
      const t = Math.max(0, last[m.color] - c[i]); last[m.color] = c[i];
      if (m.mine) rows.push({ t, cls: m.cls, ply: m.ply, bal: Math.abs(m.evalBefore) < 150 });
    });
  }
  return rows;
}
const pct = (g, f) => (g.length ? +(100 * g.filter(f).length / g.length).toFixed(1) : null);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };

function computeSpeed(analyses) {
  const rows = moveTimes(analyses);
  const ctl = rows.filter((r) => r.bal && r.ply > 10 && r.ply <= 40);
  const table = (rs) => BUCKETS.map(([lo, hi, label]) => { const g = rs.filter((r) => r.t >= lo && r.t < hi); return { label, moves: g.length, blunderPct: pct(g, (r) => r.cls === 'blunder') }; });
  const bl = rows.filter((r) => r.cls === 'blunder');
  return {
    moves: rows.length, games: new Set(analyses.filter((a) => String(a.game.timeControl) === '600').map((a) => a.gameId)).size,
    medianSeconds: +med(rows.map((r) => r.t)).toFixed(1), medianBlunderSeconds: bl.length ? +med(bl.map((r) => r.t)).toFixed(1) : null,
    raw: table(rows), controlled: table(ctl), controlledMoves: ctl.length,
  };
}
module.exports = { computeSpeed };
