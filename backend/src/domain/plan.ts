import {
  APPLIANCES,
  APPLIANCE_IDS,
  ROOMS,
  SCENARIO,
  applianceName,
  hh,
  money,
  type ApplianceId,
  type HourAction,
  type HourPlan,
  type LiveAlert,
  type Presence,
  type PlanResponse,
  type Recommendation,
  type RoomId,
  type SolarScenario,
} from "../../../shared/types";
import { historyFile, loadAccuracy, loadHistory, loadPlan, loadReadings, loadScenario, loadScenarios, num, planFile, type Row } from "../providers/energyData";
import { buildHorizon } from "./horizon";
import { presenceChange, presenceOf } from "./presence";
import { freshness } from "../providers/pipelineRefresh";
import { buildInsights } from "./insights";

/*
 * Turns the Python outputs into the dashboard contract. All decisions
 * (heat pump, appliance hours) come from model-training/smart_optimizer.py; this file
 * only adds peak hours, explanations (incl. who comes home / leaves) and advice.
 */

type ByAppliance = Record<ApplianceId, number>;

type Flexible = { id: ApplianceId; usual: string; opt: string; window: string };

/** Flexible appliances from scenario.json that smart_optimizer.py scheduled (same column naming as scenario.py). */
function flexibleColumns(sample: Row | undefined): Flexible[] {
  const base = (id: string) => id.replace(/_kwh$/, "");
  return APPLIANCES.filter((a) => a.flexible)
    .map((a) => ({ id: a.id, usual: `${base(a.id)}_usual_kwh`, opt: `${base(a.id)}_opt_kwh`, window: a.windowLabel ?? "" }))
    .filter((f) => sample && f.opt in sample);
}
/** Heating counts as shifted when it differs from the forecast by more than this (kWh). */
const SHIFT_KWH = 0.5;

const round = (v: number, d = 3) => +v.toFixed(d);
const zeros = (): ByAppliance => Object.fromEntries(APPLIANCE_IDS.map((id) => [id, 0])) as ByAppliance;
const pick = (by: ByAppliance): ByAppliance =>
  Object.fromEntries(APPLIANCE_IDS.map((id) => [id, round(by[id])])) as ByAppliance;

function roomLoad(by: ByAppliance): Record<RoomId, number> {
  return Object.fromEntries(
    ROOMS.map((r) => [r.id, round(APPLIANCES.filter((a) => a.room === r.id).reduce((s, a) => s + by[a.id], 0), 2)]),
  ) as Record<RoomId, number>;
}

/** Explains the change in the forecast versus the previous hour. */
function explainChange(prev: HourPlan | undefined, cur: { load: number; by: ByAppliance; temp: number; presence: Presence }) {
  if (!prev) return `Forecast starts at ${cur.load.toFixed(2)} kWh.`;
  const people = presenceChange(prev.presence, cur.presence);
  const diff = cur.load - prev.forecastLoad;
  if (Math.abs(diff) < 0.15) return `Demand is stable compared with ${hh(prev.hour)}${people ? ` (${people})` : ""}.`;
  const deltas = APPLIANCE_IDS.map((id) => ({ id, d: cur.by[id] - prev.forecastByAppliance[id] }))
    .filter((x) => Math.sign(x.d) === Math.sign(diff) && Math.abs(x.d) >= 0.05)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 2);
  const drivers = deltas.map((x) => `${applianceName(x.id).toLowerCase()} (${x.d > 0 ? "+" : ""}${x.d.toFixed(2)})`);
  let text = `Demand ${diff > 0 ? "rises" : "falls"} ${Math.abs(diff).toFixed(2)} kWh vs ${hh(prev.hour)}`;
  text += drivers.length ? ` — mainly ${drivers.join(" and ")}.` : ".";
  if (people) text += ` ${people[0].toUpperCase()}${people.slice(1)}.`;
  const dT = cur.temp - prev.outdoorTemp;
  const heating = deltas.find((x) => x.id === SCENARIO.heatingAppliance);
  if (Math.abs(dT) >= 1 && heating && Math.sign(heating.d) === -Math.sign(dT)) {
    text += ` Outdoor temperature ${dT > 0 ? "rises" : "drops"} ${Math.abs(dT).toFixed(1)} °C, so heating ${dT > 0 ? "eases" : "works harder"}.`;
  }
  return text;
}

