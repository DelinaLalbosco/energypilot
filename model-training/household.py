"""
Family calendar: who is at home, awake or asleep, for every hour.

Two layers (scenario.json → members, calendar):
  planned    — known in advance: Marek's shift rota, Ania's home-office days,
               school days, activities, public holidays and school breaks.
               The forecast model is allowed to use these.
  unplanned  — only in the "real" history: weekend outings, family trips,
               evenings out, sick days. The forecast cannot know them, which is
               why forecasts have errors — like in real life.

Every random choice uses a generator seeded by (seed, date), so a given day
always gets the same calendar, whether it is built for the history or for a
forecast.

Member state per hour: 0 = away, 1 = at home and awake, 2 = at home asleep.
"""

from datetime import date, timedelta

import numpy as np
import pandas as pd

import scenario

CONFIG = scenario.load()
CAL = CONFIG["calendar"]
MEMBERS = CONFIG["members"]
SEED = CONFIG["data"]["seed"]
AWAY, AWAKE, ASLEEP = 0, 1, 2
SHIFT_CODE = {"off": 0, "morning": 1, "afternoon": 2, "night": 3}

HOLIDAYS = {date.fromisoformat(d) for d in CAL["public_holidays"]}
BREAKS = [(date.fromisoformat(a), date.fromisoformat(b)) for a, b in CAL["school_breaks"]]


def rng_for(day, layer):
    """Deterministic random generator for one day and one layer (0 planned, 1 unplanned)."""
    return np.random.default_rng([SEED, day.toordinal(), layer])


def is_school_day(day):
    return day.weekday() < 5 and day not in HOLIDAYS and not any(a <= day <= b for a, b in BREAKS)


def marek_shift(day):
    """Shift type Marek works on this day (off at weekends and holidays, rota changes weekly)."""
    s = CAL["shift"]
    week = (day - date.fromisoformat(s["rotation_start"])).days // 7
    kind = s["rotation"][week % len(s["rotation"])]
    if day in HOLIDAYS or day.weekday() == 6:
        return "off"
    if day.weekday() == 5:
        return kind if rng_for(day, 0).random() < s["saturday_shift_probability"] else "off"
    return kind


def ania_home_office(day):
    h = CAL["hybrid"]
    if day.weekday() >= 5 or day in HOLIDAYS:
        return False
    return day.weekday() in h["home_office_weekdays"] or rng_for(day, 0).random() < h["extra_home_office_probability"]


def _fill(states, hours, value):
    for h in hours:
        states[h % 24] = value


def _marek(day):
    today, before = marek_shift(day), marek_shift(day - timedelta(days=1))
    s = [ASLEEP] * 24
    if today == "morning":
        _fill(s, range(5, 6), AWAKE); _fill(s, range(6, 15), AWAY); _fill(s, range(15, 22), AWAKE)
    elif today == "afternoon":
        _fill(s, range(8, 14), AWAKE); _fill(s, range(14, 23), AWAY); _fill(s, [23], AWAKE)
    elif today == "night":
        _fill(s, range(8, 22), AWAKE); _fill(s, range(22, 24), AWAY)
    else:
        _fill(s, range(8, 23), AWAKE)
    # the previous day's shift spills into the early hours
    if before == "night":
        _fill(s, range(0, 7), AWAY)
        rest_until = 14 if today == "night" else 12
        _fill(s, range(7, rest_until), ASLEEP)
        _fill(s, range(rest_until, 14), AWAKE)
    elif before == "afternoon":
        s[0] = AWAKE
    return s


def _ania(day):
    s = [ASLEEP] * 24
    if day.weekday() >= 5 or day in HOLIDAYS:
        _fill(s, range(8, 24), AWAKE)
        return s
    _fill(s, range(6, 23), AWAKE)
    if not ania_home_office(day):
        _fill(s, range(8, 17), AWAY)
    return s


def _child(day, member):
    s = [ASLEEP] * 24
    bed = int(member["bedtime"] + 0.5)          # 21.5 → awake through 21:xx
    if is_school_day(day):
        _fill(s, range(6, bed), AWAKE)
        _fill(s, range(CAL["school"]["away_from"], member["school_until"]), AWAY)
        for act in CAL["activities"]:
            if act["member"] == member["id"] and day.weekday() in act["weekdays"]:
                _fill(s, range(*act["away"]), AWAY)
    else:
        _fill(s, range(9, min(24, bed + 1)), AWAKE)
    return s


