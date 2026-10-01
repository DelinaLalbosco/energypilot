"""
Real weather and solar data for the scenario location (scenario.json → location, solar).

  Open-Meteo Historical API  → data/weather_history.csv   (history_start → yesterday)
  Open-Meteo Forecast API    → data/weather_forecast.csv  (today 00:00 → +8 days)
  JRC PVGIS (2019–2023)      → data/pvgis_hourly.csv      (typical year, kWh per kWp for each month/day/hour)

Columns (weather): timestamp (local time, one row per hour, 24 per day),
outdoor_temp_c, radiation_w_m2 (horizontal), gti_w_m2 (on the PV plane), cloud_cover_pct.

Free APIs, no key. Files are cached: without internet the last download is used.

Usage:
    .venv/bin/python weather.py            # download / refresh everything
"""

import json
import urllib.parse
import urllib.request
from datetime import date, timedelta

import pandas as pd

import scenario

CONFIG = scenario.load()
LOC = CONFIG["location"]
SOLAR = CONFIG["solar"]
HOURLY = "temperature_2m,shortwave_radiation,global_tilted_irradiance,cloud_cover"
RENAME = {
    "temperature_2m": "outdoor_temp_c",
    "shortwave_radiation": "radiation_w_m2",
    "global_tilted_irradiance": "gti_w_m2",
    "cloud_cover": "cloud_cover_pct",
}


def _get(url, params, timeout=90):
    with urllib.request.urlopen(f"{url}?{urllib.parse.urlencode(params)}", timeout=timeout) as r:
        return json.load(r)


def _open_meteo(url, **params):
    data = _get(url, {
        "latitude": LOC["latitude"], "longitude": LOC["longitude"], "hourly": HOURLY,
        "tilt": SOLAR["tilt"], "azimuth": SOLAR["azimuth"], "timezone": LOC["timezone"], **params,
    })["hourly"]
    df = pd.DataFrame(data).rename(columns=RENAME)
    df["timestamp"] = pd.to_datetime(df.pop("time"))
    return df


def regular_hours(df, start, end):
    """One row per local clock hour (DST: the doubled hour is dropped, the missing one interpolated)."""
    df = df.dropna(subset=["outdoor_temp_c"]).drop_duplicates("timestamp").set_index("timestamp").sort_index()
    index = pd.date_range(pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(hours=23), freq="h")
    df = df.reindex(index).interpolate(limit_direction="both")
    df.index.name = "timestamp"
    return df.round(2).reset_index()


def fetch_history(start, end):
    """Hourly weather start → end (dates). Archive first; the forecast API fills the last days if the archive lags."""
    print(f"Open-Meteo archive: {start} → {end}")
    df = _open_meteo("https://archive-api.open-meteo.com/v1/archive", start_date=str(start), end_date=str(end))
    have = df.dropna(subset=["outdoor_temp_c"])["timestamp"].max()
    if have is pd.NaT or have < pd.Timestamp(end) + pd.Timedelta(hours=23):
        print("  archive lags — filling the last days from the forecast API")
        recent = _open_meteo("https://api.open-meteo.com/v1/forecast", past_days=10, forecast_days=1)
        df = pd.concat([df.dropna(subset=["outdoor_temp_c"]), recent[recent["timestamp"] > have]])
    return regular_hours(df, start, end)


def fetch_forecast(days=8):
    """Hourly weather forecast from today 00:00 for `days` days."""
    today = date.today()
    print(f"Open-Meteo forecast: {today} → {today + timedelta(days=days - 1)}")
    df = _open_meteo("https://api.open-meteo.com/v1/forecast", forecast_days=days)
    df = df[df["timestamp"] >= pd.Timestamp(today)]
    return regular_hours(df, today, today + timedelta(days=days - 1))


