import { APPLIANCES, SCENARIO, hh, money, type HeatingPlan, type HourPlan, type Insight } from "../../../shared/types";
import { loadScenarioRaw, num, type Row } from "../providers/energyData";

/*
 * Rule-based, personalised insights from the household's own data: the hourly
 * history, today's XGBoost forecast and the OR-Tools plan. Which appliances
 * are heating, always-on or flexible comes from scenario.json. Prices use the
 * plan's tariff.
 */

const cur = (v: number) => `${SCENARIO.currency}${Math.round(v).toLocaleString("en")}`;
const kwh = (v: number) => `${Math.round(v).toLocaleString("en")} kWh`;

/** [start, end) clock hours, wrapping past midnight when start > end — same rule as scenario.py. */
function windowHours([start, end]: [number, number]) {
  const hours: number[] = [];
  for (let h = start; h !== end; h = (h + 1) % 24) hours.push(h);
  return hours;
}

type Day = { heating: number; total: number; temp: number; hours: number; used: Record<string, number> };

export function buildInsights(history: Row[], hours: HourPlan[], heating: HeatingPlan): Insight[] {
  const who = SCENARIO.household.name || "the household";
  const heatId = SCENARIO.heatingAppliance;
  const priceAt = new Map(hours.map((h) => [h.hour, h.price]));
  const price = (hour: number) => priceAt.get(hour) ?? 0;
  const avgPrice = hours.reduce((s, h) => s + h.price, 0) / hours.length;
  const cheapest = Math.min(...hours.map((h) => h.price));
  const alwaysOn = APPLIANCES.filter((a) => a.alwaysOn).map((a) => a.id);
  const occasional = APPLIANCES.filter((a) => !a.alwaysOn && !a.flexible && a.id !== heatId).map((a) => a.id);

  const days = new Map<string, Day>();
  let annualTotal = 0;
  let annualHeating = 0;
  let annualCost = 0;
  let alwaysOnKwh = 0;
  let alwaysOnCost = 0;
  const hourly = Array.from({ length: 24 }, () => ({ total: 0, heating: 0, n: 0 }));
  const applianceYear: Record<string, { kwh: number; cost: number }> = {};

  for (const r of history) {
    const h = num(r, "hour");
    const total = num(r, "total_consumption_kwh");
    const heat = heatId ? num(r, heatId) : 0;
    annualTotal += total;
    annualHeating += heat;
    annualCost += total * price(h);
    for (const id of alwaysOn) {
      alwaysOnKwh += num(r, id);
      alwaysOnCost += num(r, id) * price(h);
    }
    hourly[h].total += total;
    hourly[h].heating += heat;
    hourly[h].n++;

    const key = r.timestamp.slice(0, 10);
    const d = days.get(key) ?? { heating: 0, total: 0, temp: 0, hours: 0, used: {} };
    d.heating += heat;
    d.total += total;
    d.temp += num(r, "outdoor_temp_c");
    d.hours++;
    for (const id of occasional) {
      const v = num(r, id);
      d.used[id] = (d.used[id] ?? 0) + v;
      const y = (applianceYear[id] ??= { kwh: 0, cost: 0 });
      y.kwh += v;
      y.cost += v * price(h);
    }
    days.set(key, d);
  }

  const dayList = [...days.values()].map((d) => ({ ...d, temp: d.temp / d.hours }));
  const insights: Insight[] = [];

  if (heatId && annualHeating > 0) {
    // 1. Heating share of the bill
    const heatingShare = annualHeating / annualTotal;
    insights.push({
      id: "heating-share",
      title: heatingShare >= 0.4 ? "Heating is your biggest cost" : "Heating share",
      value: `${Math.round(heatingShare * 100)}%`,
      detail: `${kwh(annualHeating)} of your ${kwh(annualTotal)} a year goes to heating (≈ ${cur(annualHeating * avgPrice)} of ${cur(annualCost)}).`,
      tip: heatingShare >= 0.4 ? "Small changes to heating matter more than anything else in the house." : undefined,
      tone: heatingShare >= 0.4 ? "peak" : "info",
    });

    // 2. Weather sensitivity: least-squares slope of daily heating vs daily mean temperature
    const heatingDays = dayList.filter((d) => d.heating > 0.5);
    if (heatingDays.length > 10) {
      const mt = heatingDays.reduce((s, d) => s + d.temp, 0) / heatingDays.length;
      const mh = heatingDays.reduce((s, d) => s + d.heating, 0) / heatingDays.length;
      const slope =
        heatingDays.reduce((s, d) => s + (d.temp - mt) * (d.heating - mh), 0) / heatingDays.reduce((s, d) => s + (d.temp - mt) ** 2, 0);
      const perDegree = Math.abs(slope);
      insights.push({
        id: "weather",
        title: "Every degree colder costs you",
        value: `+${perDegree.toFixed(1)} kWh/day`,
        detail: `Each 1 °C drop in outdoor temperature adds about ${perDegree.toFixed(1)} kWh of heating per day (≈ ${money(perDegree * avgPrice)}).`,
        tip: "Lowering the indoor setpoint by 1 °C saves roughly the same as a 1 °C warmer day.",
        tone: "info",
      });
    }
  }

  // 3. Today versus days with similar weather (a mild autumn day is not compared with January)
  const todayKwh = hours.reduce((s, h) => s + h.forecastLoad, 0);
  const todayTemp = hours.reduce((s, h) => s + h.outdoorTemp, 0) / hours.length;
  const similar = dayList.filter((d) => d.hours === 24 && Math.abs(d.temp - todayTemp) <= 2);
  const todayHeat = hours.reduce((s, h) => s + h.heatingUsual, 0);
  const todayMin = Math.min(...hours.map((h) => h.outdoorTemp));
  const base = similar.length >= 5 ? similar : dayList;
  const avgDay = base.reduce((s, d) => s + d.total, 0) / base.length;
  const vsAvg = (todayKwh / avgDay - 1) * 100;
  const light = vsAvg < -5;
  const high = vsAvg > 5;
  insights.push({
    id: "today",
    title: high ? "Today is a high-demand day" : light ? "Today is a light day" : "Today is a normal day",
    value: `${vsAvg >= 0 ? "+" : ""}${Math.round(vsAvg)}%`,
    detail:
      similar.length >= 5
        ? `${todayKwh.toFixed(1)} kWh forecast vs ${avgDay.toFixed(1)} kWh on an average past day with similar weather (${similar.length} days at ${(todayTemp - 2).toFixed(0)}–${(todayTemp + 2).toFixed(0)} °C).${
            heatId ? ` Heating today ${todayHeat.toFixed(1)} kWh vs ${(base.reduce((s, d) => s + d.heating, 0) / base.length).toFixed(1)} kWh on those days — coldest hour ${todayMin.toFixed(1)} °C.` : ""
          }`
        : `${todayKwh.toFixed(1)} kWh forecast vs your ${avgDay.toFixed(1)} kWh average day.`,
    tip: high ? "Follow today's actions: the plan pays off most on high-demand days." : undefined,
    tone: high ? "peak" : light ? "saving" : "info",
  });

  // 4. Typical daily peak (excluding heating) and when it happens
  const profile = hourly.map((x, h) => ({ h, other: (x.total - x.heating) / Math.max(1, x.n) }));
  const peak = [...profile].sort((a, b) => b.other - a.other).slice(0, 2).sort((a, b) => a.h - b.h);
  insights.push({
    id: "peak",
    title: "Your daily peak",
    value: peak.map((p) => hh(p.h)).join(" & "),
    detail: `Appliances add ${peak.map((p) => `${p.other.toFixed(2)} kWh at ${hh(p.h)}`).join(" and ")}${heatId ? " on top of heating" : ""}, at ${money(price(peak[0].h))}/kWh.`,
    tip: "Avoid starting flexible appliances in these hours.",
    tone: "peak",
  });

  // 5. The biggest occasional appliance (used on some days only)
  const candidates = occasional
    .map((id) => {
      const usedDays = dayList.filter((d) => (d.used[id] ?? 0) > 0.1);
      return { id, usedDays, year: applianceYear[id] ?? { kwh: 0, cost: 0 } };
    })
    .filter((c) => c.usedDays.length > 0 && c.usedDays.length < 0.8 * dayList.length && c.year.kwh > 20)
    .sort((a, b) => b.year.kwh - a.year.kwh);
  if (candidates.length) {
    const c = candidates[0];
    const name = APPLIANCES.find((a) => a.id === c.id)!.name;
    insights.push({
      id: "occasional",
      title: `The ${name.toLowerCase()} is a big occasional load`,
      value: `${c.usedDays.length} days/yr`,
      detail: `On days it is used it takes ${(c.year.kwh / c.usedDays.length).toFixed(1)} kWh — ${kwh(c.year.kwh)} a year (≈ ${cur(c.year.cost)}).`,
      tip: APPLIANCES.find((a) => a.id === c.id)?.peakTip,
      tone: "info",
    });
  }

  // 6. Flexible appliance timing across the whole year
  const raw = loadScenarioRaw();
  for (const a of raw.appliances.filter((x: any) => x.flexible)) {
    const allowed = new Set(windowHours(a.flexible.window));
    const runs = history.filter((r) => num(r, a.id) > 0);
    if (!runs.length) continue;
    const best = Math.min(...[...allowed].map(price));
    const energy = runs.reduce((s, r) => s + num(r, a.id), 0);
    const saving = runs.reduce((s, r) => s + num(r, a.id) * (price(num(r, "hour")) - best), 0);
    const counts = runs.reduce((m, r) => m.set(num(r, "hour"), (m.get(num(r, "hour")) ?? 0) + 1), new Map<number, number>());
    const topHour = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const expensive = hours.filter((h) => h.price === Math.max(...hours.map((x) => x.price))).map((h) => h.hour);
    insights.push({
      id: `timing-${a.id}`,
      title: `${a.name} timing`,
      value: saving >= 1 ? `${cur(saving)}/yr` : "same cost",
      detail: `${runs.length} cycles a year (${kwh(energy)}), most often at ${hh(topHour)}.${
        saving >= 1 ? ` Running every cycle at the cheapest allowed hour saves about ${cur(saving)} a year.` : " With your tariff every allowed hour costs the same."
      }`,
      tip:
        saving >= 1
          ? `Best price: ${money(best)}/kWh${best === cheapest ? " (the cheapest hours of the day)" : ""}.`
          : `Just avoid ${hh(expensive[0])}–${hh(expensive[expensive.length - 1] + 1)}, the most expensive hours.`,
      tone: saving >= 1 ? "saving" : "info",
    });
  }

  // 7. Heat-ahead plan scaled to the year (explicit estimate)
  if (heatId && heating.usualKwh > 0 && heating.saving > 0) {
    const perKwh = heating.saving / heating.usualKwh;
    insights.push({
      id: "heat-ahead",
      title: "Heat-ahead over a year",
      value: `≈ ${cur(perKwh * annualHeating)}/yr`,
      detail: `Today's plan saves ${money(heating.saving)} on ${heating.usualKwh.toFixed(0)} kWh of heating. Applied to your ${kwh(annualHeating)} of yearly heating that is roughly ${cur(perKwh * annualHeating)} (estimate).`,
      tip: "Needs a heat-pump controller or smart thermostat that can follow a schedule.",
      tone: "saving",
    });
  }

  // 8. Always-on devices
  if (alwaysOn.length) {
    insights.push({
      id: "always-on",
      title: "Always-on devices",
      value: `${cur(alwaysOnCost)}/yr`,
      detail: `${APPLIANCES.filter((a) => a.alwaysOn).map((a) => a.name).join(", ")} use ${kwh(alwaysOnKwh)} a year, around the clock.`,
      tip: "A switchable power strip removes part of the standby load.",
      tone: "info",
    });
  }

  // 9–11. Family routine (Scenario 2): shift weeks, home-office days, the evening peak
  if (history.length && "marek_shift" in history[0]) {
    const nonHeating = (r: Row) => num(r, "total_consumption_kwh") - (heatId ? num(r, heatId) : 0);
    const perDay = (filter: (r: Row) => boolean) => {
      const rs = history.filter(filter);
      const n = new Set(rs.map((r) => r.timestamp.slice(0, 10))).size;
      return n ? rs.reduce((s, r) => s + nonHeating(r), 0) / n : 0;
    };
    const weekday = (r: Row) => new Date(r.timestamp.replace(" ", "T")).getDay() % 6 !== 0;
    const byShift = ["morning", "afternoon", "night"].map((name, i) => ({ name, kwh: perDay((r) => weekday(r) && num(r, "marek_shift") === i + 1) }));
    const hi = byShift.reduce((a, b) => (b.kwh > a.kwh ? b : a));
    const lo = byShift.reduce((a, b) => (b.kwh < a.kwh ? b : a));
    insights.push({
      id: "shift-weeks",
      title: "Marek's shift weeks",
      value: `${hi.kwh.toFixed(1)} vs ${lo.kwh.toFixed(1)} kWh/day`,
      detail: `Without heating, weekdays in ${hi.name}-shift weeks use ${hi.kwh.toFixed(1)} kWh and in ${lo.name}-shift weeks ${lo.kwh.toFixed(1)} kWh (${byShift.map((b) => `${b.name} ${b.kwh.toFixed(1)}`).join(", ")}). The forecast knows the rota in advance.`,
      tip: "In night-shift weeks Marek sleeps 7–14 — quiet appliances (dishwasher, washer) are better started in the evening window or by timer.",
      tone: "info",
    });
    const office = perDay((r) => weekday(r) && num(r, "home_office") === 1);
    const away = perDay((r) => weekday(r) && num(r, "home_office") === 0 && num(r, "holiday") === 0);
    if (office && away) {
      insights.push({
        id: "home-office",
        title: "Ania's home-office days",
        value: `+${(office - away).toFixed(1)} kWh/day`,
        detail: `Home-office weekdays use ${office.toFixed(1)} kWh vs ${away.toFixed(1)} kWh on office days (laptop, lunch cooking, kettle, lighting) — plus the house stays heated to 21 °C instead of 20 °C.`,
        tip: "On home-office days, cook lunch and run the washing machine in the solar/cheaper midday hours instead of the evening.",
        tone: "info",
      });
    }
  }
  if (history.length && "peak_kw" in history[0]) {
    const evening = history.filter((r) => { const h = num(r, "hour"); return h >= 17 && h <= 21; });
    const sorted = evening.map((r) => num(r, "peak_kw")).sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    const avgKwh = evening.reduce((s, r) => s + num(r, "total_consumption_kwh"), 0) / Math.max(1, evening.length);
    const today = Math.max(...hours.map((h) => h.peakKw));
    const at = hours.find((h) => h.peakKw === today);
    insights.push({
      id: "short-peaks",
      title: "Short power peaks",
      value: `up to ${typical.toFixed(1)} kW`,
      detail: `In the evening the hour averages only ${avgKwh.toFixed(1)} kWh, but for a few minutes hob, oven, kettle, dishwasher heater and heat pump run together: on 1 evening in 10 the power reaches ${typical.toFixed(1)} kW. Today's highest expected short peak: ${today.toFixed(1)} kW${at ? ` around ${hh(at.hour)}` : ""}.`,
      tip: "Stagger big loads: boil the kettle before the oven preheats, start the dishwasher after cooking (or by timer at night).",
      tone: "info",
    });
  }
  {
    const peakPrice = Math.max(...hours.map((h) => h.price));
    let peakCost = 0;
    let cost = 0;
    for (const r of history) {
      const p = price(num(r, "hour"));
      cost += num(r, "total_consumption_kwh") * p;
      if (p === peakPrice) peakCost += num(r, "total_consumption_kwh") * p;
    }
    const peakHrs = hours.filter((h) => h.price === peakPrice).map((h) => h.hour);
    if (cost > 0) {
      insights.push({
        id: "evening-peak",
        title: "The evening peak",
        value: `${Math.round((peakCost / cost) * 100)}% of the bill`,
        detail: `${hh(peakHrs[0])}–${hh(peakHrs[peakHrs.length - 1] + 1)} costs ${money(peakPrice)}/kWh and is when the whole family is home (dinner, screens, heating): ${cur(peakCost)} of ${cur(cost)} a year.`,
        tip: "Pre-heat before 17:00, start the dishwasher by timer after midnight, and use the oven before 17:00 on weekends.",
        tone: "saving",
      });
    }
  }

  if (!insights.length) {
    insights.push({ id: "none", title: `No insights yet for ${who}`, value: "—", detail: "Add appliances and history data in scenario.json.", tone: "info" });
  }
  return insights;
}
