import { APPLIANCE_IDS, SCENARIO, hh, type Horizon, type HorizonDay, type HorizonHour, type HorizonPeriod } from "../../../shared/types";
import { loadHorizon, loadPeriodRanges, loadScenarioRaw, num, type Row } from "../providers/energyData";
import { presenceOf } from "./presence";

/*
 * 24 h / 3-day / 7-day views of the forecast (model-training/output/forecast_7d.csv):
 * totals with likely ranges (from the backtest), peak hours, daily break-down and
 * plain-language explanations of the expected increase or decrease — weather
 * (heating) and the family's planned routine (shifts, home office, school).
 */

const round = (v: number, d = 2) => +v.toFixed(d);
const SHIFT = ["day off", "morning shift", "afternoon shift", "night shift"];
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const actualOf = (r: Row) => (r.actual_total_kwh ? num(r, "actual_total_kwh") : null);
const sumActual = (rs: Row[]) => (rs.every((r) => actualOf(r) !== null) ? rs.reduce((s, r) => s + actualOf(r)!, 0) : null);

/** Planned day type from the forecast columns, e.g. "Marek: night shift · Ania: home office · school day". */
function dayType(r: Row): string {
  const parts: string[] = [];
  if ("marek_shift" in r) parts.push(`Marek: ${SHIFT[num(r, "marek_shift")] ?? "—"}`);
  if ("home_office" in r) parts.push(`Ania: ${num(r, "home_office") ? "home office" : num(r, "free_day") ? "at home" : "office"}`);
  if ("school_day" in r) parts.push(num(r, "school_day") ? "school day" : "no school");
  return parts.join(" · ");
}

function buildDays(rows: Row[], heatId: string | null): HorizonDay[] {
  const byDate = new Map<string, Row[]>();
  for (const r of rows) byDate.set(r.timestamp.slice(0, 10), [...(byDate.get(r.timestamp.slice(0, 10)) ?? []), r]);

  const days = [...byDate.entries()].map(([date, rs]) => {
    const peak = rs.reduce((a, b) => (num(b, "predicted_total_kwh") > num(a, "predicted_total_kwh") ? b : a));
    const temps = rs.map((r) => num(r, "outdoor_temp_c"));
    const actual = sumActual(rs);
    return {
      date,
      label: dayLabel(date),
      forecastKwh: round(rs.reduce((s, r) => s + num(r, "predicted_total_kwh"), 0), 1),
      actualKwh: actual === null ? null : round(actual, 1),
      heatingKwh: heatId ? round(rs.reduce((s, r) => s + num(r, heatId), 0), 1) : 0,
      avgTemp: round(temps.reduce((s, v) => s + v, 0) / temps.length, 1),
      minTemp: round(Math.min(...temps), 1),
      peakHour: num(peak, "hour"),
      peakKwh: round(num(peak, "predicted_total_kwh")),
      dayType: dayType(rs[12] ?? rs[0]),
      peopleHours: rs.reduce((s, r) => s + num(r, "people_home"), 0),
      explanation: "",
    };
  });

  const avg = (f: (d: (typeof days)[number]) => number) => days.reduce((s, d) => s + f(d), 0) / days.length;
  const avgKwh = avg((d) => d.forecastKwh);
  const avgTemp = avg((d) => d.avgTemp);
  const avgPeople = avg((d) => d.peopleHours);
  return days.map(({ peopleHours, ...d }) => {
    const diff = ((d.forecastKwh - avgKwh) / avgKwh) * 100;
    const dT = d.avgTemp - avgTemp;
    let explanation: string;
    if (days.length === 1) {
      explanation = `${d.forecastKwh.toFixed(1)} kWh expected at ${d.avgTemp.toFixed(1)} °C on average; busiest at ${hh(d.peakHour)}. ${d.dayType}.`;
    } else if (Math.abs(diff) < 4) {
      explanation = `Close to the period average (${diff >= 0 ? "+" : ""}${diff.toFixed(0)}%). ${d.dayType}.`;
    } else {
      const why: string[] = [];
      if (heatId && Math.abs(dT) >= 0.8) {
        why.push(dT < 0 ? `${Math.abs(dT).toFixed(1)} °C colder → more heating (${d.heatingKwh.toFixed(0)} kWh)` : `${dT.toFixed(1)} °C milder → less heating (${d.heatingKwh.toFixed(0)} kWh)`);
      }
      const people = peopleHours - avgPeople;
      if (Math.abs(people) >= 6) why.push(people > 0 ? "more people at home during the day" : "the house is empty for longer");
      if (!why.length) why.push(diff > 0 ? `more appliance use (peak ${d.peakKwh.toFixed(2)} kWh at ${hh(d.peakHour)})` : "less appliance use than usual");
      explanation = `${diff > 0 ? "+" : ""}${diff.toFixed(0)}% vs the period average — ${why.join("; ")}. ${d.dayType}.`;
    }
    return { ...d, explanation };
  });
}

