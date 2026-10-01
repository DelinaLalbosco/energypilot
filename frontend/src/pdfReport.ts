import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { APPLIANCES, SCENARIO, hh, type AccuracyScores, type Horizon, type HourPlan, type PlanResponse } from "./data/contract";
import { APPLIANCE_COLORS, buildActions } from "./components/Dashboard";

/*
 * "Export energy report": builds a landscape A4 PDF of the 24 h analysis and
 * downloads it directly. Charts are drawn with jsPDF primitives, tables with
 * jspdf-autotable. All content comes from the PlanResponse on screen.
 */

type RGB = [number, number, number];

const INK: RGB = [17, 24, 39];
const MUTED: RGB = [107, 114, 128];
const LINE: RGB = [229, 231, 235];
const TEAL: RGB = [43, 179, 163];
const DARK_TEAL: RGB = [15, 118, 110];
const AMBER: RGB = [232, 163, 61];
const GREY: RGB = [180, 186, 194];
const PINK: RGB = [217, 70, 239];
const GREEN: RGB = [21, 128, 61];

const PAGE_W = 297;
const PAGE_H = 210;
const M = 12;

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const code = () => SCENARIO.currencyCode;

/** Built-in PDF fonts only cover Latin-1, so replace the currency sign and symbols they cannot draw. */
const t = (s: string) =>
  s
    .split(SCENARIO.currency)
    .join(`${code()} `)
    .replace(/→/g, "->")
    .replace(/[−–]/g, "-")
    .replace(/≈/g, "~")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[▲▼▶✕☀✓💡]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const eur = (v: number) => `${code()} ${v.toFixed(2)}`;
const costOf = (h: HourPlan) => ({ usual: h.usualGrid * h.price, plan: h.optimisedGrid * h.price });

function heading(doc: jsPDF, text: string, y: number) {
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...INK);
  doc.text(t(text), M, y);
  doc.setDrawColor(...INK).setLineWidth(0.4).line(M, y + 1.8, PAGE_W - M, y + 1.8);
  return y + 7;
}

function legend(doc: jsPDF, items: [string, RGB][], x: number, y: number) {
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
  let cx = x;
  for (const [label, color] of items) {
    doc.setFillColor(...color).rect(cx, y - 2.2, 2.6, 2.6, "F");
    doc.text(t(label), cx + 3.6, y);
    cx += doc.getTextWidth(t(label)) + 9;
  }
}

/** Frame, hour axis and a y-scale helper for a 24-bar chart. */
function chartFrame(doc: jsPDF, x: number, y: number, w: number, h: number, hours: HourPlan[], max: number) {
  const bottom = y + h - 5;
  const top = y + 2;
  doc.setDrawColor(...LINE).setLineWidth(0.2).line(x, bottom, x + w, bottom);
  const bw = w / hours.length;
  doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(...MUTED);
  hours.forEach((hr, i) => {
    if (i % 3 === 0) doc.text(hh(hr.hour), x + i * bw + bw / 2, bottom + 3.5, { align: "center" });
  });
  return { bw, bottom, sy: (v: number) => bottom - (v / max) * (bottom - top) };
}

function forecastChart(doc: jsPDF, hours: HourPlan[], x: number, y: number, w: number, h: number) {
  const max = Math.max(...hours.flatMap((hr) => [hr.safeForecastLoad, hr.actualLoad ?? 0, hr.measuredLoad ?? 0])) * 1.1;
  const { bw, bottom, sy } = chartFrame(doc, x, y, w, h, hours, max);
  hours.forEach((hr, i) => {
    const cx = x + i * bw;
    doc.setFillColor(...(hr.isPeak ? AMBER : TEAL)).rect(cx + bw * 0.2, sy(hr.forecastLoad), bw * 0.6, bottom - sy(hr.forecastLoad), "F");
    if (hr.actualLoad !== null) doc.setDrawColor(...INK).setLineWidth(0.25).setFillColor(255, 255, 255).circle(cx + bw / 2, sy(hr.actualLoad), 0.8, "FD");
    if (hr.measuredLoad !== null) doc.setFillColor(...PINK).circle(cx + bw / 2, sy(hr.measuredLoad), 0.9, "F");
  });
  const items: [string, RGB][] = [["Forecast", TEAL], ["Peak hour", AMBER]];
  if (hours.some((hr) => hr.actualLoad !== null)) items.push(["Actual", INK]);
  if (hours.some((hr) => hr.measuredLoad !== null)) items.push(["Live meter", PINK]);
  legend(doc, items, x, y + h + 2);
}