def fetch_pvgis():
    """Typical-year PV output per kWp (PVGIS 2019–2023 average), keyed by local month/day/hour."""
    print("JRC PVGIS: hourly PV production 2019–2023")
    data = _get("https://re.jrc.ec.europa.eu/api/v5_3/seriescalc", {
        "lat": SOLAR["latitude"], "lon": SOLAR["longitude"], "peakpower": 1, "loss": SOLAR["system_loss_pct"],
        "angle": SOLAR["tilt"], "aspect": SOLAR["azimuth"], "pvcalculation": 1,
        "startyear": 2019, "endyear": 2023, "outputformat": "json",
    }, timeout=180)["outputs"]["hourly"]
    df = pd.DataFrame(data)
    utc = pd.to_datetime(df["time"], format="%Y%m%d:%H%M", utc=True).dt.floor("h")
    local = utc.dt.tz_convert(LOC["timezone"]).dt.tz_localize(None)
    df = pd.DataFrame({"month": local.dt.month, "day": local.dt.day, "hour": local.dt.hour, "pv_kwh_per_kwp": df["P"] / 1000})
    typical = df.groupby(["month", "day", "hour"], as_index=False)["pv_kwh_per_kwp"].mean().round(4)
    print(f"  typical year: {typical['pv_kwh_per_kwp'].sum() * 365 / (len(typical) / 24):,.0f} kWh per kWp")
    return typical


def _cached(key, fetch):
    target = scenario.path(key)
    try:
        df = fetch()
        df.to_csv(target, index=False)
        print(f"  saved {len(df):,} rows → {scenario.rel(target)}")
    except OSError as error:  # no internet: keep using the last download
        if not target.exists():
            raise SystemExit(f"{key}: download failed ({error}) and no cached file — connect to the internet once.")
        print(f"  ! download failed ({error}) — using cached {target.name}")
    return pd.read_csv(target, parse_dates=["timestamp"] if key != "pvgis_file" else None)


def history():
    start, end = scenario.history_range()
    df = _cached("weather_history_file", lambda: fetch_history(start, end))
    return df[(df["timestamp"] >= pd.Timestamp(start)) & (df["timestamp"] < pd.Timestamp(end) + pd.Timedelta(days=1))]


def forecast():
    return _cached("weather_forecast_file", fetch_forecast)


def pvgis():
    return _cached("pvgis_file", fetch_pvgis)


def load(key):
    """Read a cached file (no download)."""
    target = scenario.path(key)
    if not target.exists():
        raise SystemExit(f"{target.name} missing — run weather.py first.")
    return pd.read_csv(target, parse_dates=["timestamp"] if key != "pvgis_file" else None)


def pv_per_kwp_typical(timestamps):
    """PVGIS typical-year production (kWh per kWp) for the given local timestamps."""
    table = load("pvgis_file").set_index(["month", "day", "hour"])["pv_kwh_per_kwp"]
    ts = pd.to_datetime(pd.Series(timestamps))
    day = ts.dt.day.where(~((ts.dt.month == 2) & (ts.dt.day == 29)), 28)
    keys = list(zip(ts.dt.month, day, ts.dt.hour))
    return table.reindex(keys).fillna(0).to_numpy()


def pv_per_kwp_from_weather(gti_w_m2):
    """PV production (kWh per kWp) from irradiance on the PV plane, with the same system loss as PVGIS."""
    return pd.Series(gti_w_m2).fillna(0).to_numpy() / 1000 * (1 - SOLAR["system_loss_pct"] / 100)


if __name__ == "__main__":
    h = history()
    f = forecast()
    p = pvgis()
    print(f"\nHistory: {h['timestamp'].min()} → {h['timestamp'].max()} · mean {h['outdoor_temp_c'].mean():.1f} °C, "
          f"min {h['outdoor_temp_c'].min():.1f} °C")
    print(f"Forecast: {f['timestamp'].min()} → {f['timestamp'].max()} · {f['outdoor_temp_c'].min():.1f} … {f['outdoor_temp_c'].max():.1f} °C")
