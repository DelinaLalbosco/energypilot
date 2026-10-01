"""
Builds the historical hourly consumption profile (Scenario 2 requirement 1).

Inputs:  scenario.json (members, calendar, meals, appliance profiles, heating)
         data/weather_history.csv, data/weather_forecast.csv   (weather.py)
Outputs: data/history.csv       history_start → yesterday: what the meter "measured"
         data/future_truth.csv  today → +7 days: the hidden "truth" used by the
                                meter simulator (live readings) and online learning

How one hour is simulated:
  * household.py decides who is home / awake / asleep (planned + unplanned events)
  * meals (breakfast at wake-up, lunch, kids' snack, dinner, late meal after a shift)
    switch on kettle, coffee machine, hob and oven with the brief's power × minutes
  * screens run while their users are home and awake (sessions last several hours)
  * washing machine / dishwasher cycles, lighting when dark, device charging,
    always-on loads (fridge, router, standby)
  * heat pump: a thermal model of the house (heat loss, thermal mass, internal and
    solar gains, temperature-dependent COP) heats towards the setpoint
  * short peaks: cooking and the heaters of washing machine / dishwasher are also tracked
    minute by minute; peak_kw = the highest 1-minute power of each hour (e.g. hob + oven +
    kettle at dinner), which the hourly kWh average hides
Random choices use (seed, date), so every day is reproducible.

Usage:
    .venv/bin/python generate_data.py
"""

import numpy as np
import pandas as pd

import household
import scenario
import weather

CONFIG = scenario.load()
HEAT = CONFIG["heating"]
MEMBERS = CONFIG["members"]
ADULTS = [m["id"] for m in MEMBERS if m["adult"]]
KIDS = [m["id"] for m in MEMBERS if not m["adult"]]
APPS = {a["id"]: a for a in CONFIG["appliances"]}
AWAY, AWAKE, ASLEEP = household.AWAY, household.AWAKE, household.ASLEEP


class Day:
    """One day of the simulation: member states for its 24 hours and helpers to add energy."""

    def __init__(self, sim, index, cal):
        self.sim, self.i0, self.cal = sim, index * 24, cal
        self.day = cal["timestamp"].iloc[0].date()
        self.rng = household.rng_for(self.day, 2)
        self.free = not cal["school_day"].iloc[0]
        self.states = {m["id"]: cal[f"{m['id']}_home"].to_numpy() for m in MEMBERS}

    def state(self, member, h):
        return self.states[member][h] if 0 <= h < 24 else AWAY

    def awake(self, members, h):
        return [m for m in members if self.state(m, h) == AWAKE]

    def who(self, needs, h):
        groups = {"any": self.sim.ids, "adult": ADULTS, "kids": KIDS}
        return self.awake(groups.get(needs, [needs]), h)

    def add(self, app, start_h, kw, minutes):
        """Add kw × minutes starting at start_h (hours from midnight), split over hour boundaries.
        The power is also written minute by minute (for the short peaks of the hour)."""
        m0 = self.i0 * 60 + int(start_h * 60)
        self.sim.minute[m0: min(m0 + max(1, round(minutes)), self.sim.n * 60)] += kw
        t, left = start_h, minutes / 60
        while left > 1e-9:
            idx = self.i0 + int(t)
            step = min(left, int(t) + 1 - t)
            if idx < self.sim.n:
                self.sim.energy[app][idx] += kw * step
            t, left = t + step, left - step


