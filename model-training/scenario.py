"""
Loads scenario.json — the single place for everything scenario-specific
(household, family calendar, appliances, tariff, heating, solar, file paths).
Every Python script and the dashboard backend read it.
"""

import importlib.util
import json
import os
import re
import sys
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np

BASE_DIR = Path(__file__).resolve().parent
# ENERGY_SCENARIO=other.json switches scenario without editing scenario.json
SCENARIO_FILE = Path(os.environ.get("ENERGY_SCENARIO", BASE_DIR / "scenario.json"))


@lru_cache(maxsize=1)
def load():
    with open(SCENARIO_FILE, encoding="utf-8") as f:
        config = json.load(f)

    prices = config["tariff"]["hourly_price"]
    if len(prices) != 24:
        raise SystemExit(f"scenario.json: tariff.hourly_price needs 24 values, found {len(prices)}")
    room_ids = {r["id"] for r in config["rooms"]}
    for a in config["appliances"]:
        if a["room"] not in room_ids:
            raise SystemExit(f"scenario.json: appliance {a['id']} uses unknown room '{a['room']}'")
    return config


def ensure_openmp():
    """
    macOS: XGBoost needs the OpenMP runtime (libomp). If Homebrew's libomp is
    missing, relaunch once with the copy bundled in scikit-learn on the library
    search path. (`brew install libomp` makes this unnecessary.)
    Call before importing xgboost.
    """
    if (
        sys.platform == "darwin"
        and not Path("/opt/homebrew/opt/libomp/lib/libomp.dylib").exists()
        and "DYLD_FALLBACK_LIBRARY_PATH" not in os.environ
    ):
        spec = importlib.util.find_spec("sklearn")
        if spec and spec.origin:
            dylibs = Path(spec.origin).parent / ".dylibs"
            if (dylibs / "libomp.dylib").exists():
                os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = str(dylibs)
                os.execv(sys.executable, [sys.executable, *sys.argv])


def path(key):
    """Absolute path of a file listed under "data" (folders are created on demand)."""
    p = (BASE_DIR / load()["data"][key]).resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def rel(p):
    """A path shown relative to model-training/ (e.g. ../data/history.csv) for log messages."""
    return os.path.relpath(p, BASE_DIR)


def history_range():
    """(first day, last day) of the simulated history; "yesterday" follows the clock."""
    data = load()["data"]
    start = date.fromisoformat(data["history_start"])
    end = data["history_end"]
    end = date.today() - timedelta(days=1) if end == "yesterday" else date.fromisoformat(end)
    return start, end


def appliance_ids():
    return [a["id"] for a in load()["appliances"]]


def member_ids():
    return [m["id"] for m in load()["members"]]


def electricity_price(hour):
    return load()["tariff"]["hourly_price"][int(hour) % 24]


def window_hours(window):
    """[start, end) clock hours; wraps past midnight when start > end (e.g. [21, 7])."""
    start, end = window
    if start < end:
        return list(range(start, end))
    return list(range(start, 24)) + list(range(0, end))


def flexible_appliances():
    """{column: {"name", "hours", "label"}} for appliances the optimiser may move."""
    return {
        a["id"]: {"name": a["name"], "hours": window_hours(a["flexible"]["window"]), "label": a["flexible"].get("label", "")}
        for a in load()["appliances"]
        if a.get("flexible")
    }


def heating():
    """Heating settings, or None when the scenario has no shiftable heating."""
    h = load().get("heating") or {}
    return h if h.get("enabled") else None


def heating_share(mean_24h):
    """Share of the heat demand the heat pump covers, from the 24-hour mean outdoor temperature:
    all of it below heating_limit_c − band/2, none above heating_limit_c + band/2, linear in between
    (fades out in spring and autumn instead of switching off at one temperature)."""
    h = load()["heating"]
    top = h["heating_limit_c"] + h["heating_limit_band_c"] / 2
    return np.clip((top - np.asarray(mean_24h, dtype=float)) / h["heating_limit_band_c"], 0, 1)


def comfort_levels():
    """Comfort bands the optimiser plans for (one plan per band)."""
    h = heating()
    if not h:
        return [{"id": "standard", "label": "Comfort"}]
    return h.get("comfort_levels") or [
        {"id": "standard", "label": "Comfort", **{k: h[k] for k in ("day_min", "day_max", "night_min", "night_max")}}
    ]


def usual_column(column):
    return re.sub(r"_kwh$", "", column) + "_usual_kwh"


def opt_column(column):
    return re.sub(r"_kwh$", "", column) + "_opt_kwh"
