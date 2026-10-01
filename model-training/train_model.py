"""
Chooses, calibrates and trains the forecasting model (Scenario 2 requirement 2).

1. Candidates (scenario.json → model.candidates)
     seasonal_naive     same hour last week (baseline)
     ridge              linear regression on the model inputs
     hist_gbm           gradient-boosted trees (scikit-learn), total demand
     xgboost_direct     XGBoost, one output per appliance, total = sum
     xgboost_recursive  XGBoost on the total with yesterday / last-week demand as inputs,
                        forecast day by day (each day uses the days predicted before it)
     ensemble           average of hist_gbm and xgboost_direct
     lstm, gru          recurrent neural networks (PyTorch) over the last 24 h of inputs
2. Rolling backtest (cumulative learning): test weeks in winter, spring and the most
   recent weeks. For each week the model is trained only on the data before it and
   forecasts the next 7 days, with realistic weather-forecast errors added.
   Ranking: hourly error + daily-total error of the calibrated forecast (step 3).
3. No under-prediction: the winner's forecast is multiplied by a factor k so that
   at most (1 − q) of the backtest days are under-predicted (q = no_underprediction_quantile),
   and hourly / period uncertainty bands are measured from the backtest residuals.
4. The winner is re-trained on the whole history and saved to models/energy_model.pkl.
   Appliance break-down: the xgboost_direct per-appliance model, scaled to the winner's total.

Outputs: models/energy_model.pkl, output/model_comparison.csv, output/backtest.csv,
         output/forecast_accuracy.json

Usage:
    .venv/bin/python train_model.py           # compare models + backtest + train (≈ 2 min)
    .venv/bin/python train_model.py --quick   # keep the chosen model & calibration, only re-train on all data
"""

import argparse
import json
from datetime import datetime

import scenario

scenario.ensure_openmp()

import joblib
import numpy as np
import pandas as pd

import features as F
from models import ApplianceModel, PeakModel, make

CONFIG = scenario.load()
MODEL_CFG = CONFIG["model"]
TOTAL = F.TOTAL
HORIZON = max(CONFIG["horizon_days"]) * 24
WEATHER_COLS = ["timestamp", "outdoor_temp_c", "radiation_w_m2"]


# ============================================================ data

def load_history():
    df = pd.read_csv(scenario.path("history_file"), parse_dates=["timestamp"])
    return F.add_features(df)


def forecast_weather_noise(horizon, seed):
    """Weather-forecast error: grows with lead time (≈ 0.6 °C day 1 → 2 °C day 7), radiation ±25 %."""
    rng = np.random.default_rng(seed)
    lead_days = np.arange(len(horizon)) / 24
    walk = pd.Series(rng.normal(0, 1, len(horizon))).rolling(6, min_periods=1).mean().to_numpy() * 2
    h = horizon.copy()
    h["outdoor_temp_c"] = h["outdoor_temp_c"] + walk * (0.6 + 0.2 * lead_days)
    h["radiation_w_m2"] = (h["radiation_w_m2"] * np.clip(1 + rng.normal(0, 0.25, len(h)), 0.3, 1.7)).round(1)
    return h


def backtest_origins(raw):
    """Start rows of the backtest weeks: a few across the seasons (winter heating!) + the most recent weeks."""
    seasonal = [int(raw.index[raw["timestamp"] == pd.Timestamp(d)][0]) for d in MODEL_CFG["backtest_season_weeks"]
                if (raw["timestamp"] == pd.Timestamp(d)).any()]
    recent = [len(raw) - HORIZON - 168 * k for k in range(MODEL_CFG["backtest_weeks"] - 1, -1, -1)]
    return sorted(set(seasonal + recent))


def backtest(names):
    """Rolling-origin backtest. Returns hourly results (model, origin, timestamp, forecast, actual)."""
    raw = pd.read_csv(scenario.path("history_file"), parse_dates=["timestamp"])
    origins = backtest_origins(raw)
    rows = []
    for n, origin in enumerate(origins):
        # history up to the origin with real weather, the next 7 days with forecast-quality weather
        past = raw.iloc[:origin]
        future = forecast_weather_noise(raw.iloc[origin: origin + HORIZON], seed=n)
        featured = F.add_features(pd.concat([past, future], ignore_index=True))
        train, horizon = featured.iloc[:origin], featured.iloc[origin: origin + HORIZON]
        known = raw[TOTAL].iloc[:origin].to_numpy()
        actual = raw[TOTAL].iloc[origin: origin + HORIZON].to_numpy()
        print(f"  week {n + 1}/{len(origins)}: train until {raw['timestamp'].iloc[origin - 1]:%d %b}, "
              f"forecast {raw['timestamp'].iloc[origin]:%d %b} → {raw['timestamp'].iloc[origin + HORIZON - 1]:%d %b}")
        for name in names:
            pred = make(name).fit(train).predict(horizon, known)
            rows.append(pd.DataFrame({"model": name, "origin": n, "lead": np.arange(HORIZON),
                                      "timestamp": horizon["timestamp"].to_numpy(), "forecast": pred, "actual": actual}))
    return pd.concat(rows, ignore_index=True)


