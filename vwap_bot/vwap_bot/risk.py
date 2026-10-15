import math
import os
from dataclasses import dataclass


@dataclass
class RiskConfig:
    risk_per_trade: float = 0.005      # fraction of equity risked per trade (1R)
    max_notional_pct: float = 0.25     # max position value as fraction of equity
    daily_loss_limit: float = 0.02     # halt for the day if equity falls this far
    max_open_positions: int = 1
    kill_file: str = "KILL"            # `touch KILL` => flatten and stop immediately


def position_size(equity: float, price: float, risk_unit: float, cfg: RiskConfig) -> int:
    if risk_unit <= 0 or price <= 0:
        return 0
    by_risk = (equity * cfg.risk_per_trade) / risk_unit
    by_notional = (equity * cfg.max_notional_pct) / price
    return max(0, int(math.floor(min(by_risk, by_notional))))


def killed(cfg: RiskConfig) -> bool:
    return os.path.exists(cfg.kill_file)


def daily_loss_hit(equity: float, start_equity: float, cfg: RiskConfig) -> bool:
    return start_equity > 0 and equity <= start_equity * (1 - cfg.daily_loss_limit)
