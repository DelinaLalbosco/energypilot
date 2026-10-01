"""
Smart optimiser + renewable energy simulator (Scenario 2: cost optimisation, requirement 8).

Inputs:  output/forecast_7d.csv   first 24 h = the plan day (forecast.py)
         data/history.csv         usual appliance hours and cycle energy, yearly demand
         data/pvgis_hourly.csv    PVGIS typical-year PV production (weather.py)
         scenario.json            tariff, flexible windows, heat pump, comfort levels, solar economics

Daily plan (OR-Tools mixed-integer program), for every PV size × comfort level:
  * heat pump — the house is a thermal battery: heat a little more while electricity is
    cheaper, rest during the €0.40 peak (17–22), indoor temperature stays in the comfort band
  * start hour of each flexible appliance (washing machine, dishwasher) inside its window
  * objective: grid cost + peak penalty + a small comfort term

Yearly solar simulator, for every PV size from 0 to solar.simulator_kwp.max (step 0.5 kWp):
  production (PVGIS), share of demand covered, grid reduction, savings (bill + export at
  the feed-in price − yearly running cost), payback A (current habits) and B (flexible
  appliances moved to the best hour of their window).

Outputs: output/smart_plan.csv, output/solar_scenarios.csv

Usage:
    .venv/bin/python smart_optimizer.py
"""

import numpy as np
import pandas as pd
from ortools.linear_solver import pywraplp

import scenario
import weather

CONFIG = scenario.load()
HEATING = scenario.heating()
SOLAR = CONFIG["solar"]
PEAK_WEIGHT = CONFIG["optimizer"]["peak_weight"]
COMFORT_WEIGHT = CONFIG["optimizer"]["comfort_weight"]
TOTAL = CONFIG["data"]["total_column"]
electricity_price = scenario.electricity_price


# ============================================================
# DATA
# ============================================================

def load_inputs():
    forecast = pd.read_csv(scenario.path("forecast_file"), parse_dates=["timestamp"]).iloc[: CONFIG["forecast_hours"]]
    history = pd.read_csv(scenario.path("history_file"), parse_dates=["timestamp"])
    history["hour"] = history["timestamp"].dt.hour

    cycles = {}
    for column, config in scenario.flexible_appliances().items():
        runs = history[history[column] > 0]
        if runs.empty:
            print(f"Skipping {column}: never used in the history.")
            continue
        cycles[column] = {**config, "energy_kwh": float(runs[column].mean()), "usual_hour": int(runs["hour"].mode().iloc[0])}
    return forecast, history, cycles


# ============================================================
# OPTIMISATION
# ============================================================

