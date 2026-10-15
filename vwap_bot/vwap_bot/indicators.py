from datetime import time

import pandas as pd

PM_START = time(4, 0)
RTH_START = time(9, 30)


def add_indicators(df: pd.DataFrame, ema_len: int = 8) -> pd.DataFrame:
    """Add session VWAP, EMA and per-day pre-market high/low to ET-indexed OHLCV bars.

    VWAP resets each calendar day and includes extended hours (matches TradingView's
    "session extended" setting). Pre-market levels are only meaningful on bars at or
    after 09:30, which is the only place the strategy reads them.
    """
    d = df.copy()
    d["date"] = d.index.date
    tp = (d["high"] + d["low"] + d["close"]) / 3
    cum_vol = d["volume"].groupby(d["date"]).cumsum()
    d["vwap"] = (tp * d["volume"]).groupby(d["date"]).cumsum() / cum_vol.where(cum_vol > 0)
    d["ema"] = d["close"].ewm(span=ema_len, adjust=False).mean()
    t = pd.Series(d.index.time, index=d.index)
    pm = (t >= PM_START) & (t < RTH_START)
    d["pm_high"] = d["high"].where(pm).groupby(d["date"]).transform("max")
    d["pm_low"] = d["low"].where(pm).groupby(d["date"]).transform("min")
    return d
