"""
Forecast for the next 24 hours, 3 days and 7 days (Scenario 2 requirements 3–4).

Starts at the hour after the history ends (normally today 00:00) and uses
  * the Open-Meteo weather forecast (weather.py)
  * the planned family calendar (household.py): who is expected home, shifts, school
  * the trained model (train_model.py): total demand × calibration factor k (no
    under-prediction), per-appliance break-down, and uncertainty bands from the backtest

Output: output/forecast_7d.csv — one row per hour:
  timestamp, hour, weather, pv_kwh_per_kwp (PV forecast for 1 kWp), planned presence
  (<member>_home 0 away / 1 awake / 2 asleep, people_home, marek_shift, home_office, school_day),
  one column per appliance, predicted_total_kwh, low_total_kwh, safe_predicted_total_kwh (upper band),
  peak_kw (short peaks: highest 1-minute power the hour may reach, 90 % level)
It also adds the forecast totals and likely ranges to output/forecast_accuracy.json.

Usage:
    .venv/bin/python forecast.py
"""

import json

import scenario

scenario.ensure_openmp()

import joblib
import numpy as np
import pandas as pd

import features as F
import household
import weather

CONFIG = scenario.load()
HOURS = max(CONFIG["horizon_days"]) * 24


def forecast_weather(start):
    """Forecast weather covering start → start + HOURS (downloads again if the cached file is too short)."""
    w = weather.load("weather_forecast_file") if scenario.path("weather_forecast_file").exists() else weather.forecast()
    if w["timestamp"].max() < start + pd.Timedelta(hours=HOURS - 1) or w["timestamp"].min() > start:
        w = weather.forecast()
    w = w[(w["timestamp"] >= start) & (w["timestamp"] < start + pd.Timedelta(hours=HOURS))]
    if len(w) < HOURS:
        raise SystemExit(f"Weather forecast covers only {len(w)} of {HOURS} hours from {start} — run weather.py.")
    return w.reset_index(drop=True)


def main():
    package = joblib.load(scenario.path("model_file"))
    history = pd.read_csv(scenario.path("history_file"), parse_dates=["timestamp"])
    start = history["timestamp"].max() + pd.Timedelta(hours=1)
    future = forecast_weather(start)

    featured = F.add_features(pd.concat([history[future.columns.intersection(history.columns)], future], ignore_index=True))
    horizon = featured.iloc[len(history):].reset_index(drop=True)

    acc_path = scenario.path("accuracy_file")
    accuracy = json.loads(acc_path.read_text())
    k = accuracy["calibration_factor"]  # updated online by update_model.py
    total = package["model"].predict(horizon, history[F.TOTAL].to_numpy()) * k
    parts = package["breakdown"].predict_appliances(horizon)
    scale = np.divide(total, parts.sum(axis=1), out=np.zeros_like(total), where=parts.sum(axis=1) > 0)
    parts = parts * scale[:, None]

    bands = package["bands"]
    hour = horizon["hour"].to_numpy()
    out = pd.DataFrame({
        "timestamp": horizon["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S"),
        "hour": hour,
        "outdoor_temp_c": future["outdoor_temp_c"].round(1),
        "radiation_w_m2": future["radiation_w_m2"].round(0),
        "pv_kwh_per_kwp": weather.pv_per_kwp_from_weather(future["gti_w_m2"]).round(4),
    })
    plan = household.calendar(start.date(), horizon["timestamp"].max().date(), actual=False).iloc[:HOURS].reset_index(drop=True)
    for col in [f"{m}_home" for m in scenario.member_ids()] + ["people_home", "marek_shift", "home_office", "school_day"]:
        out[col] = plan[col]
    out["free_day"] = horizon["free_day"]
    for j, app in enumerate(package["targets"]):
        out[app] = parts[:, j].round(4)
    out["predicted_total_kwh"] = total.round(4)
    out["low_total_kwh"] = np.clip(total + np.array(bands["hour_low"])[hour], 0, None).round(4)
    out["safe_predicted_total_kwh"] = (total + np.clip(np.array(bands["hour_high"])[hour], 0, None)).round(4)
    # highest 1-minute power of the hour (never below the hourly average)
    out["peak_kw"] = np.maximum(package["peak"].predict(horizon), total).round(3) if "peak" in package else total.round(3)
    out["actual_total_kwh"] = ""  # the future — filled by live meter readings in the dashboard
    out.to_csv(scenario.path("forecast_file"), index=False)

    # Totals and likely ranges per period (from the backtest error distribution)
    periods = {}
    print(f"\nForecast from {start:%a %d %b %Y %H:%M} · model {package['name']} (×{k:.3f}, trained until {package['trained_until'][:10]})")
    print(f"{'Period':<9}{'Forecast':>11}{'Likely range':>20}{'Avg temp':>10}   Highest hours")
    for days in CONFIG["horizon_days"]:
        part = out.iloc[: days * 24]
        f = float(part["predicted_total_kwh"].sum())
        e_lo, e_hi = bands["period"][str(days)]          # relative over-forecast (forecast − actual) / actual
        # the calibrated forecast leans high on purpose, so the range always includes it
        low, high = min(f / (1 + e_hi), f), max(f / (1 + e_lo), f)
        top = part.nlargest(3, "predicted_total_kwh")
        periods[str(days)] = {"forecast_kwh": round(f, 1), "low_kwh": round(low, 1), "high_kwh": round(high, 1)}
        label = "24 h" if days == 1 else f"{days} days"
        peaks = ", ".join(f"{pd.Timestamp(t):%a %H:00}" for t in top["timestamp"])
        print(f"{label:<9}{f:>8.1f} kWh{low:>10.1f} – {high:.1f} kWh{part['outdoor_temp_c'].mean():>8.1f} °C   {peaks}")
    accuracy["forecast"] = {"start": str(start), "periods": periods}
    acc_path.write_text(json.dumps(accuracy, indent=2))
    print(f"\nSaved {scenario.rel(scenario.path('forecast_file'))}")


if __name__ == "__main__":
    main()
