"""VWAP-retest strategy, expressed as a bar-by-bar state machine.

The same DayState drives both the backtest and the live bot so they cannot diverge.
Bars are 5-minute, indexed by bar START time (ET). A bar is acted on at its close.
"""
from dataclasses import dataclass, field
from datetime import time
from typing import Optional

import math


@dataclass
class Params:
    require_vwap_beyond_pm: bool = True  # video: "VWAP is over the pre-market high"
    touch_tol: float = 0.0005     # retest counts if within 0.05% of VWAP
    stop_tol: float = 0.0005      # stop = close beyond VWAP by more than this ("a couple pennies")
    min_risk_pct: float = 0.0015  # floor on 1R as fraction of price (VWAP is often right at entry)
    min_rr: float = 1.0           # skip if room to the first target < min_rr * 1R
    tp1_frac: float = 0.5         # fraction sold at high/low of day ("most of your position")
    entry_start: time = time(9, 30)
    entry_end: time = time(10, 30)    # last bar START allowed for entry (first hour)
    flatten_at: time = time(11, 30)   # bar START at/after which any open position is closed at the open
    max_trades_per_day: int = 2
    allow_long: bool = True
    allow_short: bool = True


@dataclass
class Action:
    kind: str          # ENTER | TP1 | EXIT
    ts: object         # bar start timestamp that produced it
    side: str          # long | short
    price: float       # reference/fill price (before slippage)
    frac: float = 1.0  # fraction of ORIGINAL position (ENTER: 1.0)
    reason: str = ""
    risk_unit: float = 0.0  # price distance that defines 1R (ENTER only)
    target: float = 0.0     # first target (ENTER only)


@dataclass
class DayState:
    p: Params = field(default_factory=Params)
    hod: float = -math.inf
    lod: float = math.inf
    armed_long: bool = False
    armed_short: bool = False
    trades: int = 0
    side: Optional[str] = None
    entry: float = 0.0
    risk_unit: float = 0.0
    target: float = 0.0
    remaining: float = 0.0
    tp1_done: bool = False

    def _flat(self):
        self.side = None
        self.remaining = 0.0

    def on_bar(self, ts, r) -> list:
        """Process one CLOSED bar (r has open/high/low/close/vwap/ema/pm_high/pm_low)."""
        p, t, out = self.p, ts.time(), []
        prev_hod, prev_lod = self.hod, self.lod
        self.hod = max(self.hod, r.high)
        self.lod = min(self.lod, r.low)
        if any(math.isnan(x) for x in (r.vwap, r.ema, r.pm_high, r.pm_low)):
            return out

        if self.side:
            out += self._manage(ts, t, r)
            return out
        if t < p.entry_start or t > p.entry_end or self.trades >= p.max_trades_per_day:
            return out

        # Arm on a 5-min close beyond the pre-market level; disarm when VWAP side is lost.
        if r.close > r.pm_high:
            self.armed_long = True
        if r.close < r.pm_low:
            self.armed_short = True
        if r.close < r.vwap:
            self.armed_long = False
        if r.close > r.vwap:
            self.armed_short = False

        if p.allow_long and self.armed_long and (not p.require_vwap_beyond_pm or r.vwap > r.pm_high):
            if r.low <= r.vwap * (1 + p.touch_tol) and r.close >= r.vwap:
                a = self._enter(ts, "long", r, self.hod)
                if a:
                    out.append(a)
        elif p.allow_short and self.armed_short and (not p.require_vwap_beyond_pm or r.vwap < r.pm_low):
            if r.high >= r.vwap * (1 - p.touch_tol) and r.close <= r.vwap:
                a = self._enter(ts, "short", r, self.lod)
                if a:
                    out.append(a)
        return out

    def _enter(self, ts, side, r, target):
        p = self.p
        risk = max(abs(r.close - r.vwap), p.min_risk_pct * r.close)
        room = (target - r.close) if side == "long" else (r.close - target)
        if room < p.min_rr * risk:
            return None
        self.side, self.entry, self.risk_unit, self.target = side, r.close, risk, target
        self.remaining, self.tp1_done = 1.0, False
        self.trades += 1
        return Action("ENTER", ts, side, r.close, 1.0, "vwap retest", risk, target)

    def _manage(self, ts, t, r) -> list:
        p, s, out = self.p, self.side, []
        long = s == "long"
        if t >= p.flatten_at:
            out.append(Action("EXIT", ts, s, r.open, self.remaining, "time"))
            self._flat()
            return out
        stop_hit = r.close < r.vwap * (1 - p.stop_tol) if long else r.close > r.vwap * (1 + p.stop_tol)
        if stop_hit:  # pessimistic: stop wins if the same bar also reached the target
            out.append(Action("EXIT", ts, s, r.close, self.remaining, "vwap stop"))
            self._flat()
            return out
        if not self.tp1_done and (r.high >= self.target if long else r.low <= self.target):
            f = p.tp1_frac
            out.append(Action("TP1", ts, s, self.target, f, "high/low of day"))
            self.remaining -= f
            self.tp1_done = True
            if self.remaining <= 1e-9:
                self._flat()
                return out
        if self.tp1_done and (r.close < r.ema if long else r.close > r.ema):
            out.append(Action("EXIT", ts, s, r.close, self.remaining, "ema exit"))
            self._flat()
        return out


def run_day(day_df, params: Params) -> list:
    """Replay one day's indicator-enriched 5-min bars; return all actions (deterministic)."""
    st, acts = DayState(params), []
    for ts, r in day_df.iterrows():
        acts += st.on_bar(ts, r)
    last = day_df.iloc[-1] if len(day_df) else None
    if st.side and last is not None:  # data ended while in a position
        acts.append(Action("EXIT", day_df.index[-1], st.side, last.close, st.remaining, "eod"))
    return acts
