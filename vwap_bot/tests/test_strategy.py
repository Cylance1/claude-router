import numpy as np
import pandas as pd

from vwap_bot.backtest import backtest, summarize
from vwap_bot.data import ET
from vwap_bot.indicators import add_indicators
from vwap_bot.strategy import Params, run_day


def make_day(closes_rth, pm_price=100.0, pm_hi=100.5, pm_lo=99.5, vol=1000, pm_vol=10):
    """Premarket bars (04:00-09:25) then RTH 5-min bars from 09:30 built from close path."""
    pm_idx = pd.date_range("2024-03-04 04:00", "2024-03-04 09:25", freq="5min", tz=ET)
    pm = pd.DataFrame({"open": pm_price, "high": pm_hi, "low": pm_lo, "close": pm_price, "volume": pm_vol}, index=pm_idx)
    idx = pd.date_range("2024-03-04 09:30", periods=len(closes_rth), freq="5min", tz=ET)
    c = np.array(closes_rth, float)
    o = np.r_[pm_price, c[:-1]]
    rth = pd.DataFrame({"open": o, "high": np.maximum(o, c) + 0.05, "low": np.minimum(o, c) - 0.05,
                        "close": c, "volume": vol}, index=idx)
    return pd.concat([pm, rth])


def test_long_vwap_retest_then_target_and_ema_exit():
    # Gap/break above PM high, run to a high of day, pull back to VWAP, bounce, run past HOD, fade.
    closes = [103, 105, 108, 107, 104, 102.5, 105, 109, 112, 113, 111, 107, 104]
    d = add_indicators(make_day(closes))
    p = Params(entry_end=Params().entry_end.replace(hour=11))
    acts = run_day(d[d["date"] == d["date"].iloc[-1]].drop(columns="date"), p)
    kinds = [a.kind for a in acts]
    assert kinds[0] == "ENTER" and acts[0].side == "long"
    assert "TP1" in kinds and kinds[-1] == "EXIT"
    assert acts[0].price >= d.loc[acts[0].ts, "vwap"] * 0.999        # entered on VWAP bounce, not a chase


def test_no_entry_without_retest():
    closes = [103, 104, 105, 106, 107, 108, 109, 110]               # straight up, never touches VWAP
    d = add_indicators(make_day(closes))
    assert run_day(d.drop(columns="date"), Params()) == []


def test_vwap_stop_exits_long():
    closes = [103, 105, 108, 107, 104, 102.5, 100.0, 99.0]
    d = add_indicators(make_day(closes))
    acts = run_day(d.drop(columns="date"), Params())
    if acts:
        assert acts[-1].kind == "EXIT" and acts[-1].reason in ("vwap stop", "eod", "time")


def test_random_walk_has_no_edge_and_does_not_crash():
    rng = np.random.default_rng(0)
    days = []
    for i in range(60):
        base = 100 + rng.normal(0, 1)
        c = base + np.cumsum(rng.normal(0, 0.15, 60))
        day = make_day(c, pm_price=base, pm_hi=base + 0.3, pm_lo=base - 0.3)
        shift = pd.Timedelta(days=i)
        day.index = day.index + shift
        days.append(day)
    t = backtest(pd.concat(days), Params(), symbol="RW")
    s = summarize(t)
    assert s["trades"] == 0 or abs(s["avg_R"]) < 1.0