function scenario(r: Row): SolarScenario {
  const orNull = (k: string) => (r[k] === "" ? null : round(num(r, k), 1));
  return {
    pvKwp: num(r, "pv_kwp"),
    annualProductionKwh: round(num(r, "annual_production_kwh"), 0),
    annualDemandKwh: round(num(r, "annual_demand_kwh"), 0),
    installCost: round(num(r, "install_cost"), 0),
    annualOpex: round(num(r, "annual_opex"), 0),
    exportKwh: round(num(r, "export_kwh"), 0),
    billSaving: round(num(r, "bill_saving"), 0),
    exportIncome: round(num(r, "export_income"), 0),
    billSavingWithShift: round(num(r, "bill_saving_with_shift"), 0),
    exportIncomeWithShift: round(num(r, "export_income_with_shift"), 0),
    demandCoveredPct: round(num(r, "demand_covered_pct"), 1),
    gridReductionKwh: round(num(r, "grid_reduction_kwh"), 0),
    annualSavings: round(num(r, "annual_savings"), 0),
    paybackYears: orNull("payback_years"),
    demandCoveredPctWithShift: round(num(r, "demand_covered_pct_with_shift"), 1),
    gridReductionKwhWithShift: round(num(r, "grid_reduction_kwh_with_shift"), 0),
    annualSavingsWithShift: round(num(r, "annual_savings_with_shift"), 0),
    paybackYearsWithShift: orNull("payback_years_with_shift"),
  };
}

