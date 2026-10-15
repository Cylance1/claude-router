import pandas as pd
import requests

ET = "America/New_York"
OHLCV = ["open", "high", "low", "close", "volume"]


def load_csv(path: str) -> pd.DataFrame:
    """CSV with columns timestamp,open,high,low,close,volume (timestamp ISO; naive = ET)."""
    df = pd.read_csv(path)
    ts = pd.to_datetime(df.pop("timestamp"))
    ts = ts.dt.tz_localize(ET) if ts.dt.tz is None else ts.dt.tz_convert(ET)
    df.index = pd.DatetimeIndex(ts, name="timestamp")
    return df[OHLCV].sort_index()


def resample_5m(df1: pd.DataFrame) -> pd.DataFrame:
    """1-min -> 5-min bars labelled by bar START."""
    agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    return df1.resample("5min", label="left", closed="left").agg(agg).dropna(subset=["open"])


def fetch_alpaca(symbol, start, end, key, secret, feed="iex") -> pd.DataFrame:
    """1-min bars from Alpaca's market-data API (IEX feed volume is a partial sample, so VWAP
    will differ slightly from TradingView; use feed='sip' with a paid plan for fidelity)."""
    url = f"https://data.alpaca.markets/v2/stocks/{symbol}/bars"
    hdr = {"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret}
    params = {"timeframe": "1Min", "start": start, "end": end, "limit": 10000,
              "feed": feed, "adjustment": "split"}
    rows = []
    while True:
        r = requests.get(url, headers=hdr, params=params, timeout=30)
        r.raise_for_status()
        j = r.json()
        rows += j.get("bars") or []
        if not j.get("next_page_token"):
            break
        params["page_token"] = j["next_page_token"]
    if not rows:
        return pd.DataFrame(columns=OHLCV, index=pd.DatetimeIndex([], tz=ET))
    df = pd.DataFrame(rows).rename(columns={"t": "timestamp", "o": "open", "h": "high",
                                            "l": "low", "c": "close", "v": "volume"})
    df.index = pd.DatetimeIndex(pd.to_datetime(df["timestamp"], utc=True).dt.tz_convert(ET))
    return df[OHLCV].astype(float).sort_index()
