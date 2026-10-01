"""
INTERNAL check — true vs predicted. Not shown in the dashboard.

Makes three PNG charts in output/internal/:
  1. backtest_weeks.png     every backtest week: true hourly demand vs the calibrated forecast
                            (train_model.py → output/backtest.csv; each week was forecast with a model
                            trained only on the data before it)
  2. backtest_scatter.png   true vs predicted per hour and per day, with the diagonal
  3. forecast_week.png      the current 7-day forecast vs the hidden simulated truth
                            (data/future_truth.csv) and live meter readings, if any

Also prints the error of each backtest week.

Usage:
    .venv/bin/python plot_true_vs_predicted.py
"""

import matplotlib

matplotlib.use("Agg")  # files only, no window
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

import scenario

OUT = scenario.path("accuracy_file").parent / "internal"
OUT.mkdir(parents=True, exist_ok=True)
TRUE, PRED = "#222222", "#0f9d8a"


def weeks_chart(bt):
    origins = sorted(bt["origin"].unique())
    fig, axes = plt.subplots(len(origins), 1, figsize=(14, 2.3 * len(origins)), sharey=False)
    for ax, o in zip(np.atleast_1d(axes), origins):
        w = bt[bt["origin"] == o]
        ax.plot(w["timestamp"], w["actual"], color=TRUE, lw=0.9, label="true")
        ax.plot(w["timestamp"], w["forecast"], color=PRED, lw=1.2, label="predicted (calibrated)")
        err = (w["forecast"].sum() / w["actual"].sum() - 1) * 100
        mae = (w["forecast"] - w["actual"]).abs().mean()
        ax.set_title(f"{w['timestamp'].min():%d %b %Y} → {w['timestamp'].max():%d %b}   7-day total {err:+.1f} %   hourly MAE {mae:.2f} kWh",
                     fontsize=9, loc="left")
        ax.set_ylabel("kWh/h", fontsize=8)
        ax.tick_params(labelsize=7)
        ax.grid(alpha=0.25)
    np.atleast_1d(axes)[0].legend(fontsize=8, loc="upper right")
    fig.tight_layout()
    fig.savefig(OUT / "backtest_weeks.png", dpi=130)
    plt.close(fig)


def scatter_chart(bt):
    daily = bt.assign(day=bt["timestamp"].dt.date).groupby(["origin", "day"])[["forecast", "actual"]].sum()
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 5))
    for ax, df, unit, title in [(a1, bt, "kWh per hour", "Hourly"), (a2, daily, "kWh per day", "Daily totals")]:
        m = max(df["actual"].max(), df["forecast"].max()) * 1.05
        ax.scatter(df["actual"], df["forecast"], s=6 if title == "Hourly" else 22, alpha=0.35 if title == "Hourly" else 0.8, color=PRED)
        ax.plot([0, m], [0, m], color=TRUE, lw=1, ls="--", label="perfect")
        under = (df["forecast"] < df["actual"]).mean() * 100
        ax.set_title(f"{title}: {under:.0f} % under-predicted (below the line)", fontsize=10)
        ax.set_xlabel(f"true {unit}")
        ax.set_ylabel(f"predicted {unit}")
        ax.set_xlim(0, m)
        ax.set_ylim(0, m)
        ax.grid(alpha=0.25)
        ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(OUT / "backtest_scatter.png", dpi=130)
    plt.close(fig)


def forecast_chart():
    f = pd.read_csv(scenario.path("forecast_file"), parse_dates=["timestamp"])
    truth_path = scenario.path("future_truth_file")
    fig, ax = plt.subplots(figsize=(14, 4))
    ax.bar(f["timestamp"], f["predicted_total_kwh"], width=1 / 24 * 0.8, color=PRED, alpha=0.75, label="predicted (calibrated)")
    ax.fill_between(f["timestamp"], f["low_total_kwh"], f["safe_predicted_total_kwh"], color=PRED, alpha=0.12, label="likely range")
    title = "Current 7-day forecast"
    if truth_path.exists():
        t = pd.read_csv(truth_path, parse_dates=["timestamp"])
        t = t[t["timestamp"].isin(f["timestamp"])]
        if len(t):
            ax.plot(t["timestamp"], t[scenario.load()["data"]["total_column"]], color=TRUE, lw=1, label="hidden simulated truth")
            both = f.merge(t[["timestamp", scenario.load()["data"]["total_column"]]], on="timestamp")
            true = both[scenario.load()["data"]["total_column"]]
            title += f" vs truth: total {(both['predicted_total_kwh'].sum() / true.sum() - 1) * 100:+.1f} %, hourly MAE " \
                     f"{(both['predicted_total_kwh'] - true).abs().mean():.2f} kWh"
    readings = scenario.path("readings_file")
    if readings.exists():
        r = pd.read_csv(readings, parse_dates=["timestamp"])
        r = r[r["timestamp"].isin(f["timestamp"])]
        if len(r):
            ax.scatter(r["timestamp"], r["total_kwh"], s=14, color="#e11d74", zorder=3, label="live meter")
    ax.set_title(title, fontsize=10, loc="left")
    ax.set_ylabel("kWh/h")
    ax.grid(alpha=0.25)
    ax.legend(fontsize=8, loc="upper right")
    fig.tight_layout()
    fig.savefig(OUT / "forecast_week.png", dpi=130)
    plt.close(fig)


def main():
    bt = pd.read_csv(scenario.path("accuracy_file").with_name("backtest.csv"), parse_dates=["timestamp"])
    print(f"Backtest of {bt['model'].iloc[0]} (calibrated), {bt['origin'].nunique()} weeks:")
    for o, w in bt.groupby("origin"):
        err = (w["forecast"].sum() / w["actual"].sum() - 1) * 100
        print(f"  {w['timestamp'].min():%d %b %Y}: predicted {w['forecast'].sum():6.1f} kWh, true {w['actual'].sum():6.1f} kWh ({err:+.1f} %)")
    weeks_chart(bt)
    scatter_chart(bt)
    forecast_chart()
    print(f"Charts saved in {scenario.rel(OUT)}/: backtest_weeks.png, backtest_scatter.png, forecast_week.png")


if __name__ == "__main__":
    main()