function heatingChart(doc: jsPDF, hours: HourPlan[], x: number, y: number, w: number, h: number, comfortLevel: string) {
  const max = Math.max(...hours.flatMap((hr) => [hr.heatingUsual, hr.heatingOpt])) * 1.15;
  const { bw, bottom, sy } = chartFrame(doc, x, y, w, h, hours, max);
  const level = SCENARIO.comfortLevels.find((l) => l.id === comfortLevel) ?? SCENARIO.comfortLevels[0];
  const night = new Set(SCENARIO.thermal?.nightHours ?? []);
  const band = (hour: number) => (level ? (night.has(hour) ? [level.nightMin, level.nightMax] : [level.dayMin, level.dayMax]) : [20, 22]);
  const tLo = Math.min(...hours.map((hr) => Math.min(hr.indoorTemp, band(hr.hour)[0]))) - 0.5;
  const tHi = Math.max(...hours.map((hr) => Math.max(hr.indoorTemp, band(hr.hour)[1]))) + 0.5;
  const ty = (temp: number) => bottom - ((temp - tLo) / (tHi - tLo)) * (bottom - y - 2);
  hours.forEach((hr, i) => {
    const [lo, hi] = band(hr.hour);
    doc.setFillColor(222, 245, 241).rect(x + i * bw, ty(hi), bw, ty(lo) - ty(hi), "F");
  });
  const heatColor = hex(APPLIANCE_COLORS[SCENARIO.heatingAppliance ?? ""] ?? "#ff7a59");
  hours.forEach((hr, i) => {
    const cx = x + i * bw;
    doc.setFillColor(...GREY).rect(cx + bw * 0.12, sy(hr.heatingUsual), bw * 0.36, bottom - sy(hr.heatingUsual), "F");
    doc.setFillColor(...heatColor).rect(cx + bw * 0.52, sy(hr.heatingOpt), bw * 0.36, bottom - sy(hr.heatingOpt), "F");
  });
  doc.setDrawColor(...DARK_TEAL).setLineWidth(0.6);
  for (let i = 1; i < hours.length; i++) {
    doc.line(x + (i - 1) * bw + bw / 2, ty(hours[i - 1].indoorTemp), x + i * bw + bw / 2, ty(hours[i].indoorTemp));
  }
  doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(...MUTED);
  [Math.ceil(tLo), Math.round((tLo + tHi) / 2), Math.floor(tHi)].forEach((temp) => doc.text(`${temp} °C`, x + w, ty(temp) - 0.8, { align: "right" }));
  const bandLabel = level ? `${level.label} ${level.dayMin}-${level.dayMax} °C day, ${level.nightMin}-${level.nightMax} °C night` : "comfort band";
  legend(doc, [["Usual heating", GREY], ["Optimised heating", heatColor], ["Indoor °C", DARK_TEAL], [bandLabel, [200, 236, 230]]], x, y + h + 2);
}

function costChart(doc: jsPDF, hours: HourPlan[], x: number, y: number, w: number, h: number) {
  const max = Math.max(...hours.flatMap((hr) => [costOf(hr).usual, costOf(hr).plan])) * 1.1;
  const { bw, bottom, sy } = chartFrame(doc, x, y, w, h, hours, max);
  hours.forEach((hr, i) => {
    const cx = x + i * bw;
    const c = costOf(hr);
    doc.setFillColor(...GREY).rect(cx + bw * 0.12, sy(c.usual), bw * 0.36, bottom - sy(c.usual), "F");
    doc.setFillColor(...TEAL).rect(cx + bw * 0.52, sy(c.plan), bw * 0.36, bottom - sy(c.plan), "F");
  });
  legend(doc, [["Usual habits", GREY], ["Optimised plan", TEAL]], x, y + h + 2);
}

