"""
Runs the whole Python pipeline in order:

  1. weather.py         real weather (Open-Meteo) + PV profile (PVGIS)      → data/
  2. generate_data.py   historical hourly profile of the family             → data/history.csv
  3. train_model.py     compare models, backtest, calibrate, train          → models/, output/
  4. forecast.py        next 24 h / 3 days / 7 days                          → output/forecast_7d.csv
  5. smart_optimizer.py daily plan + solar simulator                         → output/

The dashboard backend reads the files in data/ and output/ and updates by itself.

Usage:
    .venv/bin/python run_pipeline.py           # everything (≈ 3 min, needs internet for step 1)
    .venv/bin/python run_pipeline.py --quick   # skip the model comparison (re-train the chosen model only)
    .venv/bin/python run_pipeline.py --offline # use the cached weather files
"""

import argparse
import time

import scenario

scenario.ensure_openmp()  # may restart the process once on macOS — before any work

import forecast
import generate_data
import smart_optimizer
import train_model
import weather


def step(title, fn):
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")
    t = time.time()
    fn()
    print(f"({time.time() - t:.0f} s)")


def main():
    parser = argparse.ArgumentParser(description="Run the energy pipeline.")
    parser.add_argument("--quick", action="store_true", help="skip the model comparison / backtest")
    parser.add_argument("--offline", action="store_true", help="do not download weather (use data/ cache)")
    args = parser.parse_args()

    if not args.offline:
        step("1/5 Weather & PV data (Open-Meteo, PVGIS)", lambda: (weather.history(), weather.forecast(), weather.pvgis()))
    step("2/5 Historical consumption profile", generate_data.main)
    step("3/5 Forecasting model", train_model.quick if args.quick else train_model.main)
    step("4/5 Forecast 24 h / 3 d / 7 d", forecast.main)
    step("5/5 Optimiser & solar simulator", smart_optimizer.main)
    print("\nDone. Start (or refresh) the dashboard: see README.md → 'Run'.")


if __name__ == "__main__":
    main()