class Simulation:
    def __init__(self, weather_df, cal):
        self.w, self.cal, self.n = weather_df.reset_index(drop=True), cal.reset_index(drop=True), len(cal)
        self.ids = [m["id"] for m in MEMBERS]
        self.energy = {a: np.zeros(self.n) for a in APPS}
        self.rad = self.w["radiation_w_m2"].to_numpy()
        # minute-resolution power (kW) of the short, high-power loads: cooking and cycle heaters
        self.minute = np.zeros(self.n * 60)
        self.eventful = set()  # appliances whose power is already in self.minute

    # ---------------------------------------------------------------- behaviour
    def meals(self, d):
        dinner_home = False
        for meal in CONFIG["meals"]:
            if meal.get("when") == "wake":
                for h in range(3, 13):
                    waking = [m for m in self.ids if d.state(m, h) == AWAKE and d.state(m, h - 1) == ASLEEP]
                    if waking:
                        self.cook(d, meal, h + d.rng.uniform(0.1, 0.5), waking)
            elif meal.get("when") == "shift_return":
                for h in range(1, 24):
                    if d.state("marek", h - 1) == AWAY and d.state("marek", h) != AWAY:
                        self.cook(d, meal, h + d.rng.uniform(0.1, 0.4), ["marek"])
            else:
                lo, hi = meal["hours"]
                shift = meal.get("shift_minutes", 0) / 60
                t = d.rng.uniform(lo, hi) + d.rng.uniform(-shift, shift)
                for attempt in range(3):  # nobody there yet → cook when someone comes home
                    people = d.who(meal["needs"], int(t))
                    if people:
                        self.cook(d, meal, t, d.awake(self.ids, int(t)))
                        dinner_home |= meal["id"] == "dinner"
                        break
                    t += 1
        return dinner_home

    def cook(self, d, meal, t, people):
        adults = [p for p in people if p in ADULTS]
        for app, u in meal["uses"].items():
            if "per_adult" in u:
                count = sum(d.rng.random() < u["probability"] for _ in adults)
            elif d.rng.random() >= u["probability"]:
                continue
            else:
                count = max(1, d.rng.poisson(u["per_person"] * len(people))) if "per_person" in u else 1
            for k in range(count):
                d.add(app, t + k * d.rng.uniform(0.05, 0.3), d.rng.uniform(*u["kw"]), d.rng.uniform(*u["minutes"]))

    def sessions(self, d, app, p):
        users = self.ids if p["users"] == "any" else p["users"]
        weekend = d.free and "weekend_hours" in p
        windows = p["weekend_hours"] if weekend else p["hours"]
        prob = p.get("weekend_probability", p["probability"]) if weekend else p["probability"]
        on = False
        for h in range(24):
            active = d.awake(users, h)
            in_window = any(a <= h < b for a, b in windows)
            chance = 0.0
            if active and in_window:
                chance = prob
            elif active and p.get("daytime_probability") and 8 <= h < 17:
                chance = p["daytime_probability"]
            wfh = p.get("work_from_home")
            if wfh and d.cal["home_office"].iloc[0] and "ania" in active and wfh[0] <= h < wfh[1]:
                chance = 0.95
            on = active and d.rng.random() < (max(chance, 0.7) if on and chance else chance)
            if on:
                d.add(app, h, d.rng.uniform(*p["kw"]), 60 * d.rng.uniform(0.4, 1.0))

    def cycles(self, d, app, p, dinner_home):
        chance = p["per_week"] / 7 * (1.25 if d.free else 0.9)
        if app == "dishwasher_kwh" and not dinner_home:
            return
        if app == "washing_machine_kwh" and household.trip_weekend(d.day + pd.Timedelta(days=1).to_pytimedelta()):
            chance = 1.0  # washing before a trip
        if d.rng.random() >= chance:
            return
        for attempt in range(4):
            lo, hi = p["hours"][d.rng.integers(len(p["hours"]))]
            h = int(d.rng.integers(lo, hi))
            if d.who(p["needs"], h):
                energy = d.rng.uniform(*p["kwh"])  # a cycle counts in its start hour
                self.energy[app][d.i0 + h] += energy
                # water heater of the cycle (≈ 2 kW for 10–20 min), the rest spread over the hour
                heater_min = min(d.rng.uniform(*p.get("heater_minutes", [10, 20])), energy / p.get("heater_kw", 2.0) * 60)
                start = (d.i0 + h) * 60 + int(d.rng.integers(0, 60 - int(heater_min)))
                self.minute[start: start + int(heater_min)] += p.get("heater_kw", 2.0)
                self.minute[(d.i0 + h) * 60: (d.i0 + h + 1) * 60] += (energy - p.get("heater_kw", 2.0) * heater_min / 60)
                return

    def daily(self, d):
        dinner_home = self.meals(d)
        for app, a in APPS.items():
            p = a["profile"]
            kind = p["type"]
            if kind == "session":
                self.sessions(d, app, p)
            elif kind == "cycle":
                self.cycles(d, app, p, dinner_home)
            elif kind == "always_on":
                per_hour = d.rng.uniform(*p["kwh_per_day"]) / 24 if "kwh_per_day" in p else None
                for h in range(24):
                    awake = len(d.awake(self.ids, h))
                    base = per_hour * (1 + 0.04 * awake + d.rng.normal(0, 0.05)) if per_hour else d.rng.uniform(*p["kw"])
                    self.energy[app][d.i0 + h] += max(base, 0)
            elif kind == "lighting":
                for h in range(24):
                    awake = len(d.awake(self.ids, h))
                    rad = self.rad[d.i0 + h]
                    dark = 1.0 if rad < p["dark_below_w_m2"] else 0.4 if rad < 4 * p["dark_below_w_m2"] else 0.0
                    if awake and dark:
                        kw = p["kw"][0] + (p["kw"][1] - p["kw"][0]) * min(1, awake / 3)
                        self.energy[app][d.i0 + h] += kw * dark * d.rng.uniform(0.85, 1.1)
            elif kind == "charging":
                for m in self.ids:
                    for _ in range(d.rng.poisson(p["devices_per_person"])):
                        options = [h for a, b in p["hours"] for h in range(a, b) if d.state(m, h) != AWAY]
                        if options:
                            d.add(app, options[d.rng.integers(len(options))], d.rng.uniform(*p["kwh_per_charge"]) / 1.5, 90)

    # ---------------------------------------------------------------- heat pump
    def heat_pump(self):
        app, h = HEAT["appliance"], HEAT
        cop = h["cop"]
        slope = (cop["at_7c"] - cop["at_minus_7c"]) / 14
        temp_out = self.w["outdoor_temp_c"].to_numpy()
        share = scenario.heating_share(pd.Series(temp_out).rolling(24, min_periods=1).mean())
        rad = self.w["radiation_w_m2"].to_numpy()
        people = self.cal["people_home"].to_numpy()
        hours = self.cal["timestamp"].dt.hour.to_numpy()
        night = set(h["night_hours"])
        cap = h["thermal_capacity_kwh_per_c"]
        indoor = np.zeros(self.n)
        t_in = h["setpoint_day"]
        noise_all = np.random.default_rng([CONFIG["data"]["seed"], 3]).uniform(0.94, 1.06, self.n)
        for i in range(self.n):
            setpoint = h["setpoint_empty"] if people[i] == 0 else h["setpoint_night"] if hours[i] in night else h["setpoint_day"]
            gains = h["internal_gain_kw_per_person"] * people[i] + h["solar_gain_factor"] * rad[i]
            loss = h["heat_loss_kw_per_c"] * (t_in - temp_out[i])
            c = float(np.clip(cop["at_7c"] + slope * (temp_out[i] - 7), cop["min"], cop["max"]))
            heat = share[i] * float(np.clip(cap * (setpoint - t_in) + loss - gains, 0, h["max_kw"] * c))
            noise = noise_all[i]
            self.energy[app][i] = heat / c * noise
            t_in += (heat - loss + gains) / cap
            indoor[i] = t_in
        return indoor

    def peaks(self):
        """Highest 1-minute power (kW) of every hour: cooking + cycle heaters (minute profile),
        the heat pump (runs at ≥ 1.5 kW, cycling when less is needed) and the steady loads."""
        h = HEAT
        rng = np.random.default_rng([CONFIG["data"]["seed"], 4])
        minute = self.minute.reshape(self.n, 60).copy()
        steady = sum(self.energy[a] for a in APPS if a not in self.eventful and a != h["appliance"])
        minute += steady[:, None]
        hp = self.energy[h["appliance"]]
        for i in np.flatnonzero(hp > 0):
            if hp[i] >= h["min_run_kw"]:
                minute[i] += hp[i]
            else:  # cycling: min_run_kw for part of the hour
                run = int(round(hp[i] / h["min_run_kw"] * 60))
                start = int(rng.integers(0, 61 - run)) if run < 60 else 0
                minute[i, start: start + run] += h["min_run_kw"]
        return minute.max(axis=1)

    def run(self):
        self.eventful = {app for meal in CONFIG["meals"] for app in meal["uses"]} | {
            a for a, x in APPS.items() if x["profile"]["type"] == "cycle"}
        for k, (_, cal) in enumerate(self.cal.groupby(self.cal["timestamp"].dt.date, sort=True)):
            self.daily(Day(self, k, cal.reset_index(drop=True)))
        indoor = self.heat_pump()
        out = pd.concat([self.w, self.cal.drop(columns="timestamp")], axis=1)
        for app in APPS:
            out[app] = np.round(self.energy[app], 4)
        out["indoor_temp_c"] = np.round(indoor, 2)
        out[CONFIG["data"]["total_column"]] = out[list(APPS)].sum(axis=1).round(4)
        out["peak_kw"] = np.maximum(np.round(self.peaks(), 3), out[CONFIG["data"]["total_column"]])
        return out