function horizonChart(doc: jsPDF, horizon: Horizon, days: number, x: number, y: number, w: number, h: number) {
  const period = horizon.periods.find((p) => p.days === days)!;
  const hours = horizon.hours.slice(0, days * 24);
  const max = Math.max(...hours.flatMap((hr) => [hr.forecast, hr.actual ?? 0])) * 1.1;
  const bottom = y + h - 5;
  const sy = (v: number) => bottom - (v / max) * (h - 7);
  const bw = w / hours.length;
  const peaks = new Set(period.peakHours.map((p) => p.timestamp));
  period.daily.forEach((d, i) => {
    if (i % 2) doc.setFillColor(243, 244, 246).rect(x + i * 24 * bw, y, 24 * bw, h - 5, "F");
    doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(...MUTED);
    doc.text(t(d.label), x + (i * 24 + 12) * bw, bottom + 3.5, { align: "center" });
  });
  hours.forEach((hr, i) => {
    doc.setFillColor(...(peaks.has(hr.timestamp) ? AMBER : TEAL)).rect(x + i * bw + bw * 0.1, sy(hr.forecast), bw * 0.8, bottom - sy(hr.forecast), "F");
  });
  doc.setDrawColor(...INK).setLineWidth(0.25);
  for (let i = 1; i < hours.length; i++) {
    const a = hours[i - 1].actual;
    const b = hours[i].actual;
    if (a !== null && b !== null) doc.line(x + (i - 0.5) * bw, sy(a), x + (i + 0.5) * bw, sy(b));
  }
  doc.setDrawColor(...LINE).line(x, bottom, x + w, bottom);
  legend(doc, [["Forecast", TEAL], ["Top 3 hours", AMBER]], x, y + h + 2);
}

const TABLE_STYLE = {
  theme: "grid" as const,
  styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.2, lineColor: LINE, lineWidth: 0.1, textColor: INK },
  headStyles: { fillColor: [243, 244, 246] as RGB, textColor: INK, fontStyle: "bold" as const },
  margin: { left: M, right: M },
};