def optimize_day(forecast, cycles, pv, band=None):
    """Solve heating + appliance schedule for one day. Returns per-hour decisions."""

    hours = forecast["hour"].astype(int).tolist()
    n = len(hours)
    price = np.array([electricity_price(h) for h in hours])

    heat_col = HEATING["appliance"] if HEATING else None
    heat_ref = forecast[heat_col].to_numpy() if heat_col else np.zeros(n)

    fixed = (
        forecast["predicted_total_kwh"].to_numpy()
        - heat_ref
        - sum((forecast[c].to_numpy() for c in cycles), np.zeros(n))
    ).clip(min=0)

    solver = pywraplp.Solver.CreateSolver("SCIP")

    grid = [solver.NumVar(0, solver.infinity(), f"grid_{t}") for t in range(n)]
    peak = solver.NumVar(0, solver.infinity(), "peak")

    start = {
        c: {t: solver.BoolVar(f"{c}_{t}") for t in range(n) if hours[t] in cfg["hours"]}
        for c, cfg in cycles.items()
    }
    for c in cycles:
        if not start[c]:
            raise SystemExit(f"{c}: its flexible window has no hour in the forecast.")
        solver.Add(sum(start[c].values()) == 1)

    comfort_terms = []

    if HEATING:
        band = band or {k: HEATING[k] for k in ("day_min", "day_max", "night_min", "night_max")}
        # ----------------------------------------------------
        # Thermal battery: heat_ref (the XGBoost heating forecast)
        # keeps the house at the comfort temperature. Extra heating
        # raises the indoor temperature; a warmer house loses heat faster.
        # ----------------------------------------------------
        comfort = HEATING["comfort_temp"]
        loss = HEATING["loss_kw_per_c"]
        capacity = HEATING["capacity_kwh_per_c"]
        night = set(HEATING["night_hours"])

        heat = [solver.NumVar(0, HEATING["max_kw"], f"heat_{t}") for t in range(n)]
        temp = [solver.NumVar(10, 30, f"temp_{t}") for t in range(n + 1)]
        dev = [solver.NumVar(0, solver.infinity(), f"dev_{t}") for t in range(n + 1)]

        solver.Add(temp[0] == comfort)
        solver.Add(temp[n] >= comfort)

        for t in range(n):
            solver.Add(temp[t + 1] == temp[t] + (heat[t] - heat_ref[t] - loss * (temp[t] - comfort)) / capacity)

        for t in range(1, n + 1):
            clock = hours[t] if t < n else (hours[-1] + 1) % 24
            if clock in night:
                lo, hi = band["night_min"], band["night_max"]
            else:
                lo, hi = band["day_min"], band["day_max"]
            solver.Add(temp[t] >= lo)
            solver.Add(temp[t] <= hi)

        for t in range(n + 1):
            solver.Add(dev[t] >= temp[t] - comfort)
            solver.Add(dev[t] >= comfort - temp[t])
        comfort_terms = dev
    else:
        heat = list(heat_ref)
        temp = [None] * (n + 1)

    for t in range(n):
        appliance = sum(cycles[c]["energy_kwh"] * start[c][t] for c in cycles if t in start[c])
        solver.Add(grid[t] >= fixed[t] + heat[t] + appliance - pv[t])
        solver.Add(peak >= grid[t])

    solver.Minimize(
        sum(price[t] * grid[t] for t in range(n))
        + PEAK_WEIGHT * peak
        + COMFORT_WEIGHT * sum(comfort_terms)
    )

    if solver.Solve() != pywraplp.Solver.OPTIMAL:
        raise RuntimeError("No optimal schedule found — check the comfort band and flexible windows in scenario.json.")

    value = lambda v: v.solution_value() if hasattr(v, "solution_value") else (np.nan if v is None else float(v))

    return {
        "price": price,
        "fixed": fixed,
        "heating_ref": heat_ref,
        "heating_opt": np.array([value(v) for v in heat]),
        "indoor_temp_opt": np.array([value(v) for v in temp[:n]]),
        "indoor_temp_opt_end": np.array([value(v) for v in temp[1:]]),
        "schedule": {c: next(t for t, var in start[c].items() if var.solution_value() > 0.5) for c in cycles},
    }


# ============================================================
# DAILY PLAN FOR EVERY PV SIZE
# ============================================================

def build_plan(forecast, cycles):

    rows = []
    hours = forecast["hour"].astype(int).to_numpy()

    for pv_kwp, level in [(pv, lvl) for pv in SOLAR["options_kwp"] for lvl in scenario.comfort_levels()]:

        pv = forecast["pv_kwh_per_kwp"].to_numpy() * pv_kwp  # real radiation forecast
        result = optimize_day(forecast, cycles, pv, level if HEATING else None)

        plan = forecast.copy()
        plan["pv_kwp"] = pv_kwp
        plan["comfort_level"] = level["id"]
        plan["pv_kwh"] = pv
        plan["electricity_price"] = result["price"]

        # Usual habits: forecast heating, appliances at their usual hour
        plan["heating_usual_kwh"] = result["heating_ref"]
        plan["heating_opt_kwh"] = result["heating_opt"]
        plan["indoor_temp_usual"] = HEATING["comfort_temp"] if HEATING else np.nan
        plan["indoor_temp_opt"] = result["indoor_temp_opt"]
        plan["indoor_temp_opt_end"] = result["indoor_temp_opt_end"]

        usual_load = result["fixed"] + plan["heating_usual_kwh"]
        opt_load = result["fixed"] + plan["heating_opt_kwh"]

        for c, cfg in cycles.items():
            usual = np.where(hours == cfg["usual_hour"], cfg["energy_kwh"], 0.0)
            opt = np.zeros(len(plan))
            opt[result["schedule"][c]] = cfg["energy_kwh"]

            plan[scenario.usual_column(c)] = usual
            plan[scenario.opt_column(c)] = opt

            usual_load = usual_load + usual
            opt_load = opt_load + opt

        plan["fixed_load_kwh"] = result["fixed"]
        plan["usual_load_kwh"] = usual_load
        plan["opt_load_kwh"] = opt_load
        plan["usual_grid_kwh"] = (usual_load - pv).clip(lower=0)
        plan["opt_grid_kwh"] = (opt_load - pv).clip(lower=0)

        rows.append(plan)

    return pd.concat(rows, ignore_index=True)