# ============================================================ metrics & calibration

def period_errors(bt, days):
    """Relative error of the total over the first `days` days of every backtest week."""
    part = bt[bt["lead"] < days * 24].groupby("origin")[["forecast", "actual"]].sum()
    return (part["forecast"] - part["actual"]) / part["actual"]


def score(bt):
    daily = bt.assign(day=bt["lead"] // 24).groupby(["origin", "day"])[["forecast", "actual"]].sum()
    return {
        "hourly_mae_kwh": float((bt["forecast"] - bt["actual"]).abs().mean()),
        "hourly_mae_pct": float((bt["forecast"] - bt["actual"]).abs().mean() / bt["actual"].mean() * 100),
        "daily_abs_error_pct": float(((daily["forecast"] - daily["actual"]).abs() / daily["actual"]).mean() * 100),
        "bias_pct": float((bt["forecast"].sum() / bt["actual"].sum() - 1) * 100),
        "hours_under_pct": float((bt["forecast"] < bt["actual"]).mean() * 100),
        "days_under_pct": float((daily["forecast"] < daily["actual"]).mean() * 100),
        **{f"error_{d}d_pct": float(period_errors(bt, d).abs().mean() * 100) for d in CONFIG["horizon_days"]},
    }


def peak_check(history):
    """Train the short-peak model on everything but the last 4 weeks and test it on them."""
    split = len(history) - 4 * 168
    model = PeakModel(MODEL_CFG["upper_quantile"]).fit(history.iloc[:split])
    test = history.iloc[split:]
    pred = model.predict(test)
    return {"coverage_pct": round(float((test["peak_kw"] <= pred).mean() * 100), 1),
            "mae_kw": round(float(np.abs(test["peak_kw"] - pred).mean()), 3)}


def calibrate(bt):
    """Factor k so that at most (1 − q) of backtest days are under-predicted, plus uncertainty bands."""
    q = MODEL_CFG["no_underprediction_quantile"]
    daily = bt.assign(day=bt["lead"] // 24).groupby(["origin", "day"])[["forecast", "actual"]].sum()
    k = max(1.0, float(np.quantile(daily["actual"] / daily["forecast"], q)))
    cal = bt.assign(forecast=bt["forecast"] * k)
    resid = cal["actual"] - cal["forecast"]
    hour = pd.to_datetime(cal["timestamp"]).dt.hour
    upper_q = MODEL_CFG["upper_quantile"]
    bands = {
        "hour_low": resid.groupby(hour).quantile(1 - upper_q).round(3).tolist(),
        "hour_high": resid.groupby(hour).quantile(upper_q).round(3).tolist(),
        "period": {str(d): [round(float(np.quantile(period_errors(cal, d), 1 - upper_q)), 3),
                            round(float(np.quantile(period_errors(cal, d), upper_q)), 3)] for d in CONFIG["horizon_days"]},
    }
    return k, cal, bands


# ============================================================ main

def train_final(name, history, k, bands):
    """Train `name` on the whole history (cumulative learning) and save the model package."""
    print(f"Training {name} on all {len(history):,} hours (cumulative learning)...")
    final = make(name).fit(history)
    breakdown = final if isinstance(final, ApplianceModel) else ApplianceModel("xgboost_direct").fit(history)
    peak = PeakModel(MODEL_CFG["upper_quantile"]).fit(history)
    package = {
        "name": name, "model": final, "breakdown": breakdown, "peak": peak, "features": F.BASE, "targets": F.TARGETS,
        "k": k, "bands": bands, "trained_until": str(history["timestamp"].max()), "rows": len(history),
    }
    joblib.dump(package, scenario.path("model_file"))
    return package


def quick():
    """Re-train the previously chosen model on the (grown) history; calibration is kept."""
    accuracy = json.loads(scenario.path("accuracy_file").read_text())
    history = load_history()
    package = train_final(accuracy["model"], history, accuracy["calibration_factor"], accuracy["bands"])
    accuracy.update(trained_at=datetime.now().isoformat(timespec="seconds"), trained_until=package["trained_until"])
    scenario.path("accuracy_file").write_text(json.dumps(accuracy, indent=2))
    return accuracy


def main():
    history = load_history()
    names = MODEL_CFG["candidates"]
    print(f"History: {len(history):,} hours · {len(F.BASE)} inputs · {len(F.TARGETS)} appliances")
    print(f"Rolling backtest: 7-day forecasts in winter, spring and the last weeks, {len(names)} models "
          f"(each trained only on the data before its week)...")
    bt = backtest(names)
    weeks = int(bt["origin"].nunique())

    # Ranked on the calibrated forecast (the one that is used): hourly error + daily-total error
    table = pd.DataFrame({name: score(bt[bt["model"] == name]) for name in names}).T
    calibrated = {name: score(calibrate(bt[bt["model"] == name].copy())[1]) for name in names}
    table["calibrated_hourly_mae_pct"] = [calibrated[n]["hourly_mae_pct"] for n in table.index]
    table["calibrated_daily_abs_error_pct"] = [calibrated[n]["daily_abs_error_pct"] for n in table.index]
    table["rank_score"] = table["calibrated_hourly_mae_pct"] + table["calibrated_daily_abs_error_pct"]
    table = table.sort_values("rank_score")
    best = table.index[0]
    table.round(3).to_csv(scenario.path("accuracy_file").with_name("model_comparison.csv"), index_label="model")

    print("\nModel comparison (lower is better)")
    print(f"{'model':<20}{'hourly MAE':>12}{'hourly %':>10}{'daily %':>9}{'24 h %':>8}{'3 d %':>7}{'7 d %':>7}{'bias %':>8}{'days under':>11}{'calibrated':>12}")
    for name, r in table.iterrows():
        print(f"{name:<20}{r['hourly_mae_kwh']:>9.3f} kWh{r['hourly_mae_pct']:>9.1f}%{r['daily_abs_error_pct']:>8.1f}%"
              f"{r['error_1d_pct']:>7.1f}%{r['error_3d_pct']:>6.1f}%{r['error_7d_pct']:>6.1f}%{r['bias_pct']:>+7.1f}%{r['days_under_pct']:>10.0f}%"
              f"{r['rank_score']:>11.1f}")

    k, cal, bands = calibrate(bt[bt["model"] == best].copy())
    after = score(cal)
    print(f"\nWinner: {best}. Calibration ×{k:.3f} → days under-predicted {table.loc[best, 'days_under_pct']:.0f}% → "
          f"{after['days_under_pct']:.0f}%, hours under {after['hours_under_pct']:.0f}%, bias {after['bias_pct']:+.1f}%, "
          f"hourly MAE {after['hourly_mae_kwh']:.3f} kWh")
    cal.to_csv(scenario.path("accuracy_file").with_name("backtest.csv"), index=False)

    peak = peak_check(history)
    print(f"Short-peak model (1-minute kW, {int(MODEL_CFG['upper_quantile'] * 100)} % level) on the last 4 weeks: "
          f"{peak['coverage_pct']:.0f} % of hours stay below it, typical gap {peak['mae_kw']:.2f} kW")
    package = train_final(best, history, k, bands)

    accuracy = {
        "model": best,
        "trained_at": datetime.now().isoformat(timespec="seconds"),
        "trained_until": package["trained_until"],
        "backtest_weeks": weeks,
        "calibration_factor": round(k, 4),        # used by forecast.py, adjusted online by update_model.py
        "calibration_backtest": round(k, 4),      # from the backtest, the online floor
        "no_underprediction_quantile": MODEL_CFG["no_underprediction_quantile"],
        "before_calibration": {m: round(v, 3) for m, v in table.loc[best].drop("rank_score").items()},
        "after_calibration": {m: round(v, 3) for m, v in after.items()},
        "bands": bands,
        "peak": peak,
        "comparison": {name: {m: round(v, 3) for m, v in r.drop("rank_score").items()} for name, r in table.iterrows()},
    }
    scenario.path("accuracy_file").write_text(json.dumps(accuracy, indent=2))
    print(f"Saved {scenario.rel(scenario.path('model_file'))} and output/forecast_accuracy.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument("--quick", action="store_true", help="skip the model comparison, only re-train on all data")
    quick() if parser.parse_args().quick else main()