def planned_day(day):
    """{member id: 24 states} for the planned calendar."""
    out = {}
    for m in MEMBERS:
        if m["schedule"] == "shift":
            out[m["id"]] = _marek(day)
        elif m["schedule"] == "hybrid":
            out[m["id"]] = _ania(day)
        else:
            out[m["id"]] = _child(day, m)
    return out


def trip_weekend(day):
    """Whole family away Saturday 09:00 → Sunday 18:00 (decided per weekend)."""
    saturday = day - timedelta(days=day.weekday() - 5) if day.weekday() >= 5 else None
    if saturday is None or marek_shift(saturday) != "off":
        return False
    return rng_for(saturday, 1).random() < CAL["unplanned"]["family_trip_probability_per_weekend"]


def actual_day(day):
    """Planned calendar plus the unplanned events of that day."""
    states = planned_day(day)
    u = CAL["unplanned"]
    rng = rng_for(day, 1)

    if trip_weekend(day):
        hours = range(9, 24) if day.weekday() == 5 else range(0, 18)
        for s in states.values():
            _fill(s, hours, AWAY)
        return states

    if day.weekday() >= 5 and rng.random() < u["weekend_family_outing_probability"]:
        start = int(rng.integers(*u["outing_hours"]))
        length = int(rng.integers(u["outing_length_hours"][0], u["outing_length_hours"][1] + 1))
        for s in states.values():
            for h in range(start, min(24, start + length)):
                if s[h] == AWAKE:
                    s[h] = AWAY

    for m in MEMBERS:
        s = states[m["id"]]
        if m["adult"] and rng.random() < u["evening_out_probability"]:
            _fill(s, [h for h in range(19, 23) if s[h] == AWAKE], AWAY)
        if not m["adult"] and is_school_day(day) and rng.random() < u["sick_day_probability"]:
            _fill(s, [h for h in range(8, 21) if s[h] == AWAY], AWAKE)
    return states


def calendar(start, end, actual=True):
    """
    Hourly calendar for the days start..end (inclusive).
    Columns: timestamp, <member>_home (0/1/2), people_home, people_awake, kids_home,
             school_day, holiday, home_office, marek_shift (0 off, 1 morning, 2 afternoon, 3 night)
    """
    rows = []
    day = start
    while day <= end:
        states = actual_day(day) if actual else planned_day(day)
        shift = SHIFT_CODE[marek_shift(day)]
        office = int(ania_home_office(day))
        school = int(is_school_day(day))
        holiday = int(day in HOLIDAYS or day.weekday() >= 5)
        for h in range(24):
            row = {"timestamp": pd.Timestamp(day) + pd.Timedelta(hours=h)}
            for m in MEMBERS:
                row[f"{m['id']}_home"] = states[m["id"]][h]
            row.update(school_day=school, holiday=holiday, home_office=office, marek_shift=shift)
            rows.append(row)
        day += timedelta(days=1)

    df = pd.DataFrame(rows)
    homes = df[[f"{m['id']}_home" for m in MEMBERS]]
    kids = [f"{m['id']}_home" for m in MEMBERS if not m["adult"]]
    df["people_home"] = (homes > 0).sum(axis=1)
    df["people_awake"] = (homes == AWAKE).sum(axis=1)
    df["kids_home"] = (df[kids] > 0).sum(axis=1)
    return df


if __name__ == "__main__":
    start = date.today()
    cal = calendar(start, start + timedelta(days=6), actual=False)
    for day, g in cal.groupby(cal["timestamp"].dt.date):
        shift = {v: k for k, v in SHIFT_CODE.items()}[g["marek_shift"].iloc[0]]
        print(f"{day:%a %d %b}  Marek: {shift:<9} Ania home-office: {'yes' if g['home_office'].iloc[0] else 'no ':<3}  "
              f"school: {'yes' if g['school_day'].iloc[0] else 'no'}")
        for m in MEMBERS:
            line = "".join(" .zZ"[0] if v == AWAY else ("o" if v == AWAKE else "z") for v in g[f"{m['id']}_home"])
            print(f"    {m['name']:<6} {line.replace(' ', '·')}")
