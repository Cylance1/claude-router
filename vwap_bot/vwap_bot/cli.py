import argparse
import json
import logging
import os

import pandas as pd

from .backtest import Costs, backtest, split_report, summarize
from .data import ET, fetch_alpaca, load_csv, resample_5m
from .live import run
from .risk import RiskConfig
from .strategy import Params


def main():
    ap = argparse.ArgumentParser(prog="vwap_bot")
    sub = ap.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("fetch", help="download 1-min bars from Alpaca to data/<SYM>.csv")
    f.add_argument("symbols", nargs="+"); f.add_argument("--start", required=True); f.add_argument("--end", required=True)

    b = sub.add_parser("backtest")
    b.add_argument("csv", nargs="+", help="data/<SYM>.csv (1-min bars)")
    b.add_argument("--slippage-bps", type=float, default=2.0)
    b.add_argument("--no-vwap-beyond-pm", action="store_true", help="drop the 'VWAP beyond pre-market level' filter")
    b.add_argument("--no-short", action="store_true")
    b.add_argument("--out", default="trades.csv")

    l = sub.add_parser("live", help="paper trading loop"); l.add_argument("symbols", nargs="+")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if a.cmd == "fetch":
        os.makedirs("data", exist_ok=True)
        for s in a.symbols:
            df = fetch_alpaca(s, a.start, a.end, os.environ["ALPACA_KEY"], os.environ["ALPACA_SECRET"])
            df.index.name = "timestamp"; df.to_csv(f"data/{s}.csv")
            print(s, len(df), "bars")
    elif a.cmd == "backtest":
        p = Params(require_vwap_beyond_pm=not a.no_vwap_beyond_pm, allow_short=not a.no_short)
        allt = []
        for path in a.csv:
            sym = os.path.splitext(os.path.basename(path))[0]
            allt.append(backtest(resample_5m(load_csv(path)), p, Costs(a.slippage_bps), sym))
        t = pd.concat([x for x in allt if not x.empty], ignore_index=True) if any(not x.empty for x in allt) else pd.DataFrame()
        t.to_csv(a.out, index=False)
        print(json.dumps({"all": summarize(t), **split_report(t)}, indent=2))
    else:
        run(a.symbols, Params(), RiskConfig())


if __name__ == "__main__":
    main()