def main():
    hist_w, fut_w = weather.load("weather_history_file"), weather.load("weather_forecast_file")
    start, end = scenario.history_range()
    hist_w = hist_w[(hist_w["timestamp"] >= pd.Timestamp(start)) & (hist_w["timestamp"] < pd.Timestamp(end) + pd.Timedelta(days=1))]
    fut_w = fut_w[fut_w["timestamp"] > hist_w["timestamp"].max()]
    all_w = pd.concat([hist_w, fut_w], ignore_index=True)
    cal = household.calendar(all_w["timestamp"].min().date(), all_w["timestamp"].max().date(), actual=True)

    print(f"Simulating {CONFIG['household']['name']}: {len(all_w) // 24} days "
          f"({all_w['timestamp'].min():%d %b %Y} → {all_w['timestamp'].max():%d %b %Y}, real Katowice weather)...")
    sim = Simulation(all_w, cal).run()

    split = sim["timestamp"] <= pd.Timestamp(end) + pd.Timedelta(hours=23)
    history, truth = sim[split], sim[~split]
    history.to_csv(scenario.path("history_file"), index=False)
    truth.to_csv(scenario.path("future_truth_file"), index=False)

    total = CONFIG["data"]["total_column"]
    days = len(history) / 24
    year = history[total].sum() * 365 / days
    print(f"\nHistory: {len(history):,} hours ({days:.0f} days) → {scenario.rel(scenario.path('history_file'))}")
    print(f"Hidden truth for the forecast week: {len(truth)} hours → {scenario.rel(scenario.path('future_truth_file'))}")
    print(f"Consumption: {history[total].sum() / days:.1f} kWh/day on average · ≈ {year:,.0f} kWh per year")
    print(f"Heat pump ≈ {history[HEAT['appliance']].sum() * 365 / days:,.0f} kWh/yr · other appliances ≈ "
          f"{(history[total] - history[HEAT['appliance']]).sum() * 365 / days:,.0f} kWh/yr")
    print(f"Peak hour: {history[total].max():.2f} kWh ({history.loc[history[total].idxmax(), 'timestamp']:%d %b %H:00}) · "
          f"highest 1-minute power {history['peak_kw'].max():.1f} kW · typical evening short peak "
          f"{history.loc[history['timestamp'].dt.hour.isin([18, 19]), 'peak_kw'].median():.1f} kW")
    monthly = history.groupby(history["timestamp"].dt.to_period("M"))[total].sum() / history.groupby(history["timestamp"].dt.to_period("M")).size() * 24
    print("kWh/day by month: " + "  ".join(f"{p.strftime('%b')} {v:.0f}" for p, v in monthly.items()))
    print("\nBy appliance (per year):")
    for app in sorted(APPS, key=lambda a: -history[a].sum()):
        print(f"  {APPS[app]['name']:<24} {history[app].sum() * 365 / days:>7,.0f} kWh  ({history[app].sum() / history[total].sum() * 100:4.1f}%)")


if __name__ == "__main__":
    main()