function tableEnd(doc: jsPDF) {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function ensureSpace(doc: jsPDF, y: number, needed: number) {
  if (y + needed > PAGE_H - M) {
    doc.addPage();
    return M + 4;
  }
  return y;
}

export function exportPdfReport(plan: PlanResponse) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const hours = plan.hours;
  const tt = plan.totals;
  const saving = tt.usualCost - tt.optimisedCost;
  const savingPct = tt.usualCost > 0 ? Math.round((saving / tt.usualCost) * 100) : 0;
  const busiest = hours.reduce((a, b) => (b.forecastLoad > a.forecastLoad ? b : a), hours[0]);

  /* ---------- page 1: summary + charts ---------- */
  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(...INK);
  doc.text("EnergyPilot - 24 h energy report", M, M + 4);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  doc.text(
    t(`${SCENARIO.household.name} · ${SCENARIO.household.title} · forecast for ${plan.forecastDate} · ${plan.pvKwp} kWp solar · generated ${new Date().toLocaleString()}`),
    M,
    M + 10,
  );

  const kpis: [string, string, string, RGB][] = [
    ["FORECAST 24 H", `${tt.forecastKwh.toFixed(1)} kWh`, plan.horizon?.periods[0] ? `likely ${plan.horizon.periods[0].lowKwh.toFixed(0)}-${plan.horizon.periods[0].highKwh.toFixed(0)} kWh` : "", INK],
    ["PEAK HOURS", plan.peakHours.map((h) => String(h).padStart(2, "0")).join(" · "), "highest predicted demand", [180, 83, 9]],
    ["COST 24 H", eur(tt.optimisedCost), `${eur(tt.usualCost)} with usual habits`, INK],
    ["SAVING", eur(saving), `${savingPct}% · peak ${tt.usualPeakGrid.toFixed(2)} -> ${tt.optimisedPeakGrid.toFixed(2)} kWh`, GREEN],
  ];
  const kw = (PAGE_W - 2 * M - 3 * 4) / 4;
  kpis.forEach(([label, value, sub, color], i) => {
    const x = M + i * (kw + 4);
    doc.setDrawColor(...LINE).setLineWidth(0.3).roundedRect(x, M + 14, kw, 18, 2, 2, "S");
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...MUTED).text(label, x + 3, M + 19);
    doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(...color).text(t(value), x + 3, M + 26);
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...MUTED).text(t(sub), x + 3, M + 30);
  });

  const bullets = [
    `Demand: ${tt.forecastKwh.toFixed(1)} kWh expected over 24 h (year average ${tt.historicalDailyAvgKwh.toFixed(1)} kWh/day).`,
    `Busiest hour: ${hh(busiest.hour)} (${busiest.forecastLoad.toFixed(2)} kWh) - ${busiest.explanation}`,
    ...(!SCENARIO.heatingEnabled ? [] : [`Heating plan: heat ahead at ${plan.heating.preheatHours.map(hh).join(", ")}; coast at ${plan.heating.coastHours.map(hh).join(", ")}; indoor ${plan.heating.minTemp.toFixed(1)}-${plan.heating.maxTemp.toFixed(1)} °C; heating cost -${eur(plan.heating.saving)}.`]),
    `Appliances: ${plan.recommendations.map((r) => `${r.appliance} ${hh(r.from)} -> ${hh(r.to)}`).join("; ")}.`,
    `Result: ${eur(tt.usualCost)} -> ${eur(tt.optimisedCost)} (saves ${eur(saving)}, ${savingPct}%) with the same comfort.`,
  ];
  if (plan.live.matchedHours > 0) {
    bullets.push(
      `Live meter: ${plan.live.measuredKwh.toFixed(1)} kWh measured over ${plan.live.matchedHours} h vs ${plan.live.forecastKwhSameHours.toFixed(1)} kWh forecast (${(plan.live.deviationPct ?? 0).toFixed(1)}%).`,
    );
  }
  let y = M + 38;
  doc.setFontSize(8.5).setTextColor(...INK);
  for (const b of bullets) {
    const lines = doc.splitTextToSize(t(`• ${b}`), PAGE_W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 3.8;
  }

  y += 3;
  const halfW = (PAGE_W - 2 * M - 8) / 2;
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...INK);
  doc.text("Hourly energy forecast", M, y);
  if (SCENARIO.heatingEnabled) {
    doc.text("Heating plan - the house as a thermal battery", M + halfW + 8, y);
    forecastChart(doc, hours, M, y + 2, halfW, 48);
    heatingChart(doc, hours, M + halfW + 8, y + 2, halfW, 48, plan.comfortLevel);

    y += 60;
    y = ensureSpace(doc, y, 60);
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...INK);
    doc.text("Hourly cost - usual habits vs optimised", M, y);
    costChart(doc, hours, M, y + 2, halfW, 45);
  } else {
    doc.text("Hourly cost - usual habits vs optimised", M + halfW + 8, y);
    forecastChart(doc, hours, M, y + 2, halfW, 48);
    costChart(doc, hours, M + halfW + 8, y + 2, halfW, 48);
  }

  /* ---------- forecast horizon: 24 h / 3 days / 7 days ---------- */
  if (plan.horizon) {
    const hz = plan.horizon;
    const longest = hz.periods[hz.periods.length - 1];
    doc.addPage();
    y = heading(doc, `Energy forecast - 24 h, 3 days and 7 days (from ${hz.start.slice(0, 16)})`, M + 4);
    autoTable(doc, {
      ...TABLE_STYLE,
      startY: y,
      head: [["Period", "Forecast kWh", "Per day", "Likely range kWh", "Backtest error", "Upper band kWh", "Outdoor °C", "Highest hours"]],
      body: hz.periods.map((p) => [
        p.label,
        p.forecastKwh.toFixed(1),
        (p.forecastKwh / p.days).toFixed(1),
        `${p.lowKwh.toFixed(0)}-${p.highKwh.toFixed(0)}`,
        plan.accuracy ? `+/-${(plan.accuracy.afterCalibration[`error_${p.days}d_pct` as keyof AccuracyScores] ?? 0).toFixed(1)}%` : "-",
        p.safeForecastKwh.toFixed(0),
        `${p.minTemp.toFixed(1)} to ${p.maxTemp.toFixed(1)} (avg ${p.avgTemp.toFixed(1)})`,
        p.peakHours.map((x) => `${x.timestamp.slice(5, 16)} (${x.kwh.toFixed(2)})`).join(", "),
      ]),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    });
    y = tableEnd(doc) + 8;
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...INK);
    doc.text(t(`Hourly forecast - next ${longest.label}`), M, y);
    horizonChart(doc, hz, longest.days, M, y + 2, PAGE_W - 2 * M, 45);
    y += 55;
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...INK);
    for (const line of longest.summary) {
      const lines = doc.splitTextToSize(t(`• ${line}`), PAGE_W - 2 * M);
      doc.text(lines, M, y);
      y += lines.length * 3.8;
    }
    y = ensureSpace(doc, y + 4, 40);
    autoTable(doc, {
      ...TABLE_STYLE,
      startY: y,
      head: [["Day", "Forecast kWh", "Actual kWh", "Avg °C", "Min °C", "Peak hour", "Explanation"]],
      body: longest.daily.map((d) => [
        t(d.label),
        d.forecastKwh.toFixed(1),
        d.actualKwh === null ? "-" : d.actualKwh.toFixed(1),
        d.avgTemp.toFixed(1),
        d.minTemp.toFixed(1),
        `${hh(d.peakHour)} (${d.peakKwh.toFixed(2)})`,
        t(d.explanation),
      ]),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    });
  }

  /* ---------- page 2: actions + insights ---------- */
  doc.addPage();
  y = heading(doc, "Today's actions", M + 4);
  autoTable(doc, {
    ...TABLE_STYLE,
    startY: y,
    head: [["Time", "Action"]],
    body: buildActions(plan).map((a) => [hh(a.start), t(a.text)]),
    columnStyles: { 0: { cellWidth: 16, font: "courier" } },
  });

  y = heading(doc, "Personalised energy insights", tableEnd(doc) + 10);
  autoTable(doc, {
    ...TABLE_STYLE,
    startY: y,
    head: [["Insight", "Value", "Detail", "Tip"]],
    body: plan.insights.map((i) => [t(i.title), t(i.value), t(i.detail), t(i.tip ?? "")]),
    columnStyles: { 0: { cellWidth: 45, fontStyle: "bold" }, 1: { cellWidth: 26 }, 3: { cellWidth: 70 } },
  });

  if (plan.live.readings > 0) {
    y = heading(doc, "Live smart-meter readings vs forecast", tableEnd(doc) + 10);
    autoTable(doc, {
      ...TABLE_STYLE,
      startY: y,
      head: [["Hour", "Measured kWh", "Forecast kWh", "Difference", "Note"]],
      body: hours
        .filter((h) => h.measuredLoad !== null)
        .map((h) => {
          const d = h.measuredLoad! - h.forecastLoad;
          const alert = plan.live.alerts.find((a) => a.hour === h.hour);
          return [hh(h.hour), h.measuredLoad!.toFixed(2), h.forecastLoad.toFixed(2), `${d >= 0 ? "+" : ""}${d.toFixed(2)}`, alert ? t(alert.text) : ""];
        }),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    });
  }

  /* ---------- hourly analysis ---------- */
  doc.addPage();
  y = heading(doc, "Hourly analysis", M + 4);
  const usualTotal = hours.reduce((s, h) => s + h.usualLoad, 0);
  autoTable(doc, {
    ...TABLE_STYLE,
    startY: y,
    head: [["Hour", "What the plan does", "Out °C", "In °C", `${code()}/kWh`, "Forecast", "Usual kWh", "Plan kWh", "Solar", `Usual ${code()}`, `Plan ${code()}`, "Saving"]],
    body: hours.map((h) => {
      const c = costOf(h);
      const d = c.usual - c.plan;
      return [
        hh(h.hour),
        t(h.planNote),
        h.outdoorTemp.toFixed(1),
        h.indoorTemp.toFixed(1),
        h.price.toFixed(2),
        h.forecastLoad.toFixed(2),
        h.usualLoad.toFixed(2),
        h.optimisedLoad.toFixed(2),
        h.solar.toFixed(2),
        eur(c.usual),
        eur(c.plan),
        `${d >= 0 ? "+" : "-"}${eur(Math.abs(d))}`,
      ];
    }),
    foot: [
      [
        "24 h",
        "buy cheap heat, use it when expensive",
        "",
        "",
        "",
        tt.forecastKwh.toFixed(1),
        usualTotal.toFixed(1),
        tt.optimisedKwh.toFixed(1),
        tt.solarKwh.toFixed(1),
        eur(tt.usualCost),
        eur(tt.optimisedCost),
        `+${eur(saving)}`,
      ],
    ],
    footStyles: { fillColor: [243, 244, 246], textColor: INK, fontStyle: "bold" },
    columnStyles: Object.fromEntries([...Array(12).keys()].slice(2).map((i) => [i, { halign: "right" as const }])),
    didParseCell: (data) => {
      if (data.section === "foot" && data.column.index >= 2) data.cell.styles.halign = "right";
      if (data.section === "body" && hours[data.row.index]?.isPeak) data.cell.styles.fillColor = [255, 251, 235];
      if (data.section === "body" && data.column.index === 11) {
        const raw = String(data.cell.raw);
        data.cell.styles.textColor = raw.startsWith("+") && raw !== `+${code()} 0.00` ? GREEN : raw.startsWith("-") ? [180, 83, 9] : INK;
      }
    },
  });

  /* ---------- appliance forecast ---------- */
  doc.addPage();
  y = heading(doc, "Appliance forecast per hour (kWh)", M + 4);
  autoTable(doc, {
    ...TABLE_STYLE,
    styles: { ...TABLE_STYLE.styles, fontSize: 6.5 },
    startY: y,
    head: [["Hour", ...APPLIANCES.map((a) => a.name), "Total"]],
    body: hours.map((h) => [hh(h.hour), ...APPLIANCES.map((a) => h.forecastByAppliance[a.id].toFixed(3)), h.forecastLoad.toFixed(2)]),
    foot: [["24 h", ...APPLIANCES.map((a) => hours.reduce((s, h) => s + h.forecastByAppliance[a.id], 0).toFixed(2)), tt.forecastKwh.toFixed(1)]],
    footStyles: { fillColor: [243, 244, 246], textColor: INK, fontStyle: "bold" },
    columnStyles: Object.fromEntries([...Array(APPLIANCES.length + 1).keys()].map((i) => [i + 1, { halign: "right" as const }])),
    didParseCell: (data) => {
      if (data.section === "foot" && data.column.index >= 1) data.cell.styles.halign = "right";
    },
  });

  /* ---------- schedule + solar ---------- */
  y = ensureSpace(doc, tableEnd(doc) + 10, 50);
  y = heading(doc, "Optimiser schedule", y);
  autoTable(doc, {
    ...TABLE_STYLE,
    startY: y,
    head: [["Appliance", "Usual", "Planned", "Energy", "Saving", "Why"]],
    body: [
      ...plan.recommendations.map((r) => [r.appliance, hh(r.from), hh(r.to), `${r.powerKw.toFixed(2)} kWh`, eur(r.saving), t(r.reasons.join(" "))]),
      ...(SCENARIO.heatingEnabled
        ? [
            [
              "Heating",
              "shifted",
              "see chart",
              `${plan.heating.usualKwh.toFixed(1)} -> ${plan.heating.optimisedKwh.toFixed(1)} kWh`,
              eur(plan.heating.saving),
              "Heat ahead in cheap hours, coast in expensive hours.",
            ],
          ]
        : []),
    ],
  });

  y = ensureSpace(doc, tableEnd(doc) + 10, 40);
  y = heading(doc, "Solar investment - full year", y);
  const years = (v: number | null) => (v === null ? "-" : `${v.toFixed(1)} yr`);
  autoTable(doc, {
    ...TABLE_STYLE,
    startY: y,
    head: [["PV", "Investment", "Production", "Covers", "Less grid", "Bill saving", "Export", "Running cost", "Net saving", "Payback A", "Payback B"]],
    body: plan.solarScenarios
      .filter((s) => s.pvKwp > 0 && SCENARIO.solar.options.includes(s.pvKwp))
      .map((s) => [
        `${s.pvKwp} kWp`,
        `${code()} ${s.installCost.toLocaleString()}`,
        `${s.annualProductionKwh.toLocaleString()} kWh`,
        `${s.demandCoveredPct.toFixed(0)}%`,
        `${s.gridReductionKwh.toLocaleString()} kWh`,
        `${code()} ${s.billSaving.toLocaleString()}`,
        `${code()} ${s.exportIncome.toLocaleString()}`,
        `-${code()} ${s.annualOpex.toLocaleString()}`,
        `${code()} ${s.annualSavings.toLocaleString()}/yr`,
        years(s.paybackYears),
        years(s.paybackYearsWithShift),
      ]),
  });

  /* ---------- footer on every page ---------- */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...MUTED);
    doc.text(
      t(`EnergyPilot · ${SCENARIO.household.title} · weather: Open-Meteo · solar: JRC PVGIS · HackoWatt tariff`),
      M,
      PAGE_H - 6,
    );
    doc.text(`Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - 6, { align: "right" });
  }

  doc.save(`EnergyPilot_report_${plan.forecastDate}_${plan.pvKwp}kWp.pdf`);
}