# ============================================================
# YEARLY SOLAR SIMULATOR
# ============================================================

def shift_flexible_to_best_hours(history, cycles, pv):
    """Move each flexible appliance cycle in the history to the cheapest hour in its window."""

    load = history[TOTAL].to_numpy().copy()
    price = history["hour"].map(electricity_price).to_numpy()
    days = history["timestamp"].dt.date.to_numpy()
    hours = history["hour"].to_numpy()

    for c, cfg in cycles.items():
        energy = history[c].to_numpy()

        for i in np.flatnonzero(energy > 0):
            same_day = np.flatnonzero((days == days[i]) & np.isin(hours, cfg["hours"]))
            if same_day.size == 0:
                continue
            load[i] -= energy[i]

            # Net cost of adding the cycle at each candidate hour
            cost = [price[j] * (max(0, load[j] + energy[i] - pv[j]) - max(0, load[j] - pv[j])) for j in same_day]
            load[same_day[int(np.argmin(cost))]] += energy[i]

    return load


def typical_year(history):
    """Solar is judged over a full year. Shorter (real) data is extended: each missing
    day copies a real day from the history (same weekday), without the heating part."""

    days = history["timestamp"].dt.normalize().unique()
    if len(days) >= 360:
        return history

    year = pd.Timestamp(days[0]).year
    have = {pd.Timestamp(d).strftime("%m-%d"): pd.Timestamp(d) for d in days}
    by_weekday = {w: [pd.Timestamp(d) for d in days if pd.Timestamp(d).weekday() == w] for w in range(7)}
    heating = scenario.heating()
    parts = []
    for i, day in enumerate(pd.date_range(f"{year}-01-01", f"{year}-12-31", freq="D")):
        source = have.get(day.strftime("%m-%d"))
        real = source is not None
        if not real:
            pool = by_weekday[day.weekday()] or [pd.Timestamp(d) for d in days]
            source = pool[i % len(pool)]
        rows = history[history["timestamp"].dt.normalize() == source].copy()
        rows["timestamp"] = day + pd.to_timedelta(rows["hour"], unit="h")
        if not real and heating and heating["appliance"] in rows:
            rows[TOTAL] -= rows[heating["appliance"]]
            rows[heating["appliance"]] = 0.0
        parts.append(rows)

    print(f"History covers {len(days)} days — the other {365 - len(days)} days of the year are estimated from typical days (solar only).")
    return pd.concat(parts, ignore_index=True)


def solar_scenarios(history, cycles):
    history = typical_year(history)
    scale = 365 / (len(history) / 24)  # per year
    price = history["hour"].map(electricity_price).to_numpy()
    demand = history[TOTAL].to_numpy()
    base_cost = float((demand * price).sum())
    per_kwp = weather.pv_per_kwp_typical(history["timestamp"])

    grid_cfg = SOLAR.get("simulator_kwp", {"max": max(SOLAR["options_kwp"]), "step": 1})
    sizes = sorted({round(float(x), 2) for x in np.arange(0, grid_cfg["max"] + 1e-9, grid_cfg["step"])} | set(SOLAR["options_kwp"]))

    rows = []
    for pv_kwp in sizes:
        pv = per_kwp * pv_kwp
        cost = pv_kwp * SOLAR["install_cost_per_kwp"]
        opex = cost * SOLAR["annual_opex_pct"] / 100
        row = {"pv_kwp": pv_kwp, "annual_production_kwh": pv.sum() * scale, "annual_demand_kwh": demand.sum() * scale,
               "install_cost": cost, "annual_opex": opex}

        for label, load in [("", demand), ("_with_shift", shift_flexible_to_best_hours(history, cycles, pv))]:
            grid = (load - pv).clip(min=0)
            export = (pv - load).clip(min=0)
            bill_saving = (base_cost - float((grid * price).sum())) * scale
            export_income = SOLAR["feed_in_price"] * export.sum() * scale
            savings = bill_saving + export_income - (opex if pv_kwp > 0 else 0)
            row[f"self_consumption_kwh{label}"] = float(np.minimum(load, pv).sum()) * scale
            row[f"export_kwh{label}"] = float(export.sum()) * scale
            row[f"grid_kwh{label}"] = float(grid.sum()) * scale
            row[f"demand_covered_pct{label}"] = 100 * float(np.minimum(load, pv).sum()) / demand.sum()
            row[f"grid_reduction_kwh{label}"] = (demand.sum() - float(grid.sum())) * scale
            row[f"bill_saving{label}"] = bill_saving
            row[f"export_income{label}"] = export_income
            row[f"annual_savings{label}"] = savings
            row[f"payback_years{label}"] = cost / savings if pv_kwp > 0 and savings > 0 else None
        rows.append(row)
    return pd.DataFrame(rows)


