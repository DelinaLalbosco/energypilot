import { APPLIANCES, type HourPlan, type PlanResponse } from "./data/contract";

/*
 * CSV export of the hourly analysis (one row per hour, every appliance forecast).
 * The PDF report lives in pdfReport.ts.
 */

const costOf = (h: HourPlan) => ({ usual: h.usualGrid * h.price, plan: h.optimisedGrid * h.price });

export function downloadHourlyCsv(plan: PlanResponse) {
  const header = [
    "hour",
    "timestamp",
    "plan_note",
    "outdoor_temp_c",
    "indoor_temp_c",
    "price_eur_kwh",
    "forecast_kwh",
    "upper_band_kwh",
    "usual_kwh",
    "plan_kwh",
    "solar_kwh",
    "usual_cost_eur",
    "plan_cost_eur",
    "saving_eur",
    "heating_usual_kwh",
    "heating_plan_kwh",
    "peak_hour",
    ...APPLIANCES.map((a) => `forecast_${a.id}`),
  ];
  const cell = (v: unknown) => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v));
  const rows = plan.hours.map((h) => {
    const c = costOf(h);
    return [
      h.hour,
      h.timestamp,
      h.planNote,
      h.outdoorTemp,
      h.indoorTemp,
      h.price,
      h.forecastLoad,
      h.safeForecastLoad,
      h.usualLoad,
      h.optimisedLoad,
      h.solar,
      c.usual.toFixed(4),
      c.plan.toFixed(4),
      (c.usual - c.plan).toFixed(4),
      h.heatingUsual,
      h.heatingOpt,
      h.isPeak ? 1 : 0,
      ...APPLIANCES.map((a) => h.forecastByAppliance[a.id]),
    ]
      .map(cell)
      .join(",");
  });
  const blob = new Blob([[header.join(","), ...rows].join("\n") + "\n"], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `energypilot_hourly_${plan.forecastDate}_${plan.pvKwp}kWp.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