function buildPeriod(rows: Row[], days: number, heatId: string | null): HorizonPeriod {
  const part = rows.slice(0, days * 24);
  const forecastKwh = part.reduce((s, r) => s + num(r, "predicted_total_kwh"), 0);
  const actualKwh = sumActual(part);
  const temps = part.map((r) => num(r, "outdoor_temp_c"));
  const peakHours = [...part]
    .sort((a, b) => num(b, "predicted_total_kwh") - num(a, "predicted_total_kwh"))
    .slice(0, 3)
    .map((r) => ({ timestamp: r.timestamp, kwh: round(num(r, "predicted_total_kwh")) }));
  const daily = buildDays(part, heatId);

  // Typical hour-of-day profile over the period, to name the daily peak window.
  const byHour = Array.from({ length: 24 }, (_, h) => {
    const rs = part.filter((r) => num(r, "hour") === h);
    return rs.reduce((s, r) => s + num(r, "predicted_total_kwh"), 0) / Math.max(1, rs.length);
  });
  const topHours = byHour
    .map((v, h) => ({ h, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 2)
    .map((x) => x.h)
    .sort((a, b) => a - b);

  const summary: string[] = [];
  summary.push(
    days === 1
      ? `Expected consumption: ${forecastKwh.toFixed(1)} kWh over the next 24 hours, at an average outdoor temperature of ${(temps.reduce((s, v) => s + v, 0) / temps.length).toFixed(1)} °C.`
      : `Expected consumption: ${forecastKwh.toFixed(1)} kWh over ${days} days (${(forecastKwh / days).toFixed(1)} kWh per day), at an average outdoor temperature of ${(temps.reduce((s, v) => s + v, 0) / temps.length).toFixed(1)} °C.`,
  );
  const reason = (h: number) =>
    h < 10 ? "heat pump morning recovery and breakfast" : h >= 17 ? "dinner, screens and heating with the whole family at home" : "daytime activity";
  const groups = new Map<string, number[]>();
  for (const h of topHours) groups.set(reason(h), [...(groups.get(reason(h)) ?? []), h]);
  summary.push(`Peak demand is expected at ${[...groups].map(([r, hs]) => `${hs.map(hh).join(" and ")} (${r})`).join(" and ")}.`);
  if (daily.length > 1) {
    const hi = daily.reduce((a, b) => (b.forecastKwh > a.forecastKwh ? b : a));
    const lo = daily.reduce((a, b) => (b.forecastKwh < a.forecastKwh ? b : a));
    summary.push(
      `Highest consumption on ${hi.label} (${hi.forecastKwh.toFixed(1)} kWh, ${hi.avgTemp.toFixed(1)} °C); lowest on ${lo.label} (${lo.forecastKwh.toFixed(1)} kWh, ${lo.avgTemp.toFixed(1)} °C).`,
    );
    const first = daily[0].forecastKwh;
    const last = daily[daily.length - 1].forecastKwh;
    const trend = ((last - first) / first) * 100;
    if (Math.abs(trend) >= 5) {
      const dT = daily[daily.length - 1].avgTemp - daily[0].avgTemp;
      summary.push(
        `Consumption ${trend > 0 ? "increases" : "decreases"} by ${Math.abs(trend).toFixed(0)} % from the first to the last day${heatId && Math.abs(dT) >= 1 ? `, as temperatures ${dT < 0 ? "fall" : "rise"} by ${Math.abs(dT).toFixed(1)} °C and heating demand ${dT < 0 ? "increases" : "decreases"}` : ""}.`,
      );
    }
  }
  if (heatId) {
    const heating = part.reduce((s, r) => s + num(r, heatId), 0);
    summary.push(`Heating accounts for ${Math.round((heating / forecastKwh) * 100)} % of the expected consumption.`);
  }

  const range = loadPeriodRanges()[String(days)];
  return {
    days,
    label: days === 1 ? "24 h" : `${days} days`,
    start: part[0].timestamp,
    end: part[part.length - 1].timestamp,
    forecastKwh: round(forecastKwh, 1),
    safeForecastKwh: round(part.reduce((s, r) => s + num(r, "safe_predicted_total_kwh"), 0), 1),
    actualKwh: actualKwh === null ? null : round(actualKwh, 1),
    errorPct: actualKwh ? round(((forecastKwh - actualKwh) / actualKwh) * 100, 1) : null,
    mae: actualKwh === null ? null : round(part.reduce((s, r) => s + Math.abs(num(r, "predicted_total_kwh") - actualOf(r)!), 0) / part.length, 3),
    lowKwh: range ? range.low_kwh : round(forecastKwh * 0.85, 1),
    highKwh: range ? range.high_kwh : round(forecastKwh * 1.1, 1),
    avgTemp: round(temps.reduce((s, v) => s + v, 0) / temps.length, 1),
    minTemp: round(Math.min(...temps), 1),
    maxTemp: round(Math.max(...temps), 1),
    peakHours,
    daily,
    summary,
  };
}

export function buildHorizon(): Horizon | null {
  const rows = loadHorizon();
  if (!rows.length) return null;
  const heatId = SCENARIO.heatingAppliance ?? null;
  const wanted: number[] = loadScenarioRaw().horizon_days ?? [1, 3, 7];
  const available = Math.floor(rows.length / 24);
  const periods = [...new Set(wanted)]
    .filter((d) => d >= 1 && d <= available)
    .sort((a, b) => a - b)
    .map((d) => buildPeriod(rows, d, heatId));

  const hours: HorizonHour[] = rows.map((r) => ({
    timestamp: r.timestamp,
    hour: num(r, "hour"),
    forecast: round(num(r, "predicted_total_kwh"), 3),
    safeForecast: round(num(r, "safe_predicted_total_kwh"), 3),
    lowForecast: round(num(r, "low_total_kwh"), 3),
    actual: actualOf(r) === null ? null : round(actualOf(r)!, 3),
    outdoorTemp: num(r, "outdoor_temp_c"),
    peakKw: round(Math.max(num(r, "peak_kw"), num(r, "predicted_total_kwh")), 2),
    presence: presenceOf(r),
    byAppliance: Object.fromEntries(APPLIANCE_IDS.map((id) => [id, round(num(r, id), 3)])),
  }));
  return { start: rows[0].timestamp, hours, periods };
}
