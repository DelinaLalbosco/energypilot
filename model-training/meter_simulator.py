"""
Smart-meter simulator — "Connect live energy data" demo.

Replays the hidden true consumption of the forecast day (data/future_truth.csv,
made by generate_data.py) as hourly meter readings, like a smart meter or home
gateway would send them:

    POST http://localhost:8787/api/readings
    [{"timestamp": "2026-09-28 18:00", "total_kwh": 2.41, "heat_pump_kwh": 0.6, ...}]

The dashboard compares them live with the forecast; update_model.py learns from them.

Usage:
    .venv/bin/python meter_simulator.py                  # today's hours, one every 3 s, to the backend
    .venv/bin/python meter_simulator.py --interval 0.2 --reset
    .venv/bin/python meter_simulator.py --noise 0.3      # ±30 % noise to trigger alerts
    .venv/bin/python meter_simulator.py --offline --days 1   # no backend: write data/live_readings.csv directly
"""

import argparse
import json
import random
import time
import urllib.request

import pandas as pd

import scenario

APPLIANCES = scenario.appliance_ids()


def request(url, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def readings(days, noise):
    forecast = pd.read_csv(scenario.path("forecast_file"), parse_dates=["timestamp"])
    truth = pd.read_csv(scenario.path("future_truth_file"), parse_dates=["timestamp"])
    first = forecast["timestamp"].min()
    part = truth[(truth["timestamp"] >= first) & (truth["timestamp"] < first + pd.Timedelta(days=days))]
    rows = []
    for _, r in part.iterrows():
        factor = 1 + random.uniform(-noise, noise)
        apps = {a: round(float(r[a]) * factor, 4) for a in APPLIANCES}
        rows.append({"timestamp": r["timestamp"].strftime("%Y-%m-%d %H:00:00"), "total_kwh": round(sum(apps.values()), 4), **apps})
    return rows


def main():
    parser = argparse.ArgumentParser(description="Send hourly smart-meter readings to the dashboard.")
    parser.add_argument("--url", default="http://localhost:8787", help="backend base URL")
    parser.add_argument("--interval", type=float, default=3.0, help="seconds between hours")
    parser.add_argument("--days", type=int, default=1, help="how many forecast days to replay")
    parser.add_argument("--noise", type=float, default=0.0, help="random ± fraction added to each reading")
    parser.add_argument("--reset", action="store_true", help="clear existing readings first")
    parser.add_argument("--offline", action="store_true", help="write data/live_readings.csv instead of calling the backend")
    args = parser.parse_args()

    rows = readings(args.days, args.noise)
    if args.offline:
        path = scenario.path("readings_file")
        old = pd.read_csv(path) if path.exists() and not args.reset else pd.DataFrame()
        df = pd.concat([old, pd.DataFrame(rows)]).drop_duplicates("timestamp", keep="last").sort_values("timestamp")
        df.to_csv(path, index=False)
        print(f"Wrote {len(rows)} readings → {scenario.rel(path)} ({len(df)} in total)")
        return

    if args.reset:
        request(f"{args.url}/api/readings", "DELETE")
        print("Cleared previous readings.")
    print(f"Sending {len(rows)} hourly readings to {args.url} ...")
    for reading in rows:
        result = request(f"{args.url}/api/readings", "POST", [reading])
        print(f"{reading['timestamp'][:16]}  {reading['total_kwh']:.2f} kWh  → stored ({result['total']} total)")
        time.sleep(args.interval)
    print("Done. Run update_model.py to learn from these readings.")


if __name__ == "__main__":
    main()
