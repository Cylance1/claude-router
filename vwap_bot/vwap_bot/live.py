"""Paper-trading loop (Alpaca paper API, shares). NOT validated against the live API in this repo's
dev environment (no network access there) -- run it on paper for weeks and watch the logs.

Design: every closed 5-min bar, re-fetch recent 1-min bars, rebuild 5-min bars + indicators, replay
today's bars through a fresh DayState, and execute only actions not yet executed. Stateless replay
means a restart never re-trades actions that were already generated before startup.
"""
import logging
import os
import time as _time
from datetime import datetime, timedelta

import requests

from .data import ET, fetch_alpaca, resample_5m
from .indicators import add_indicators
from .risk import RiskConfig, daily_loss_hit, killed, position_size
from .strategy import DayState, Params

import pandas as pd

log = logging.getLogger("vwap_bot")
PAPER = "https://paper-api.alpaca.markets"


class Broker:
    def __init__(self, key, secret, base=PAPER):
        if "paper-api" not in base:
            raise SystemExit("Refusing to run: this bot is paper-only. Validate for weeks before changing that.")
        self.base, self.h = base, {"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret}

    def _req(self, m, path, **kw):
        r = requests.request(m, self.base + path, headers=self.h, timeout=30, **kw)
        if r.status_code >= 400 and r.status_code != 404:
            log.error("%s %s -> %s %s", m, path, r.status_code, r.text)
            r.raise_for_status()
        return r

    def account(self): return self._req("GET", "/v2/account").json()
    def position_qty(self, sym):
        r = self._req("GET", f"/v2/positions/{sym}")
        return 0 if r.status_code == 404 else float(r.json()["qty"])
    def order(self, sym, qty, side, **extra):
        body = dict(symbol=sym, qty=str(int(qty)), side=side, type="market", time_in_force="day", **extra)
        return self._req("POST", "/v2/orders", json=body).json()
    def limit(self, sym, qty, side, price):
        body = dict(symbol=sym, qty=str(int(qty)), side=side, type="limit",
                    limit_price=str(round(price, 2)), time_in_force="day")
        return self._req("POST", "/v2/orders", json=body).json()
    def cancel_orders(self, sym):
        for o in self._req("GET", "/v2/orders", params={"status": "open", "symbols": sym}).json():
            self._req("DELETE", f"/v2/orders/{o['id']}")
    def close(self, sym):
        self.cancel_orders(sym)
        self._req("DELETE", f"/v2/positions/{sym}")


def run(symbols, params: Params, risk: RiskConfig, key=None, secret=None, poll_buffer=5):
    key, secret = key or os.environ["ALPACA_KEY"], secret or os.environ["ALPACA_SECRET"]
    br = Broker(key, secret, os.environ.get("ALPACA_BASE", PAPER))
    start_equity = float(br.account()["last_equity"])
    done = {s: 0 for s in symbols}      # actions already executed per symbol
    orig = {}                           # original qty per open position
    halted = False
    log.info("started: %s, equity %.2f", symbols, start_equity)

    while True:
        now = datetime.now(pd.Timestamp.now(tz=ET).tz)
        if now.weekday() >= 5 or now.time() > params.flatten_at.replace(minute=params.flatten_at.minute + 10):
            log.info("outside trading window, exiting"); return
        nxt = (now.replace(second=0, microsecond=0) + timedelta(minutes=5 - now.minute % 5))
        _time.sleep(max(1, (nxt - now).total_seconds() + poll_buffer))

        equity = float(br.account()["equity"])
        if killed(risk) or daily_loss_hit(equity, start_equity, risk):
            if not halted:
                log.warning("HALT (kill file or daily loss limit): flattening")
                for s in symbols: br.close(s)
            halted = True
            if killed(risk): return
            continue

        for s in symbols:
            try:
                tick(br, s, params, risk, equity, done, orig)
            except Exception:
                log.exception("error handling %s; skipping this cycle", s)


def tick(br, s, params, risk, equity, done, orig):
    now = pd.Timestamp.now(tz=ET)
    start = (now - pd.Timedelta(days=4)).strftime("%Y-%m-%dT00:00:00Z")
    d1 = fetch_alpaca(s, start, now.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
                      br.h["APCA-API-KEY-ID"], br.h["APCA-API-SECRET-KEY"])
    b5 = resample_5m(d1)
    b5 = b5[b5.index + pd.Timedelta(minutes=5) <= now]        # closed bars only
    d = add_indicators(b5)
    today = d[d["date"] == now.date()].drop(columns="date")
    st, acts = DayState(params), []
    for ts, r in today.iterrows():
        acts += st.on_bar(ts, r)
    for a in acts[done[s]:]:
        log.info("%s %s %s @%.2f (%s)", s, a.kind, a.side, a.price, a.reason)
        if a.kind == "ENTER":
            if br.position_qty(s) != 0:
                continue
            qty = position_size(equity, a.price, a.risk_unit, risk)
            if qty < 1:
                log.warning("%s size < 1 share; skipped", s); continue
            orig[s] = qty
            br.order(s, qty, "buy" if a.side == "long" else "sell")
            tp_qty = int(qty * params.tp1_frac)
            if tp_qty >= 1:
                br.limit(s, tp_qty, "sell" if a.side == "long" else "buy", a.target)
        elif a.kind == "TP1":
            br.cancel_orders(s)  # limit may have filled already; top up if not
            want_left = orig.get(s, 0) - int(orig.get(s, 0) * params.tp1_frac)
            have = abs(br.position_qty(s))
            if have > want_left:
                br.order(s, have - want_left, "sell" if a.side == "long" else "buy")
        else:
            br.close(s)
    done[s] = len(acts)
