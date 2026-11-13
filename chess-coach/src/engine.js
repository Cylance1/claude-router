'use strict';
// Stockfish (WASM build from the `stockfish` npm package) driven over UCI in child processes.
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const SF_PATH = path.join(path.dirname(require.resolve('stockfish/package.json')), 'bin', 'stockfish-19-lite-single.js');

class Engine {
  constructor() {
    this.p = spawn(process.execPath, [SF_PATH], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.buf = '';
    this.waiters = [];
    this.multipv = 1;
    this.queue = Promise.resolve();
    this.p.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        for (const w of [...this.waiters]) w(line);
      }
    });
    this.ready = this._init();
  }
  _send(cmd) { this.p.stdin.write(cmd + '\n'); }
  _wait(pred, onLine) {
    return new Promise((resolve) => {
      const w = (line) => {
        if (onLine) onLine(line);
        if (pred(line)) { this.waiters.splice(this.waiters.indexOf(w), 1); resolve(line); }
      };
      this.waiters.push(w);
    });
  }
  async _init() {
    this._send('uci');
    await this._wait((l) => l === 'uciok');
    this._send('setoption name Hash value 32');
    this._send('isready');
    await this._wait((l) => l === 'readyok');
  }
  /** Returns { lines: [{multipv, cp, mate, depth, pv:[uci]}], best } with scores from the side to move's view. */
  analyze(fen, { depth = 14, multipv = 1, movetime } = {}) {
    const run = async () => {
      await this.ready;
      if (multipv !== this.multipv) { this._send(`setoption name MultiPV value ${multipv}`); this.multipv = multipv; }
      this._send(`position fen ${fen}`);
      const byPv = {};
      const done = this._wait((l) => l.startsWith('bestmove'), (l) => {
        if (!l.startsWith('info') || !l.includes(' pv ') || /bound/.test(l)) return;
        const t = l.split(' ');
        const get = (k) => t[t.indexOf(k) + 1];
        const mpv = t.includes('multipv') ? +get('multipv') : 1;
        const sc = t.indexOf('score');
        const o = { multipv: mpv, depth: +get('depth'), pv: t.slice(t.indexOf('pv') + 1) };
        if (t[sc + 1] === 'cp') o.cp = +t[sc + 2]; else o.mate = +t[sc + 2];
        byPv[mpv] = o;
      });
      this._send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
      const bm = (await done).split(' ')[1];
      const lines = Object.values(byPv).sort((a, b) => a.multipv - b.multipv);
      return { lines, best: bm === '(none)' ? null : bm };
    };
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }
  close() { try { this.p.kill(); } catch (e) { /* ignore */ } }
}

class EnginePool {
  constructor(size = Math.max(1, Math.min(4, os.cpus().length))) {
    this.engines = Array.from({ length: size }, () => new Engine());
    this.load = this.engines.map(() => 0);
  }
  analyze(fen, opts) {
    let k = 0;
    for (let i = 1; i < this.load.length; i++) if (this.load[i] < this.load[k]) k = i;
    this.load[k]++;
    return this.engines[k].analyze(fen, opts).finally(() => { this.load[k]--; });
  }
  close() { this.engines.forEach((e) => e.close()); }
}

/** Convert an engine line's score to a single centipawn-like number (side-to-move view). */
function lineCp(line) {
  if (!line) return 0;
  if (line.mate !== undefined) return Math.sign(line.mate) * (10000 - Math.abs(line.mate) * 10);
  return line.cp;
}
/** Lichess-style win probability (0-100) from centipawns. */
function winPct(cp) { return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1); }

module.exports = { Engine, EnginePool, lineCp, winPct };
