# vwap_bot — VWAP retest + 8 EMA strategy

Rules implemented (from the strategy video's transcript), on 5-minute bars, extended-hours VWAP:

1. Mark the pre-market high/low (04:00–09:30 ET).
2. **Long:** 5-min close above the PM high (and, by default, VWAP above the PM high). Wait for a bar that
   touches VWAP and closes back above it → enter at that close. **Short:** mirror with the PM low.
3. **Stop:** a 5-min close beyond VWAP by more than `stop_tol` (0.05%).
4. **Exit:** sell `tp1_frac` (50%) at the high/low of day, the rest on a 5-min close through the 8 EMA.
5. Only trade the first hour (entries until 10:30); flatten at 11:30. Max 2 trades/day.

Interpretations I had to make (the video is not precise): the 50% size, the tolerances, the 1R definition
(distance to VWAP, floored at 0.15% of price), and skipping entries with < 1R of room to the target.
All are in `strategy.Params` — tune on in-sample data only.

## Use
    pip install -r requirements.txt
    export ALPACA_KEY=... ALPACA_SECRET=...              # free paper account
    python -m vwap_bot fetch AAPL MSFT NVDA GOOGL META TSLA --start 2023-01-01T00:00:00Z --end 2025-01-01T00:00:00Z
    python -m vwap_bot backtest data/*.csv               # reports in-sample vs out-of-sample
    python -m vwap_bot backtest data/*.csv --no-vwap-beyond-pm
    python -m vwap_bot live AAPL MSFT                    # PAPER only; `touch KILL` flattens and stops

## Read this before trusting any number
- The creator trades **options**; this tests the **underlying** in R-multiples. Option P&L (the video's "100%")
  needs options history and is much noisier.
- Judge only the **out-of-sample** block. If it isn't clearly positive with a t-stat well above 2 after costs, there
  is no demonstrated edge. Don't loosen rules to make the backtest look better.
- IEX volume is a sample of market volume, so VWAP differs slightly from TradingView's.
- `live.py` has not been run against the Alpaca API (no network in the dev sandbox). Paper trade for weeks first.
- The video's P&L claims are unverified marketing for a paid event. Nothing here guarantees profit.
