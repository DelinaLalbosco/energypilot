"""
Model inputs, shared by train_model.py, forecast.py and update_model.py.

Only information that is known BEFORE the hour happens is used:
  * clock & calendar   hour, weekday, weekend/holiday, school day
  * weather            outdoor temperature (+ 24 h mean = thermal inertia), heating degrees,
                       solar radiation — from the weather archive (history) or forecast (future)
  * planned calendar   who is expected home/awake/asleep (household.py, planned layer),
                       wake-ups and arrivals (morning recovery of the heat pump, cooking),
                       Marek's shift, Ania's home-office day
  * recent demand      same hour yesterday / last week (only the "recursive" model uses these)
Unplanned events (outings, trips, sick days) are NOT inputs — the forecast cannot know them.
"""

import numpy as np
import pandas as pd

import household
import scenario

CONFIG = scenario.load()
MEMBERS = [m["id"] for m in CONFIG["members"]]
HEAT = CONFIG["heating"]
TOTAL = CONFIG["data"]["total_column"]
TARGETS = scenario.appliance_ids()

BASE = [
    "hour", "hour_sin", "hour_cos", "day_of_week", "free_day", "school_day",
    "outdoor_temp_c", "temp_mean_24h", "heating_degrees", "radiation_w_m2",
    *[f"plan_{m}" for m in MEMBERS], "plan_people_home", "plan_people_awake", "plan_kids_home",
    "plan_wakeups", "plan_arrivals", "plan_setpoint", "setpoint_change", "marek_shift", "home_office",
]
LAGS = ["lag_24", "lag_168", "mean_24_lag"]


def add_features(df):
    """df: timestamp + weather columns (hourly, contiguous). Returns df with every model input."""
    df = df.copy().sort_values("timestamp").reset_index(drop=True)
    ts = df["timestamp"]
    plan = household.calendar(ts.min().date(), ts.max().date(), actual=False).set_index("timestamp").reindex(ts)

    df["hour"] = ts.dt.hour
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)
    df["day_of_week"] = ts.dt.dayofweek
    df["free_day"] = plan["holiday"].to_numpy()
    df["school_day"] = plan["school_day"].to_numpy()
    df["marek_shift"] = plan["marek_shift"].to_numpy()
    df["home_office"] = plan["home_office"].to_numpy()

    df["temp_mean_24h"] = df["outdoor_temp_c"].rolling(24, min_periods=1).mean()
    # degrees below the top of the heating band, weighted by how much of the heat demand is covered there
    top = HEAT["heating_limit_c"] + HEAT["heating_limit_band_c"] / 2
    df["heating_degrees"] = (top - df["temp_mean_24h"]).clip(lower=0) * scenario.heating_share(df["temp_mean_24h"])

    states = plan[[f"{m}_home" for m in MEMBERS]].to_numpy()
    for k, m in enumerate(MEMBERS):
        df[f"plan_{m}"] = states[:, k]
    prev = np.vstack([states[:1], states[:-1]])
    df["plan_people_home"] = plan["people_home"].to_numpy()
    df["plan_people_awake"] = plan["people_awake"].to_numpy()
    df["plan_kids_home"] = plan["kids_home"].to_numpy()
    df["plan_wakeups"] = ((prev == household.ASLEEP) & (states == household.AWAKE)).sum(axis=1)
    df["plan_arrivals"] = ((prev == household.AWAY) & (states != household.AWAY)).sum(axis=1)
    night = df["hour"].isin(HEAT["night_hours"])
    df["plan_setpoint"] = np.where(df["plan_people_home"] == 0, HEAT["setpoint_empty"],
                                   np.where(night, HEAT["setpoint_night"], HEAT["setpoint_day"]))
    df["setpoint_change"] = df["plan_setpoint"].diff().fillna(0)
    return df


def add_lags(df, series):
    """Lag inputs from a list/array of hourly totals aligned with df (NaN where unknown)."""
    s = pd.Series(series, index=df.index, dtype=float)
    df["lag_24"] = s.shift(24)
    df["lag_168"] = s.shift(168)
    df["mean_24_lag"] = s.shift(24).rolling(24, min_periods=1).mean()
    return df