# ============================================================
# MAIN
# ============================================================

def main():

    forecast, history, cycles = load_inputs()
    cur = CONFIG["currency"]

    print(f"Scenario: {CONFIG['household']['name']} — {CONFIG['household']['title']}")
    print(f"Heating model: {'on' if HEATING else 'off'} · flexible appliances: {', '.join(c['name'] for c in cycles.values()) or 'none'}")
    print("Optimising for each PV size...")
    plan = build_plan(forecast, cycles)
    plan.to_csv(scenario.path("plan_file"), index=False)

    print("Simulating a full year of solar production...")
    scenarios = solar_scenarios(history, cycles)
    scenarios.to_csv(scenario.path("solar_file"), index=False)

    print()
    print("=" * 60)
    print(f"DAILY PLAN — {forecast['timestamp'].iloc[0]:%Y-%m-%d}")
    print("=" * 60)

    default_level = (HEATING or {}).get("default_comfort", scenario.comfort_levels()[0]["id"])
    for pv_kwp, day in plan[plan["comfort_level"] == default_level].groupby("pv_kwp"):
        usual = (day["usual_grid_kwh"] * day["electricity_price"]).sum()
        opt = (day["opt_grid_kwh"] * day["electricity_price"]).sum()
        starts = ", ".join(
            f"{cfg['name']} {cfg['usual_hour']:02d}:00→"
            f"{int(day.loc[day[scenario.opt_column(c)] > 0, 'hour'].iloc[0]):02d}:00"
            for c, cfg in cycles.items()
        )
        print(
            f"{pv_kwp} kWp: {cur}{usual:.2f} → {cur}{opt:.2f} (saves {cur}{usual - opt:.2f}) | "
            f"peak {day['usual_grid_kwh'].max():.2f} → {day['opt_grid_kwh'].max():.2f} kWh | {starts}"
        )

    if HEATING and len(scenario.comfort_levels()) > 1:
        default_pv = SOLAR["default_kwp"]
        print()
        print(f"Comfort levels ({default_pv} kWp):")
        for level in scenario.comfort_levels():
            day = plan[(plan["pv_kwp"] == default_pv) & (plan["comfort_level"] == level["id"])]
            usual = (day["usual_grid_kwh"] * day["electricity_price"]).sum()
            opt = (day["opt_grid_kwh"] * day["electricity_price"]).sum()
            print(
                f"  {level['label']:<9} day {level['day_min']}–{level['day_max']} °C, night ≥{level['night_min']} °C: "
                f"{cur}{opt:.2f} (saves {cur}{usual - opt:.2f})"
            )

    print()
    print("=" * 60)
    print(f"YEARLY SOLAR SIMULATOR (PVGIS {SOLAR['yield_kwh_per_kwp']} kWh/kWp, €{SOLAR['install_cost_per_kwp']}/kWp, "
          f"export €{SOLAR['feed_in_price']}, running cost {SOLAR['annual_opex_pct']}%/yr)")
    print("=" * 60)

    for _, r in scenarios[scenarios["pv_kwp"].isin([k for k in SOLAR["options_kwp"] if k > 0])].iterrows():
        payback = f"{r['payback_years']:.1f} yr" if pd.notna(r["payback_years"]) else "—"
        payback_shift = f"{r['payback_years_with_shift']:.1f} yr" if pd.notna(r["payback_years_with_shift"]) else "—"
        print(
            f"{r['pv_kwp']:.0f} kWp: {r['annual_production_kwh']:,.0f} kWh/yr | covers {r['demand_covered_pct']:.0f}% | "
            f"saves {cur}{r['annual_savings']:,.0f}/yr | payback {payback} ({payback_shift} with shifted habits)"
        )

    print()
    print("Saved to:")
    print(scenario.rel(scenario.path("plan_file")))
    print(scenario.rel(scenario.path("solar_file")))


if __name__ == "__main__":
    main()
