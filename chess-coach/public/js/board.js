// Self-contained interactive chessboard (no external assets): click or drag to move, arrows, highlights, animation.
import { Chess } from '/vendor/chess.js';
import { pieceSvg } from '/js/pieces.js';

const FILES = 'abcdefgh';

export class Board {
  constructor(el, { onMove, interactive = true } = {}) {
    this.el = el; this.onMove = onMove; this.interactive = interactive;
    this.chess = new Chess(); this.orientation = 'w'; this.sel = null; this.marks = {}; this.arrows = []; this.lastMove = null;
    this.locked = false;
    el.classList.add('board');
    el.innerHTML = '<div class="grid"></div><svg class="arrows" viewBox="0 0 8 8"></svg><div class="promo" hidden></div>';
    this.grid = el.querySelector('.grid'); this.svg = el.querySelector('.arrows'); this.promoEl = el.querySelector('.promo');
    this.grid.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    this.render();
  }
  load(fen) { this.chess = new Chess(fen); this.sel = null; this.lastMove = null; this.marks = {}; this.arrows = []; this.render(); }
  flip(o) { this.orientation = o || (this.orientation === 'w' ? 'b' : 'w'); this.render(); }
  fen() { return this.chess.fen(); }
  turn() { return this.chess.turn(); }
  setMarks(marks) { this.marks = marks || {}; this.render(); }
  setArrows(arrows) { this.arrows = arrows || []; this.drawArrows(); }
  /** Play a move programmatically with a slide animation. */
  async play(uci, { animate = true, mark = true } = {}) {
    const from = uci.slice(0, 2); const to = uci.slice(2, 4);
    let mv;
    try { mv = this.chess.move({ from, to, promotion: uci[4] }); } catch (e) { return null; }
    this.sel = null;
    if (mark) this.lastMove = { from, to };
    this.render();
    if (animate) await this.slide(from, to);
    return mv;
  }
  async playSan(san, { animate = true } = {}) {
    let mv;
    try { mv = this.chess.move(san); } catch (e) { return null; }
    this.sel = null; this.lastMove = { from: mv.from, to: mv.to };
    this.render();
    if (animate) await this.slide(mv.from, mv.to);
    return mv;
  }
  undo() { this.chess.undo(); this.sel = null; this.render(); }
  slide(from, to) {
    return new Promise((res) => {
      const t = this.cell(to); const piece = t && t.querySelector('.piece');
      if (!piece) return res();
      const [fx, fy] = this.xy(from); const [tx, ty] = this.xy(to);
      piece.style.transition = 'none';
      piece.style.transform = `translate(${(fx - tx) * 100}%, ${(fy - ty) * 100}%)`;
      piece.getBoundingClientRect();
      piece.style.transition = 'transform .22s ease';
      piece.style.transform = 'translate(0,0)';
      setTimeout(res, 240);
    });
  }
  xy(sq) { // screen coordinates (col,row) with orientation
    const f = FILES.indexOf(sq[0]); const r = +sq[1] - 1;
    return this.orientation === 'w' ? [f, 7 - r] : [7 - f, r];
  }
  cell(sq) { return this.grid.querySelector(`[data-sq="${sq}"]`); }
  squares() {
    const out = [];
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const f = this.orientation === 'w' ? col : 7 - col;
      const r = this.orientation === 'w' ? 7 - row : row;
      out.push(FILES[f] + (r + 1));
    }
    return out;
  }
  legalTargets(from) { return this.chess.moves({ square: from, verbose: true }); }
  render() {
    const b = this.chess;
    const html = this.squares().map((s) => {
      const p = b.get(s);
      const f = FILES.indexOf(s[0]); const r = +s[1] - 1;
      const cls = ['sq', (f + r) % 2 ? 'light' : 'dark'];
      if (this.lastMove && (this.lastMove.from === s || this.lastMove.to === s)) cls.push('last');
      if (this.sel === s) cls.push('sel');
      if (this.marks[s]) cls.push(this.marks[s]);
      if (p && p.type === 'k' && b.isCheck() && p.color === b.turn()) cls.push('check');
      const col = this.orientation === 'w' ? f : 7 - f; const row = this.orientation === 'w' ? 7 - r : r;
      const coord = (col === 0 ? `<i class="rk">${r + 1}</i>` : '') + (row === 7 ? `<i class="fl">${s[0]}</i>` : '');
      const dot = this.sel && this.legalTargets(this.sel).some((m) => m.to === s) ? `<b class="${p ? 'cap' : 'dot'}"></b>` : '';
      return `<div class="${cls.join(' ')}" data-sq="${s}">${coord}${dot}${p ? pieceSvg(p.color, p.type) : ''}</div>`;
    }).join('');
    this.grid.innerHTML = html;
    this.drawArrows();
  }
  drawArrows() {
    const pt = (sq) => { const [c, r] = this.xy(sq); return [c + 0.5, r + 0.5]; };
    const head = (id, c) => `<marker id="${id}" viewBox="0 0 4 4" refX="2.6" refY="2" markerWidth="2.4" markerHeight="2.4" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="${c}"/></marker>`;
    this.svg.innerHTML = `<defs>${head('ah-good', 'rgba(47,125,79,.9)')}${head('ah-bad', 'rgba(200,55,45,.9)')}</defs>` +
      this.arrows.map((a) => {
        const [x1, y1] = pt(a.from); const [x2, y2] = pt(a.to);
        const dx = x2 - x1; const dy = y2 - y1; const len = Math.hypot(dx, dy) || 1;
        const k = a.cls === 'bad' ? 'bad' : 'good';
        return `<line class="arrow ${k}" x1="${x1 + dx / len * 0.25}" y1="${y1 + dy / len * 0.25}" x2="${x2 - dx / len * 0.12}" y2="${y2 - dy / len * 0.12}" marker-end="url(#ah-${k})"/>`;
      }).join('');
  }
  // ----- input -----
  sqAt(e) {
    const r = this.grid.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * 8); const row = Math.floor(((e.clientY - r.top) / r.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return FILES[this.orientation === 'w' ? col : 7 - col] + (this.orientation === 'w' ? 8 - row : row + 1);
  }
  down(e) {
    if (!this.interactive || this.locked) return;
    const s = this.sqAt(e); if (!s) return;
    if (!this.promoEl.hidden) { this.promoEl.hidden = true; }
    const p = this.chess.get(s);
    if (this.sel && this.sel !== s && this.legalTargets(this.sel).some((m) => m.to === s)) { this.attempt(this.sel, s); return; }
    if (p && p.color === this.chess.turn()) {
      this.sel = s; this.render();
      const el = this.cell(s).querySelector('.piece');
      if (el) {
        this.drag = { s, el, id: e.pointerId };
        const r = this.grid.getBoundingClientRect();
        this.drag.size = r.width / 8;
        el.classList.add('dragging');
        this.dragTo(e);
      }
    } else { this.sel = null; this.render(); }
  }
  dragTo(e) { if (!this.drag) return; const r = this.cell(this.drag.s).getBoundingClientRect(); this.drag.el.style.transform = `translate(${e.clientX - r.left - r.width / 2}px, ${e.clientY - r.top - r.height / 2}px)`; }
  move(e) { if (this.drag) this.dragTo(e); }
  up(e) {
    if (!this.drag) return;
    const { s, el } = this.drag; this.drag = null;
    el.classList.remove('dragging'); el.style.transform = '';
    const t = this.sqAt(e);
    if (t && t !== s && this.legalTargets(s).some((m) => m.to === t)) this.attempt(s, t);
  }
  attempt(from, to) {
    const mv = this.legalTargets(from).find((m) => m.to === to);
    if (mv.promotion) {
      this.promoEl.hidden = false;
      this.promoEl.innerHTML = ['q', 'r', 'b', 'n'].map((t) => `<button data-p="${t}">${pieceSvg(this.chess.turn(), t)}</button>`).join('');
      this.promoEl.onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; this.promoEl.hidden = true; this.commit(from, to, b.dataset.p); };
      return;
    }
    this.commit(from, to);
  }
  commit(from, to, promotion) {
    const uci = from + to + (promotion || '');
    this.sel = null;
    if (this.onMove) this.onMove(uci, from, to);
  }
}
