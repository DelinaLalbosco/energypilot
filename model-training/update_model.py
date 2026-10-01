"""
Online + cumulative learning from live meter readings.

Reads data/live_readings.csv (written by the backend's POST /api/readings or by
meter_simulator.py --offline) and:

  1. Online calibration — compares the readings with the forecast for the same hours
     and nudges the calibration factor k:  k ← k · (1 − a + a · measured/forecast).
     Asymmetric, because under-prediction is worse than over-prediction: a = α when the
     meter shows MORE than forecast, α/4 when it shows less, and k never drops below
     95 % of the backtest calibration. The forecast reacts without re-training.
  2. Cumulative learning — every complete measured day (24 readings) after the end of
     the history is appended to data/history.csv (weather from the forecast file,
     planned calendar; missing appliance columns are split by the forecast shares),
     then the model is re-trained on ALL data (train_model.py --quick).
  3. Refresh — forecast.py and smart_optimizer.py run again, so the forecast starts
     after the newest measured day and the dashboard updates automatically.

Every run is logged in output/learning_log.json.

Usage:
    .venv/bin/python update_model.py
    .venv/bin/python update_model.py --alpha 0.5     # react faster to the latest readings
"""

import argparse
import json
from datetime import datetime

import scenario

scenario.ensure_openmp()  # before any work: it may restart the process once (macOS)

import numpy as np
import pandas as pd

import household

CONFIG = scenario.load()
TOTAL = CONFIG["data"]["total_column"]
APPLIANCES = scenario.appliance_ids()
LOG = scenario.path("accuracy_file").with_name("learning_log.json")


def load_readings():
    path = scenario.path("readings_file")
    if not path.exists():
        raise SystemExit("No readings yet — send some with meter_simulator.py (or POST /api/readings).")
    r = pd.read_csv(path, parse_dates=["timestamp"])
    return r.dropna(subset=["total_kwh"]).drop_duplicates("timestamp", keep="last").sort_values("timestamp")


def online_calibration(readings, alpha):
    """Update k from measured vs forecast on the hours both exist."""
    forecast = pd.read_csv(scenario.path("forecast_file"), parse_dates=["timestamp"])
    both = forecast.merge(readings[["timestamp", "total_kwh"]], on="timestamp")
    acc_path = scenario.path("accuracy_file")
    accuracy = json.loads(acc_path.read_text())
    k_old = accuracy["calibration_factor"]
    if both.empty:
        return k_old, k_old, 0, None
    ratio = both["total_kwh"].sum() / max(both["predicted_total_kwh"].sum(), 1e-6)
    rate = alpha if ratio > 1 else alpha / 4
    floor = 0.95 * accuracy.get("calibration_backtest", k_old)
    k_new = float(np.clip(k_old * (1 - rate + rate * ratio), floor, 1.5))
    accuracy["calibration_factor"] = round(k_new, 4)
    acc_path.write_text(json.dumps(accuracy, indent=2))
    return k_old, k_new, len(both), float(ratio)


def append_complete_days(readings):
    """Append complete measured days after the history end. Returns the number of days added."""
    history = pd.read_csv(scenario.path("history_file"), parse_dates=["timestamp"])
    new = readings[readings["timestamp"] > history["timestamp"].max()]
    days = [d for d, g in new.groupby(new["timestamp"].dt.date) if len(g) == 24]
    if not days:
        return 0, history["timestamp"].max()
    forecast = pd.read_csv(scenario.path("forecast_file"), parse_dates=["timestamp"])
    weather = pd.read_csv(scenario.path("weather_forecast_file"), parse_dates=["timestamp"])
    rows = new[new["timestamp"].dt.date.isin(days)].merge(weather, on="timestamp", how="left")
    fc_cols = [c for c in ("peak_kw", "predicted_total_kwh") if c in forecast]
    rows = rows.merge(forecast[["timestamp", *APPLIANCES, *fc_cols]].rename(columns={a: f"fc_{a}" for a in APPLIANCES + fc_cols}),
                      on="timestamp", how="left")
    for a in APPLIANCES:  # appliance break-down missing → split the measured total by the forecast shares
        share = rows[f"fc_{a}"] / rows[[f"fc_{x}" for x in APPLIANCES]].sum(axis=1).replace(0, np.nan)
        rows[a] = rows[a] if a in rows and rows[a].notna().all() else (rows["total_kwh"] * share.fillna(0)).round(4)
    rows[TOTAL] = rows[APPLIANCES].sum(axis=1).round(4)
    # meters report hourly kWh only: short peak estimated with the forecast's peak-to-average ratio
    ratio = (rows["fc_peak_kw"] / rows["fc_predicted_total_kwh"].replace(0, np.nan)).fillna(1) if "fc_peak_kw" in rows else 1
    rows["peak_kw"] = np.maximum(rows[TOTAL] * ratio, rows[TOTAL]).round(3)
    cal = household.calendar(days[0], days[-1], actual=False)
    rows = rows.merge(cal, on="timestamp", how="left")
    out = pd.concat([history, rows[[c for c in history.columns if c in rows]]], ignore_index=True)
    out.to_csv(scenario.path("history_file"), index=False)
    return len(days), out["timestamp"].max()


def main():
    parser = argparse.ArgumentParser(description="Learn from live meter readings.")
    parser.add_argument("--alpha", type=float, default=0.3, help="online learning rate for the calibration factor")
    args = parser.parse_args()

    readings = load_readings()
    print(f"Readings: {len(readings)} hours ({readings['timestamp'].min():%d %b %H:00} → {readings['timestamp'].max():%d %b %H:00})")

    k_old, k_new, matched, ratio = online_calibration(readings, args.alpha)
    if matched:
        print(f"1. Online calibration: {matched} hours measured {ratio:.2f}× the forecast → k {k_old:.3f} → {k_new:.3f}")
    else:
        print("1. Online calibration: no readings overlap the current forecast — k unchanged")

    added, until = append_complete_days(readings)
    print(f"2. Cumulative learning: {added} complete day(s) added to the history (now until {until:%d %b %Y %H:00})")

    import forecast
    import smart_optimizer
    import train_model

    if added:
        train_model.quick()
    print("3. Refreshing forecast and plan...")
    forecast.main()
    smart_optimizer.main()

    log = json.loads(LOG.read_text()) if LOG.exists() else []
    log.append({"at": datetime.now().isoformat(timespec="seconds"), "readings": len(readings), "matched_hours": matched,
                "measured_vs_forecast": round(ratio, 3) if ratio else None, "k_before": k_old, "k_after": round(k_new, 4),
                "days_added": added, "history_until": str(until)})
    LOG.write_text(json.dumps(log, indent=2))
    print(f"Logged in {scenario.rel(LOG)}")


if __name__ == "__main__":
    main()
