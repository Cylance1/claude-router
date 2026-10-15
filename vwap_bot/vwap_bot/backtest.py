from dataclasses import dataclass

import numpy as np
import pandas as pd

from .indicators import add_indicators
from .strategy import Params, run_day


@dataclass
class Costs:
    slippage_bps: float = 2.0   # adverse, per fill
    commission_per_share: float = 0.0


def backtest(bars5: pd.DataFrame, params: Params, costs: Costs = Costs(), symbol: str = "") -> pd.DataFrame:
    """Return one row per trade with P&L in R (1R = the entry's risk_unit) and in % of price."""
    d = add_indicators(bars5)
    trades = []
    for day, g in d.groupby("date"):
        g = g.drop(columns="date")
        acts = run_day(g, params)
        cur = None
        for a in acts:
            slip = costs.slippage_bps / 1e4
            sgn = 1 if a.side == "long" else -1
            if a.kind == "ENTER":
                fill = a.price * (1 + sgn * slip)
                cur = dict(symbol=symbol, date=day, side=a.side, entry_time=a.ts, entry=fill,
                           risk_unit=a.risk_unit, pnl_price=0.0, exit_time=None, exit_reason="")
            elif cur is not None:
                fill = a.price * (1 - sgn * slip)
                cur["pnl_price"] += a.frac * sgn * (fill - cur["entry"]) - 2 * costs.commission_per_share * a.frac
                cur["exit_time"], cur["exit_reason"] = a.ts, a.reason
                if a.kind == "EXIT":
                    trades.append(cur)
                    cur = None
        if cur is not None:  # TP1 fully closed the position (tp1_frac == 1)
            trades.append(cur)
    t = pd.DataFrame(trades)
    if t.empty:
        return t
    t["r"] = t["pnl_price"] / t["risk_unit"]
    t["pct"] = 100 * t["pnl_price"] / t["entry"]
    return t


def summarize(t: pd.DataFrame) -> dict:
    if t.empty:
        return {"trades": 0}
    r = t["r"]
    wins, losses = r[r > 0].sum(), -r[r <= 0].sum()
    eq = r.cumsum()
    return {
        "trades": len(t),
        "win_rate": round(float((r > 0).mean()), 3),
        "avg_R": round(float(r.mean()), 3),
        "total_R": round(float(r.sum()), 2),
        "profit_factor": round(float(wins / losses), 2) if losses > 0 else float("inf"),
        "max_drawdown_R": round(float((eq.cummax() - eq).max()), 2),
        "avg_win_R": round(float(r[r > 0].mean()), 2) if (r > 0).any() else 0.0,
        "avg_loss_R": round(float(r[r <= 0].mean()), 2) if (r <= 0).any() else 0.0,
        "t_stat": round(float(r.mean() / (r.std(ddof=1) / np.sqrt(len(r)))), 2) if len(r) > 2 and r.std() > 0 else 0.0,
    }


def split_report(t: pd.DataFrame, oos_frac: float = 0.3) -> dict:
    """Chronological in-sample / out-of-sample split. Judge the strategy on the OOS half only."""
    if t.empty:
        return {}
    t = t.sort_values("entry_time")
    cut = int(len(t) * (1 - oos_frac))
    return {"in_sample": summarize(t.iloc[:cut]), "out_of_sample": summarize(t.iloc[cut:])}
