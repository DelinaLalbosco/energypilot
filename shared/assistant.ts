import { hh, type PlanResponse, type ScenarioMeta } from "./types";

/*
 * Shared by the backend (context for Claude) and the frontend (offline answers):
 *   planContext()   — a compact, factual summary of the household's plan
 *   offlineAnswer() — rule-based answers from the same data when no LLM is available
 */

// Settings come from plan.scenario (not the module registry), so this file works the
// same when bundled into the frontend or loaded by the backend.
let SCENARIO = {} as ScenarioMeta;
const money = (v: number, digits = 2) => `${v < 0 ? "−" : ""}${SCENARIO.currency}${Math.abs(v).toFixed(digits)}`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export const SUGGESTED_QUESTIONS = [
  "When should I run the dishwasher?",
  "Why is Monday morning so high?",
  "Why is the evening expensive?",
  "How much will this week cost?",
  "How can I save more money?",
  "Is solar worth it for us?",
  "Will the house stay warm with the plan?",
];

/** Everything the assistant may use, as plain text. Kept stable per plan so it caches well. */
export function planContext(plan: PlanResponse): string {
  SCENARIO = plan.scenario;
  const t = plan.totals;
  const lines: string[] = [];
  lines.push(`Household: ${SCENARIO.household.name} — ${SCENARIO.household.title}. ${SCENARIO.household.description ?? ""}`);
  lines.push(`Location: ${SCENARIO.location.name}. Family: ${SCENARIO.members.map((m) => `${m.name} (${m.role})`).join(", ")}.`);
  lines.push(`Plan day: ${plan.forecastDate}. Currency: ${SCENARIO.currency}. Solar size selected: ${plan.pvKwp} kWp. Comfort level: ${plan.comfortLevel}.`);
  lines.push(
    `Day totals: forecast ${t.forecastKwh} kWh (upper band ${t.safeForecastKwh}); cost with usual habits ${money(t.usualCost)}, with the plan ${money(t.optimisedCost)} (saves ${money(t.usualCost - t.optimisedCost)}); peak grid ${t.usualPeakGrid} → ${t.optimisedPeakGrid} kWh; average day in the history ${t.historicalDailyAvgKwh} kWh.`,
  );
  lines.push(`Busiest hours: ${plan.peakHours.map(hh).join(", ")}.`);
  if (plan.horizon) {
    for (const p of plan.horizon.periods) {
      lines.push(
        `Forecast ${p.label}: ${p.forecastKwh} kWh (likely ${p.lowKwh}–${p.highKwh}), ${p.avgTemp} °C average, highest hour ${p.peakHours[0]?.timestamp.slice(5, 16)} (${p.peakHours[0]?.kwh} kWh). ${p.summary.join(" ")}`,
      );
    }
    const week = plan.horizon.periods.find((p) => p.days === 7);
    if (week) lines.push(`Days: ${week.daily.map((d) => `${d.label} ${d.forecastKwh} kWh (${d.avgTemp} °C)`).join("; ")}.`);
  }
  lines.push("Hour | price/kWh | forecast kWh | plan kWh | outdoor °C | indoor °C | who is home | what the plan does");
  for (const h of plan.hours) {
    const home = SCENARIO.members.filter((m) => h.presence?.[m.id] === 1).map((m) => m.name).join("+") || "nobody awake";
    lines.push(
      `${hh(h.hour)} | ${money(h.price)} | ${h.forecastLoad.toFixed(2)} | ${h.optimisedLoad.toFixed(2)} | ${h.outdoorTemp.toFixed(1)} | ${h.indoorTemp.toFixed(1)} | ${home} | ${h.planNote}`,
    );
  }
  if (plan.accuracy) {
    const a = plan.accuracy.afterCalibration;
    lines.push(
      `Forecast model: ${plan.accuracy.model}, chosen from ${Object.keys(plan.accuracy.comparison).length} models by backtest; error 24 h ±${a.error_1d_pct.toFixed(1)}%, 7 days ±${a.error_7d_pct.toFixed(1)}%, days under-predicted ${a.days_under_pct.toFixed(0)}% (calibrated ×${plan.accuracy.calibrationFactor}).`,
    );
  }
  for (const d of plan.horizon?.periods.find((p) => p.days === 7)?.daily ?? []) lines.push(`${d.label}: ${d.dayType}.`);
  for (const r of plan.recommendations) {
    lines.push(`${r.appliance}: usually ${hh(r.from)}, best ${hh(r.to)}, saves ${money(r.saving)}. ${r.reasons.join(" ")}`);
  }
  if (SCENARIO.heatingEnabled) {
    const hp = plan.heating;
    lines.push(
      `Heating plan: heat ahead at ${hp.preheatHours.map(hh).join(", ") || "—"}, rest at ${hp.coastHours.map(hh).join(", ") || "—"}; indoor stays ${hp.minTemp}–${hp.maxTemp} °C; heating cost saving ${money(hp.saving)}.`,
    );
  }
  if (plan.comfortOptions.length > 1) {
    lines.push(`Comfort levels: ${plan.comfortOptions.map((o) => `${o.label} (${o.band}) costs ${money(o.cost)}, saves ${money(o.saving)}`).join("; ")}.`);
  }
  lines.push(
    `Solar (full year): ${plan.solarScenarios
      .filter((s) => s.pvKwp > 0 && SCENARIO.solar.options.includes(s.pvKwp))
      .map((s) => `${s.pvKwp} kWp makes ${s.annualProductionKwh} kWh, covers ${s.demandCoveredPct}%, saves ${SCENARIO.currency}${s.annualSavings}/yr, payback ${s.paybackYears ?? "—"} yr (${s.paybackYearsWithShift ?? "—"} with smart habits)`)
      .join("; ")}.`,
  );
  lines.push(`Insights: ${plan.insights.map((i) => `${i.title}: ${i.value} — ${i.detail}`).join(" | ")}`);
  lines.push(`Appliances: ${SCENARIO.appliances.map((a) => `${a.name} (${a.room}${a.flexible ? ", can be moved" : ""}${a.alwaysOn ? ", always on" : ""})`).join(", ")}.`);
  lines.push(`Tariff note: ${SCENARIO.tariffNote}.`);
  return lines.join("\n");
}

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));