export function buildPlan(nowHour: number, pvKwp: number, comfort?: string): PlanResponse {
  const scenarioMeta = loadScenario();
  const heatId = SCENARIO.heatingAppliance;
  const allRows = loadPlan();
  const options = [...new Set(allRows.map((r) => num(r, "pv_kwp")))];
  const pv = options.reduce((best, o) => (Math.abs(o - pvKwp) < Math.abs(best - pvKwp) ? o : best), options[0]);
  const pvRows = allRows.filter((r) => num(r, "pv_kwp") === pv);
  // One plan per comfort level (smart_optimizer.py); older plan files have no comfort column.
  const levels = [...new Set(pvRows.map((r) => r.comfort_level ?? "standard"))];
  const comfortLevel = comfort && levels.includes(comfort) ? comfort : levels.includes(scenarioMeta.defaultComfort) ? scenarioMeta.defaultComfort : levels[0];
  const rows = pvRows.filter((r) => (r.comfort_level ?? "standard") === comfortLevel);
  const comfortOptions = levels.map((id) => {
    const rs = pvRows.filter((r) => (r.comfort_level ?? "standard") === id);
    const usual = rs.reduce((s, r) => s + num(r, "usual_grid_kwh") * num(r, "electricity_price"), 0);
    const cost = rs.reduce((s, r) => s + num(r, "opt_grid_kwh") * num(r, "electricity_price"), 0);
    const meta = scenarioMeta.comfortLevels.find((l) => l.id === id);
    return {
      id,
      label: meta?.label ?? id,
      band: meta ? `${meta.dayMin}–${meta.dayMax} °C day · ≥${meta.nightMin} °C night` : "",
      cost: round(cost, 2),
      saving: round(usual - cost, 2),
      savingPct: usual > 0 ? Math.round(((usual - cost) / usual) * 100) : 0,
    };
  });
  const history = loadHistory();
  const FLEXIBLE = flexibleColumns(rows[0]);

  const clockHours = rows.map((r) => num(r, "hour"));
  const forecastTotal = rows.map((r) => num(r, "predicted_total_kwh"));
  const price = rows.map((r) => num(r, "electricity_price"));
  const solar = rows.map((r) => num(r, "pv_kwh"));
  const optLoad = rows.map((r) => num(r, "opt_load_kwh"));

  const predicted = rows.map((r) => {
    const by = zeros();
    for (const id of APPLIANCE_IDS) by[id] = num(r, id);
    return by;
  });
  const optimisedBy = rows.map((r, i) => {
    const by = { ...predicted[i] };
    if (heatId) by[heatId] = num(r, "heating_opt_kwh");
    for (const f of FLEXIBLE) by[f.id] = num(r, f.opt);
    return by;
  });

  // Live smart-meter readings, matched to the plan day by timestamp.
  const readings = loadReadings();
  const measuredAt = new Map(readings.map((r) => [r.timestamp, num(r, "total_kwh")]));

  const hourOf = (col: string) => clockHours[rows.findIndex((r) => num(r, col) > 0)];

  const peakHours = clockHours
    .map((h, i) => ({ h, v: forecastTotal[i] }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map((x) => x.h)
    .sort((a, b) => a - b);
  const maxPrice = Math.max(...price);

  const hours: HourPlan[] = [];
  rows.forEach((row, i) => {
    const hour = clockHours[i];
    const heatUsual = num(row, "heating_usual_kwh");
    const heatOpt = num(row, "heating_opt_kwh");
    const heatDelta = heatId ? heatOpt - heatUsual : 0;
    const indoor = num(row, "indoor_temp_opt");
    const nextIndoor = num(row, "indoor_temp_opt_end");
    const scheduled = FLEXIBLE.filter((f) => num(row, f.opt) > 0);
    const isPeak = peakHours.includes(hour);

    const action: HourAction = scheduled.length
      ? "run"
      : heatDelta > SHIFT_KWH
        ? "preheat"
        : heatDelta < -SHIFT_KWH
          ? "coast"
          : isPeak || price[i] === maxPrice
            ? "avoid"
            : solar[i] >= 1
              ? "solar"
              : "normal";

    const notes: string[] = scheduled.map((f) => `Run ${applianceName(f.id).toLowerCase()}`);
    if (heatDelta > SHIFT_KWH && price[i] === maxPrice) notes.push("Heat a bit before the peak");
    else if (heatDelta > SHIFT_KWH) notes.push(`Heat extra (cheap) → house to ${nextIndoor.toFixed(1)} °C`);
    else if (heatDelta < -SHIFT_KWH) notes.push(`Heat less, use stored warmth (${Math.min(indoor, nextIndoor).toFixed(1)} °C)`);
    for (const f of FLEXIBLE) {
      if (num(row, f.usual) > 0 && num(row, f.opt) === 0) notes.push(`${applianceName(f.id)} moved to ${hh(hourOf(f.opt))}`);
    }
    if (isPeak && !notes.length) notes.push("Peak hour — avoid extra loads");
    if (!notes.length) notes.push("As usual");
    const planNote = notes.join(" · ");

    const share = (id: ApplianceId) => (forecastTotal[i] > 0 ? predicted[i][id] / forecastTotal[i] : 0);
    const advice: string[] = [];
    for (const f of scheduled) {
      advice.push(`Run the ${applianceName(f.id).toLowerCase()} now (${num(row, f.opt).toFixed(2)} kWh) — the optimiser's cheapest slot.`);
    }
    for (const f of FLEXIBLE) {
      if (num(row, f.usual) > 0 && num(row, f.opt) === 0) {
        advice.push(`Don't start the ${applianceName(f.id).toLowerCase()} now as usual — it is scheduled for ${hh(hourOf(f.opt))}.`);
      }
    }
    if (heatDelta > SHIFT_KWH && price[i] === maxPrice) {
      const nextPeak = peakHours.find((h) => h > hour);
      advice.push(
        `Heating runs ${heatDelta.toFixed(2)} kWh above normal now so it can ease ${nextPeak !== undefined ? `during the ${hh(nextPeak)} peak` : "later"} — this keeps the household's grid peak down.`,
      );
    } else if (heatDelta > SHIFT_KWH) {
      advice.push(
        `Pre-heat: heating runs ${heatDelta.toFixed(2)} kWh above normal while electricity costs ${money(price[i])}/kWh — the house warms to ${nextIndoor.toFixed(1)} °C.`,
      );
    } else if (heatDelta < -SHIFT_KWH) {
      advice.push(
        `Coast: heating uses ${(-heatDelta).toFixed(2)} kWh less — stored warmth keeps the house at ${Math.min(indoor, nextIndoor).toFixed(1)} °C or more.`,
      );
    }
    if (action === "avoid" || (isPeak && action !== "run")) {
      advice.push(`${isPeak ? "One of today's peak-demand hours" : "Highest tariff"} (${money(price[i])}/kWh) — postpone optional loads.`);
      for (const a of APPLIANCES) if (a.peakTip && share(a.id) >= 0.01) advice.push(a.peakTip);
    }
    if (action === "solar") advice.push(`Solar produces ${solar[i].toFixed(2)} kWh — a good hour for optional loads.`);
    if (!advice.length) advice.push("No action needed — normal usage.");

    hours.push({
      hour,
      timestamp: row.timestamp,
      outdoorTemp: num(row, "outdoor_temp_c"),
      price: price[i],
      solar: round(solar[i]),
      forecastLoad: round(forecastTotal[i]),
      safeForecastLoad: round(num(row, "safe_predicted_total_kwh")),
      lowForecastLoad: round(num(row, "low_total_kwh")),
      peakKw: round(Math.max(num(row, "peak_kw"), forecastTotal[i]), 2),
      actualLoad: row.actual_total_kwh ? round(num(row, "actual_total_kwh")) : null,
      presence: presenceOf(row),
      peopleHome: num(row, "people_home"),
      measuredLoad: measuredAt.has(row.timestamp) ? round(measuredAt.get(row.timestamp)!) : null,
      forecastByAppliance: pick(predicted[i]),
      heatingUsual: round(heatUsual),
      heatingOpt: round(heatOpt),
      indoorTemp: round(indoor, 2),
      indoorTempEnd: round(nextIndoor, 2),
      usualLoad: round(num(row, "usual_load_kwh")),
      usualGrid: round(num(row, "usual_grid_kwh")),
      optimisedLoad: round(optLoad[i]),
      byAppliance: pick(optimisedBy[i]),
      optimisedGrid: round(num(row, "opt_grid_kwh")),
      roomLoad: roomLoad(optimisedBy[i]),
      isPeak,
      action,
      scheduled: scheduled.map((f) => f.id),
      planNote,
      explanation: explainChange(hours[i - 1], { load: forecastTotal[i], by: predicted[i], temp: num(row, "outdoor_temp_c"), presence: presenceOf(row) }),
      advice,
    });
  });

  // Appliance recommendations: usual hour → optimised hour, costed against the optimised base load.
  const recommendations: Recommendation[] = FLEXIBLE.map((f) => {
    const fromIdx = rows.findIndex((r) => num(r, f.usual) > 0);
    const toIdx = rows.findIndex((r) => num(r, f.opt) > 0);
    const energy = num(rows[toIdx], f.opt);
    const base = (i: number) => optLoad[i] - FLEXIBLE.reduce((s, g) => s + num(rows[i], g.opt), 0);
    const added = (i: number) => price[i] * (Math.max(0, base(i) + energy - solar[i]) - Math.max(0, base(i) - solar[i]));
    const from = clockHours[fromIdx];
    const to = clockHours[toIdx];
    const reasons: string[] = [];
    if (from === to) reasons.push(`${hh(from)} is already the best slot — keep it.`);
    else if (price[fromIdx] !== price[toIdx])
      reasons.push(`Tariff is ${money(price[fromIdx])}/kWh at ${hh(from)} versus ${money(price[toIdx])}/kWh at ${hh(to)}.`);
    else reasons.push(`Same tariff; ${hh(to)} keeps the household peak lower.`);
    if (solar[toIdx] > 0.3) reasons.push(`Solar forecast is ${solar[toIdx].toFixed(2)} kWh at ${hh(to)}.`);
    if (peakHours.includes(from)) reasons.push(`${hh(from)} is one of today's peak-demand hours.`);
    reasons.push(`Energy per cycle ${energy.toFixed(2)} kWh (average from the history); allowed window: ${f.window}.`);
    return {
      applianceId: f.id,
      appliance: applianceName(f.id),
      room: APPLIANCES.find((a) => a.id === f.id)!.room,
      from,
      to,
      window: APPLIANCES.find((a) => a.id === f.id)!.window ?? [0, 24],
      powerKw: round(energy, 2),
      saving: round(Math.max(0, added(fromIdx) - added(toIdx)), 2),
      reasons,
    };
  });

  // Forecast vs live meter: alert when an hour deviates by more than 0.5 kWh and 15 %.
  const measured = hours.filter((h) => h.measuredLoad !== null);
  const alerts: LiveAlert[] = measured
    .map((h) => ({ hour: h.hour, measured: h.measuredLoad!, forecast: h.forecastLoad, diff: round(h.measuredLoad! - h.forecastLoad, 2) }))
    .filter((a) => Math.abs(a.diff) > 0.5 && Math.abs(a.diff) > 0.15 * a.forecast)
    .map((a) => ({
      ...a,
      text:
        a.diff > 0
          ? `${hh(a.hour)}: ${a.measured.toFixed(2)} kWh measured, ${a.diff.toFixed(2)} kWh above forecast — check for appliances left on or extra heating.`
          : `${hh(a.hour)}: ${a.measured.toFixed(2)} kWh measured, ${(-a.diff).toFixed(2)} kWh below forecast — less activity than expected.`,
    }));
  const measuredKwh = measured.reduce((s, h) => s + h.measuredLoad!, 0);
  const forecastSame = measured.reduce((s, h) => s + h.forecastLoad, 0);

  const heatingPlan = {
    preheatHours: hours.filter((h) => h.heatingOpt - h.heatingUsual > SHIFT_KWH).map((h) => h.hour),
    coastHours: hours.filter((h) => h.heatingUsual - h.heatingOpt > SHIFT_KWH).map((h) => h.hour),
    minTemp: round(Math.min(...hours.map((h) => h.indoorTemp)), 1),
    maxTemp: round(Math.max(...hours.map((h) => h.indoorTemp)), 1),
    usualKwh: round(hours.reduce((s, h) => s + h.heatingUsual, 0), 2),
    optimisedKwh: round(hours.reduce((s, h) => s + h.heatingOpt, 0), 2),
    saving: round(hours.reduce((s, h) => s + (h.heatingUsual - h.heatingOpt) * h.price, 0), 2),
  };

  const sum = (f: (h: HourPlan) => number) => hours.reduce((s, h) => s + f(h), 0);
  const known = hours.filter((h) => h.actualLoad !== null);
  const dailyTotals = new Map<string, number>();
  for (const r of history) {
    const day = r.timestamp.slice(0, 10);
    dailyTotals.set(day, (dailyTotals.get(day) ?? 0) + num(r, "total_consumption_kwh"));
  }

  return {
    scenario: scenarioMeta,
    nowHour,
    pvKwp: pv,
    comfortLevel,
    comfortOptions,
    forecastDate: rows[0]?.timestamp.slice(0, 10) ?? "",
    source: {
      planFile: planFile(),
      historyFile: historyFile(),
      generatedAt: new Date().toISOString(),
      safetyMarginKwh: rows.length ? round(num(rows[0], "safe_predicted_total_kwh") - forecastTotal[0]) : 0,
      freshness: freshness(rows[0]?.timestamp ?? ""),
    },
    hours,
    recommendations,
    heating: heatingPlan,
    solarScenarios: loadScenarios().map(scenario),
    live: {
      readings: readings.length,
      lastTimestamp: readings.length ? readings[readings.length - 1].timestamp : null,
      matchedHours: measured.length,
      measuredKwh: round(measuredKwh, 2),
      forecastKwhSameHours: round(forecastSame, 2),
      deviationPct: forecastSame > 0 ? round(((measuredKwh - forecastSame) / forecastSame) * 100, 1) : null,
      alerts,
    },
    insights: buildInsights(history, hours, heatingPlan),
    horizon: buildHorizon(),
    accuracy: loadAccuracy(),
    peakHours,
    totals: {
      forecastKwh: round(sum((h) => h.forecastLoad), 2),
      safeForecastKwh: round(sum((h) => h.safeForecastLoad), 2),
      actualKwh: known.length ? round(known.reduce((s, h) => s + h.actualLoad!, 0), 2) : null,
      forecastMae: known.length ? round(known.reduce((s, h) => s + Math.abs(h.forecastLoad - h.actualLoad!), 0) / known.length) : null,
      optimisedKwh: round(sum((h) => h.optimisedLoad), 2),
      optimisedGridKwh: round(sum((h) => h.optimisedGrid), 2),
      solarKwh: round(sum((h) => h.solar), 2),
      usualCost: round(sum((h) => h.usualGrid * h.price), 2),
      optimisedCost: round(sum((h) => h.optimisedGrid * h.price), 2),
      noSolarCost: round(sum((h) => h.optimisedLoad * h.price), 2),
      usualPeakGrid: round(Math.max(...hours.map((h) => h.usualGrid)), 2),
      optimisedPeakGrid: round(Math.max(...hours.map((h) => h.optimisedGrid)), 2),
      historicalDailyAvgKwh: round([...dailyTotals.values()].reduce((s, v) => s + v, 0) / dailyTotals.size, 2),
    },
  };
}