/** Rule-based answer from the plan data (used when no LLM is available). */
export function offlineAnswer(plan: PlanResponse, question: string): string {
  SCENARIO = plan.scenario;
  const q = question.toLowerCase();
  const t = plan.totals;
  const cheap = [...plan.hours].sort((a, b) => a.price - b.price || a.forecastLoad - b.forecastLoad).slice(0, 4).map((h) => hh(h.hour));
  const flexible = plan.recommendations;

  const rec = flexible.find((r) => q.includes(r.appliance.toLowerCase()) || q.includes(r.appliance.toLowerCase().split(" ")[0]));
  if (rec) {
    return `The best time for the ${rec.appliance.toLowerCase()} is **${hh(rec.to)}** (usually ${hh(rec.from)}). ${rec.reasons[0] ?? ""} ${
      rec.saving >= 0.005 ? `That saves about ${money(rec.saving)} per run.` : ""
    }`;
  }
  if (has(q, "home", "who", "shift", "marek", "ania", "kuba", "zosia", "school")) {
    const week = plan.horizon?.periods.find((p) => p.days === 7)?.daily ?? [];
    return `${week.slice(0, 4).map((d) => `**${d.label}**: ${d.dayType}`).join(" · ")}. The forecast knows this planned routine; unplanned outings are not known in advance.`;
  }
  if (has(q, "accurate", "accuracy", "model", "error", "trust")) {
    const a = plan.accuracy;
    return a
      ? `The forecast uses **${a.model}**, the best of ${Object.keys(a.comparison).length} models in a backtest over ${a.backtestWeeks} weeks. Typical error: ±${a.afterCalibration.error_1d_pct.toFixed(0)}% for 24 h, ±${a.afterCalibration.error_7d_pct.toFixed(0)}% for 7 days. It is calibrated so that only ${a.afterCalibration.days_under_pct.toFixed(0)}% of days are under-predicted.`
      : "The model has not been trained yet.";
  }
  if (has(q, "when", "best time", "cheap", "run", "wash", "laundry")) {
    return `The cheapest hours today are **${cheap.join(", ")}**. ${flexible.map((r) => `${r.appliance}: ${hh(r.to)}`).join(" · ")}. Avoid the busiest hours ${plan.peakHours.map(hh).join(", ")}.`;
  }
  if (has(q, "expensive", "evening", "peak", "busy", "busiest", "why")) {
    const max = Math.max(...plan.hours.map((h) => h.price));
    const exp = plan.hours.filter((h) => h.price === max).map((h) => h.hour);
    return `Electricity is most expensive at ${hh(exp[0])}–${hh((exp[exp.length - 1] + 1) % 24)} (${money(max)}/kWh). That is also when the house is busiest — cooking, lighting and evening heating — so the busiest hours are ${plan.peakHours.map(hh).join(", ")}. ${
      SCENARIO.heatingEnabled ? "The plan heats the house a little earlier, while it is cheaper, and lets the heating rest then." : "Move flexible appliances out of these hours to save."
    }`;
  }
  if (has(q, "week", "cost", "bill", "pay", "price", "much")) {
    const week = plan.horizon?.periods.find((p) => p.days === 7);
    const priceAt = new Map(plan.hours.map((h) => [h.hour, h.price]));
    const bill = plan.horizon ? plan.horizon.hours.slice(0, 168).reduce((s, h) => s + h.forecast * (priceAt.get(h.hour) ?? 0), 0) : t.usualCost * 7;
    return `This week you will use about **${Math.round(week?.forecastKwh ?? t.forecastKwh * 7)} kWh**, costing about **${money(bill, 0)}**. Following the plan saves about ${money((t.usualCost - t.optimisedCost) * 7)} a week. Today costs ${money(t.optimisedCost)} with the plan (${money(t.usualCost)} with usual habits).`;
  }
  if (has(q, "save", "saving", "cheaper", "reduce", "less")) {
    const best = plan.comfortOptions[plan.comfortOptions.length - 1];
    return `Three ways to save: 1) follow Today's actions (saves ${money(t.usualCost - t.optimisedCost)} today); 2) run flexible appliances in the cheap hours ${cheap.slice(0, 3).join(", ")}; ${
      best && plan.comfortOptions.length > 1 ? `3) choose the "${best.label}" comfort level (${best.band}) to save ${money(best.saving)} a day.` : "3) avoid extra appliances in the busiest hours."
    }`;
  }
  if (has(q, "solar", "panel", "pv", "payback", "invest")) {
    const s = plan.solarScenarios.filter((x) => x.pvKwp > 0 && SCENARIO.solar.options.includes(x.pvKwp));
    return s.length
      ? `Over a year: ${s.map((x) => `${x.pvKwp} kWp saves ${SCENARIO.currency}${x.annualSavings} and pays back in ${x.paybackYears ?? "—"} years`).join("; ")}. Using appliances in sunny hours shortens payback a little.`
      : "No solar options are set up for this household.";
  }
  if (has(q, "warm", "cold", "heat", "temperature", "comfort")) {
    const hp = plan.heating;
    return SCENARIO.heatingEnabled
      ? `Yes — the plan keeps the house between **${hp.minTemp} and ${hp.maxTemp} °C**. It heats ahead at ${hp.preheatHours.map(hh).join(", ") || "—"} and lets the heating rest at ${hp.coastHours.map(hh).join(", ") || "—"}. You can choose a warmer or cheaper level with the comfort slider.`
      : "This household's heating is treated as a fixed load, so the plan does not change it.";
  }
  if (has(q, "tomorrow", "forecast", "next", "3 day", "days")) {
    return plan.horizon ? plan.horizon.periods.map((p) => `${p.label}: about ${Math.round(p.forecastKwh)} kWh (likely ${Math.round(p.lowKwh)}–${Math.round(p.highKwh)})`).join(" · ") : `Today: about ${Math.round(t.forecastKwh)} kWh.`;
  }
  return `Today: about ${Math.round(t.forecastKwh)} kWh, costing ${money(t.optimisedCost)} with the plan (saves ${money(t.usualCost - t.optimisedCost)}). Busiest hours: ${plan.peakHours.map(hh).join(", ")}. Cheapest hours: ${cheap.join(", ")}. Try asking about an appliance, the cost this week, solar, or comfort.`;
}
