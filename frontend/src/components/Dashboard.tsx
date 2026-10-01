import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ComfortSlider, Equivalents, NowLight, WeekCalendar, WhatIf, WhoIsHome, whoIsHome } from "./Features";
import { Icon, type IconName } from "./Icon";
import { Info, type GlossaryKey } from "./Info";
import { ForecastHero, TimeOfDay } from "./ForecastVisuals";
import { CostHero } from "./CostVisuals";
import { SolarHero } from "./SolarVisuals";
import { AppliancesHero, TwinHero } from "./HomeVisuals";
import { appliancePicture } from "./pictures";
import { ApplianceOrbs3D, CostBars3D, EnergyClock3D, HeatHouse3D, SolarRoof3D, View3D } from "./Page3D";
import { HeatBatterySteps, HeatPumpHero } from "./HeatPumpVisuals";
import { PageBackdrop } from "./PageBackdrop";
import { HabitChanges, OverviewHero, SolarGlance, SolutionSteps } from "./Overview";
import {
  APPLIANCES,
  APPLIANCE_COLORS,
  PV_OPTIONS,
  ROOMS,
  SCENARIO,
  applianceName,
  hh,
  money,
  type ApplianceId,
  type ForecastAccuracy,
  type Horizon,
  type HorizonPeriod,
  type HourAction,
  type HourPlan,
  type Insight,
  type PlanResponse,
  type RoomId,
} from "../data/contract";

const ACTION_STYLE: Record<HourAction, { label: string; cell: string; text: string }> = {
  run: { label: "Run flexible appliance", cell: "bg-saving/80", text: "text-saving" },
  preheat: { label: "Heat ahead — store warmth while cheap", cell: "bg-[#ff7a59]/80", text: "text-[#ff7a59]" },
  coast: { label: "Heating rests — house stays warm", cell: "bg-primary/70", text: "text-primary" },
  solar: { label: "Sunny hour — good for extra appliances", cell: "bg-solar/60", text: "text-solar" },
  avoid: { label: "Busy / expensive — avoid extra appliances", cell: "bg-peak/75", text: "text-peak" },
  normal: { label: "Normal usage", cell: "bg-muted", text: "text-muted-foreground" },
};

export { APPLIANCE_COLORS };

/** Colour of the scenario's heating appliance (fallback when there is none). */
const heatColor = () => APPLIANCE_COLORS[SCENARIO.heatingAppliance ?? ""] ?? "#ff7a59";

type KpiTone = "default" | "peak" | "saving" | "violet" | "solar" | "pink";

const KPI_COLOR: Record<KpiTone, string> = {
  default: "var(--primary)",
  peak: "var(--peak)",
  saving: "var(--saving)",
  violet: "var(--violet)",
  solar: "var(--solar)",
  pink: "var(--pink)",
};

/** Animates every number inside `text` from 0 (or its previous value) to the new value. */
export function CountUp({ text, duration = 900 }: { text: string; duration?: number }) {
  const [progress, setProgress] = useState(0);
  const from = useRef<string>("");
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setProgress(1);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = text;
    };
    setProgress(0);
    raf = requestAnimationFrame(tick);
    // Browsers pause animation frames in hidden tabs — always end on the real value.
    const done = setTimeout(() => {
      setProgress(1);
      from.current = text;
    }, duration + 250);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [text, duration]);

  if (progress >= 1) return <>{text}</>;
  const previous = from.current.match(/\d+(?:\.\d+)?/g) ?? [];
  let i = 0;
  return (
    <>
      {text.replace(/\d+(?:\.\d+)?/g, (m) => {
        const target = parseFloat(m);
        const start = parseFloat(previous[i++] ?? "0");
        const decimals = m.includes(".") ? m.split(".")[1].length : 0;
        const v = start + (target - start) * progress;
        // keep zero-padded values such as hours ("09") padded while counting
        return decimals === 0 && /^0\d/.test(m) ? String(Math.round(v)).padStart(m.length, "0") : v.toFixed(decimals);
      })}
    </>
  );
}

function Kpi({
  label,
  value,
  unit,
  tone = "default",
  sub,
  icon,
  info,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: KpiTone;
  sub?: string;
  icon?: IconName;
  info?: GlossaryKey;
}) {
  const color = KPI_COLOR[tone];
  return (
    <div className="panel flex min-w-0 flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-medium text-muted-foreground">
          {label}
          {info && <Info term={info} label={label} />}
        </div>
        {icon && (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in oklch, ${color} 13%, transparent)`, color }}>
            <Icon name={icon} size={16} />
          </span>
        )}
      </div>
      <div className="metric text-2xl font-semibold leading-tight" style={tone === "peak" ? { color } : undefined}>
        <CountUp text={value} />
        {unit && <span className="ml-1 text-sm font-medium text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// Chart drawing width follows the screen, so labels stay about 12 px after scaling (phones, tablets, wide desktops).
const W = typeof window === "undefined" ? 720 : window.matchMedia("(max-width: 640px)").matches ? 420 : window.matchMedia("(min-width: 1280px)").matches ? 1060 : 720;
const H = 240;
const TOP = 12;
const BOTTOM = H - 25;
const PLOT_H = BOTTOM - TOP;

function HourAxis({ hours, now }: { hours: HourPlan[]; now: number }) {
  const bw = W / hours.length;
  return (
    <>
      {hours.map((h, i) =>
        h.hour === now || (i % 3 === 0 && Math.abs(h.hour - now) > 1) ? (
          <text
            key={h.hour}
            x={i * bw + bw / 2}
            y={H - 6}
            fontSize={12}
            fill={h.hour === now ? "var(--primary)" : "var(--muted-foreground)"}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
          >
            {hh(h.hour)}
          </text>
        ) : null,
      )}
    </>
  );
}

function Tooltip({ x, lines }: { x: number; lines: { text: string; color?: string; bold?: boolean }[] }) {
  const width = 190;
  const left = Math.min(Math.max(x - width / 2, 5), W - width - 5);
  return (
    <g pointerEvents="none">
      <rect x={left} y={8} width={width} height={18 + lines.length * 17} rx={6} fill="var(--background)" stroke="var(--border)" />
      {lines.map((l, i) => (
        <text key={i} x={left + 12} y={27 + i * 17} fontSize={l.bold ? 12 : 11} fontWeight={l.bold ? 600 : 400} fill={l.color ?? "var(--muted-foreground)"}>
          {l.text}
        </text>
      ))}
    </g>
  );
}

/* =========================================================
   CHART 1 — total energy forecast per hour
   ========================================================= */

function TotalForecastChart({ hours, now, setNow }: { hours: HourPlan[]; now: number; setNow: (h: number) => void }) {
  // Only the model's forecast (calibrated so it does not under-predict). True vs predicted is an internal
  // check: model-training/plot_true_vs_predicted.py → model-training/output/internal/
  const [hovered, setHovered] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  const bw = W / hours.length;
  const maxLoad = Math.max(...hours.map((h) => h.safeForecastLoad)) * 1.08;
  const y = (v: number) => BOTTOM - (v / maxLoad) * PLOT_H;
  const temps = hours.map((h) => h.outdoorTemp);
  const tMin = Math.min(...temps) - 1;
  const tMax = Math.max(...temps) + 1;
  const ty = (t: number) => BOTTOM - ((t - tMin) / (tMax - tMin)) * PLOT_H * 0.9;
  const tempPath = hours.map((h, i) => `${i ? "L" : "M"}${i * bw + bw / 2},${ty(h.outdoorTemp)}`).join(" ");
  const tip = hovered !== null ? hours[hovered] : null;
  // likely range (backtest bands per hour), drawn as a shaded area behind the bars
  const bandPath =
    hours.map((h, i) => `${i ? "L" : "M"}${i * bw + bw / 2},${y(h.safeForecastLoad)}`).join(" ") +
    [...hours]
      .reverse()
      .map((h, i) => `L${(hours.length - 1 - i) * bw + bw / 2},${y(h.lowForecastLoad)}`)
      .join(" ") +
    "Z";

  return (
    <div className="panel flex h-full flex-col p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            Hourly energy forecast
            <Info term="forecast" />
          </h2>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-sm bg-primary" />
            Forecast
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-sm bg-peak" />
            Busiest hours
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-2 w-3 rounded-sm bg-primary/20" />
            Likely range
            <Info term="range" label="likely range" />
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-0.5 w-3 bg-foreground/60" />
            Outdoor °C (forecast)
          </span>
        </div>
      </div>

      <div className="flex flex-1 items-center">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" onMouseLeave={() => setHovered(null)}>
        <defs>
          <linearGradient id={`${gid}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
          <linearGradient id={`${gid}-peak`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" />
            <stop offset="100%" stopColor="#fb923c" />
          </linearGradient>
        </defs>
        <path d={bandPath} fill="var(--primary)" opacity={0.13} pointerEvents="none" />
        {hours.map((h, i) => {
          const x = i * bw;
          const active = hovered === i || now === h.hour;
          return (
            <g key={h.hour} onMouseEnter={() => setHovered(i)} onClick={() => setNow(h.hour)} className="cursor-pointer">
              <rect x={x} y={0} width={bw} height={BOTTOM} fill={now === h.hour ? "var(--primary)" : "transparent"} opacity={now === h.hour ? 0.08 : 1} />
              <rect
                className="bar-grow"
                style={{ animationDelay: `${i * 25}ms` }}
                x={x + bw * 0.2}
                y={y(h.forecastLoad)}
                width={bw * 0.6}
                height={BOTTOM - y(h.forecastLoad)}
                rx={3}
                fill={h.isPeak ? `url(#${gid}-peak)` : `url(#${gid}-bar)`}
                opacity={active ? 1 : 0.8}
              />
              {h.isPeak && (
                <text x={x + bw / 2} y={y(Math.max(h.forecastLoad, h.safeForecastLoad)) - 5} fontSize={12} fill="var(--peak)" textAnchor="middle">
                  ▲
                </text>
              )}
            </g>
          );
        })}
        <path d={tempPath} fill="none" stroke="var(--foreground)" strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="5 3" pointerEvents="none" />
        <text x={W - 2} y={ty(tMax - 1) - 4} fontSize={12} fill="var(--muted-foreground)" textAnchor="end">
          {(tMax - 1).toFixed(0)} °C
        </text>
        <text x={W - 2} y={ty(tMin + 1) + 12} fontSize={12} fill="var(--muted-foreground)" textAnchor="end">
          {(tMin + 1).toFixed(0)} °C
        </text>
        <HourAxis hours={hours} now={now} />
        {tip && hovered !== null && (
          <Tooltip
            x={hovered * bw + bw / 2}
            lines={[
              { text: `${hh(tip.hour)}${tip.isPeak ? " · busiest hour" : ""}`, color: "var(--foreground)", bold: true },
              { text: `Forecast: ${tip.forecastLoad.toFixed(2)} kWh`, color: "var(--primary)" },
              { text: `Likely ${tip.lowForecastLoad.toFixed(2)}–${tip.safeForecastLoad.toFixed(2)} kWh`, color: "var(--primary)" },
              { text: `Home: ${whoIsHome(tip.presence)}` },
              { text: `Outdoor: ${tip.outdoorTemp.toFixed(1)} °C` },
            ]}
          />
        )}
      </svg>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Click a bar to select that hour.</p>
    </div>
  );
}

/* =========================================================
   MULTI-DAY FORECAST — 24 h / 3 / 7 days
   ========================================================= */

function MultiDayForecast({ horizon, days }: { horizon: Horizon; days: number }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const p = horizon.periods.find((x) => x.days === days) ?? horizon.periods[horizon.periods.length - 1];
  const hours = horizon.hours.slice(0, p.days * 24);
  const n = hours.length;
  const bw = W / n;
  const max = Math.max(...hours.flatMap((h) => [h.safeForecast, h.actual ?? 0])) * 1.08;
  const hasActual = hours.some((h) => h.actual !== null);
  const y = (v: number) => BOTTOM - (v / max) * PLOT_H;
  const temps = hours.map((h) => h.outdoorTemp);
  const tMin = Math.min(...temps) - 1;
  const tMax = Math.max(...temps) + 1;
  const ty = (t: number) => BOTTOM - ((t - tMin) / (tMax - tMin)) * PLOT_H * 0.9;
  const peakSet = new Set(p.peakHours.map((x) => x.timestamp));
  const actualPath = hours
    .map((h, i) => (h.actual === null ? "" : `${i && hours[i - 1].actual !== null ? "L" : "M"}${i * bw + bw / 2},${y(h.actual)}`))
    .join(" ");
  const bandPath =
    hours.map((h, i) => `${i ? "L" : "M"}${i * bw + bw / 2},${y(h.safeForecast)}`).join(" ") +
    [...hours]
      .reverse()
      .map((h, i) => `L${(n - 1 - i) * bw + bw / 2},${y(h.lowForecast)}`)
      .join(" ") +
    "Z";
  const tempPath = hours.map((h, i) => `${i ? "L" : "M"}${i * bw + bw / 2},${ty(h.outdoorTemp)}`).join(" ");
  const tip = hovered !== null ? hours[hovered] : null;
  const dayMax = Math.max(...p.daily.map((d) => d.forecastKwh));
  const label = (ts: string) =>
    `${new Date(`${ts.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${ts.slice(11, 16)}`;

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">
              Hourly forecast — next {p.label}
              <Info term="range" label="likely range" />
            </h2>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-sm bg-primary" />
              Forecast
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-sm bg-peak" />
              Top 3 hours
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-2 w-3 rounded-sm bg-primary/20" />
              Likely range
            </span>
            {hasActual && (
              <span className="flex items-center gap-1.5">
                <i className="h-0.5 w-3 bg-foreground" />
                Actual / live
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <i className="h-0.5 w-3 bg-foreground/50" />
              Outdoor °C (forecast)
            </span>
          </div>
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" onMouseLeave={() => setHovered(null)}>
          {p.daily.map((d, di) => {
            const x0 = di * 24 * bw;
            return (
              <g key={d.date}>
                <rect x={x0} y={0} width={24 * bw} height={BOTTOM} fill={di % 2 ? "var(--muted)" : "transparent"} opacity={0.35} />
                <text x={x0 + 12 * bw} y={H - 6} fontSize={12} fill="var(--muted-foreground)" textAnchor="middle" fontFamily="var(--font-mono)">
                  {p.days === 1 ? "" : d.label}
                </text>
              </g>
            );
          })}
          {p.days === 1 &&
            hours.map((h, i) =>
              i % 3 === 0 ? (
                <text key={i} x={i * bw + bw / 2} y={H - 6} fontSize={12} fill="var(--muted-foreground)" textAnchor="middle" fontFamily="var(--font-mono)">
                  {hh(h.hour)}
                </text>
              ) : null,
            )}
          <path d={bandPath} fill="var(--primary)" opacity={0.12} pointerEvents="none" />
          {hours.map((h, i) => (
            <g key={h.timestamp} onMouseEnter={() => setHovered(i)}>
              <rect x={i * bw} y={0} width={bw} height={BOTTOM} fill="transparent" />
              <rect
                className="bar-grow"
                style={{ animationDelay: `${Math.min(i, 120) * 6}ms` }}
                x={i * bw + bw * 0.12}
                y={y(h.forecast)}
                width={Math.max(0.8, bw * 0.76)}
                height={BOTTOM - y(h.forecast)}
                rx={Math.min(2, bw / 4)}
                fill={peakSet.has(h.timestamp) ? "var(--peak)" : "var(--primary)"}
                opacity={hovered === i ? 1 : 0.8}
              />
            </g>
          ))}
          <path d={actualPath} fill="none" stroke="var(--foreground)" strokeOpacity={0.75} strokeWidth={1.2} pointerEvents="none" />
          <path d={tempPath} fill="none" stroke="var(--foreground)" strokeOpacity={0.4} strokeWidth={1.3} strokeDasharray="5 3" pointerEvents="none" />
          <text x={W - 2} y={ty(tMax - 1) - 4} fontSize={12} fill="var(--muted-foreground)" textAnchor="end">
            {(tMax - 1).toFixed(0)} °C
          </text>
          <text x={W - 2} y={ty(tMin + 1) + 12} fontSize={12} fill="var(--muted-foreground)" textAnchor="end">
            {(tMin + 1).toFixed(0)} °C
          </text>
          {tip && hovered !== null && (
            <Tooltip
              x={hovered * bw + bw / 2}
              lines={[
                { text: label(tip.timestamp), color: "var(--foreground)", bold: true },
                { text: `Forecast: ${tip.forecast.toFixed(2)} kWh`, color: "var(--primary)" },
                { text: `Likely ${tip.lowForecast.toFixed(2)}–${tip.safeForecast.toFixed(2)} kWh`, color: "var(--primary)" },
                { text: `Short peaks up to ${tip.peakKw.toFixed(1)} kW`, color: "var(--pink)" },
                ...(tip.actual !== null ? [{ text: `Actual: ${tip.actual.toFixed(2)} kWh`, color: "var(--foreground)" }] : []),
                { text: `Outdoor: ${tip.outdoorTemp.toFixed(1)} °C` },
                { text: `Home: ${whoIsHome(tip.presence)}` },
              ]}
            />
          )}
        </svg>
      </div>

      {p.days > 1 && (
        <div className="panel p-4">
          <h2 className="text-base font-semibold">Day by day</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Forecast per day with the family's planned routine, compared with the period average.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {p.daily.map((d, i) => (
              <div
                key={d.date}
                className="animate-fade-up rounded-md border border-border bg-surface-raised px-3 py-2.5"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{d.label}</span>
                  <span className="metric text-sm font-semibold text-primary">{d.forecastKwh.toFixed(1)} kWh</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${(d.forecastKwh / dayMax) * 100}%` }} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                  {d.actualKwh !== null && <span>actual {d.actualKwh.toFixed(1)}</span>}
                  <span>
                    🌡️ {d.avgTemp.toFixed(1)} °C (min {d.minTemp.toFixed(1)})
                  </span>
                  <span>
                    ⏰ {hh(d.peakHour)} · {d.peakKwh.toFixed(2)} kWh
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-snug">{d.explanation}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   CHART 2 — forecast per appliance per hour
   ========================================================= */

/** "hour" = the selected hour; a number = the next 1, 3 or 7 days. */
type PieScope = "hour" | 1 | 3 | 7;

/** Interactive pie of the appliance forecast: hover a slice, click it for details. */
function ApplianceForecastPie({
  plan,
  now,
  setNow,
  hourControl,
}: {
  plan: PlanResponse;
  now: number;
  setNow: (h: number) => void;
  /** Hour slider shown inside the card (it also drives the appliance table). */
  hourControl?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<PieScope>(1);
  const [hideHeating, setHideHeating] = useState(false);
  const [hovered, setHovered] = useState<ApplianceId | null>(null);
  const [picked, setPicked] = useState<ApplianceId | null>(null);
  const heatingId = SCENARIO.heatingAppliance;
  const priceAt = new Map(plan.hours.map((h) => [h.hour, h.price]));
  const hour = plan.hours.find((h) => h.hour === now) ?? plan.hours[0];
  const week = plan.horizon?.hours ?? [];

  // kWh and cost per appliance for the chosen scope
  const rows = APPLIANCES.filter((a) => !(hideHeating && a.id === heatingId))
    .map((a) => {
      let kwh = 0;
      let cost = 0;
      if (scope === "hour") {
        kwh = hour.forecastByAppliance[a.id];
        cost = kwh * hour.price;
      } else if (scope === 1) {
        for (const h of plan.hours) {
          kwh += h.forecastByAppliance[a.id];
          cost += h.forecastByAppliance[a.id] * h.price;
        }
      } else {
        for (const h of week.slice(0, scope * 24)) {
          kwh += h.byAppliance[a.id] ?? 0;
          cost += (h.byAppliance[a.id] ?? 0) * (priceAt.get(h.hour) ?? 0);
        }
      }
      return { ...a, kwh, cost };
    })
    .filter((r) => r.kwh > 0.0005)
    .sort((x, y) => y.kwh - x.kwh);
  const total = rows.reduce((s, r) => s + r.kwh, 0) || 1;
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);

  // pie geometry
  const size = 260;
  const cx = size / 2;
  const R = 108;
  const r0 = 58;
  let angle = -Math.PI / 2;
  const slices = rows.map((row) => {
    const sweep = (row.kwh / total) * Math.PI * 2;
    const start = angle;
    angle += sweep;
    return { row, start, end: angle, mid: start + sweep / 2 };
  });
  /** Donut slice from angle start to end (radians). */
  const arc = (start: number, end: number) => {
    if (end - start >= Math.PI * 2 - 1e-6) end = start + Math.PI * 2 - 1e-4; // a single 100 % slice
    const large = end - start > Math.PI ? 1 : 0;
    const p = (rad: number, ang: number) => `${cx + rad * Math.cos(ang)},${cx + rad * Math.sin(ang)}`;
    return `M${p(R, start)} A${R},${R} 0 ${large} 1 ${p(R, end)} L${p(r0, end)} A${r0},${r0} 0 ${large} 0 ${p(r0, start)} Z`;
  };
  const focus = hovered ?? picked;
  const focusRow = rows.find((r) => r.id === focus) ?? null;
  const detail = rows.find((r) => r.id === picked) ?? null;
  const scopeLabel = scope === "hour" ? `at ${hh(hour.hour)}` : scope === 1 ? "next 24 h" : `next ${scope} days`;

  // detail: when does the picked appliance run today?
  const profile = detail ? plan.hours.map((h) => ({ hour: h.hour, v: h.forecastByAppliance[detail.id] })) : [];
  const maxV = Math.max(...profile.map((x) => x.v), 0.001);
  const busiest = profile.length ? profile.reduce((m, x) => (x.v > m.v ? x : m)) : null;
  const rec = detail ? plan.recommendations.find((r) => r.applianceId === detail.id) : undefined;

  return (
    <div className="panel p-4">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
        <span>
          <span className="text-base font-semibold">Appliance forecast</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {scopeLabel}: {total.toFixed(1)} kWh · biggest {rows[0]?.name.toLowerCase()} {rows[0] ? `${((rows[0].kwh / total) * 100).toFixed(0)} %` : ""}
          </span>
        </span>
        <span
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
            open ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary hover:text-primary"
          }`}
        >
          {open ? "Hide details" : "Show details"}
          <span aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </span>
      </button>

      {hourControl && <div className="mt-3 rounded-lg bg-surface-raised px-3 py-2.5">{hourControl}</div>}

      {open && (
        <div className="animate-fade-up mt-3">
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
            <div className="flex gap-1 rounded-xl bg-muted p-1">
              {(
                [
                  ["hour", `At ${hh(hour.hour)}`],
                  [1, "24 h"],
                  [3, "3 days"],
                  [7, "7 days"],
                ] as [PieScope, string][]
              )
                .filter(([id]) => id === "hour" || id === 1 || week.length >= id * 24)
                .map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setScope(id)}
                    className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${scope === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
            </div>
            {heatingId && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={hideHeating} onChange={(e) => setHideHeating(e.target.checked)} className="accent-primary" />
                Hide {applianceName(heatingId).toLowerCase()}
              </label>
            )}
          </div>

          <div className="grid gap-3">
            <svg
              viewBox={`0 0 ${size} ${size}`}
              className="mx-auto w-full max-w-[260px]"
              role="img"
              aria-label={`Appliance share ${scopeLabel}`}
              onMouseLeave={() => setHovered(null)}
            >
              {slices.map(({ row, start, end, mid }) => {
                const active = focus === row.id;
                const dx = active ? Math.cos(mid) * 7 : 0;
                const dy = active ? Math.sin(mid) * 7 : 0;
                return (
                  <path
                    key={row.id}
                    d={arc(start, end)}
                    transform={`translate(${dx},${dy})`}
                    fill={row.color}
                    stroke="var(--card)"
                    strokeWidth={1.5}
                    opacity={focus && !active ? 0.45 : 1}
                    className="cursor-pointer transition-all duration-200"
                    onMouseEnter={() => setHovered(row.id)}
                    onClick={() => setPicked((p) => (p === row.id ? null : row.id))}
                  >
                    <title>{`${row.name}: ${row.kwh.toFixed(2)} kWh (${((row.kwh / total) * 100).toFixed(0)} %)`}</title>
                  </path>
                );
              })}
              <text x={cx} y={cx - 10} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">
                {focusRow ? focusRow.name : scopeLabel}
              </text>
              <text x={cx} y={cx + 12} textAnchor="middle" fontSize={20} fontWeight={600} fill="var(--foreground)" fontFamily="var(--font-mono)">
                {(focusRow ? focusRow.kwh : total).toFixed(focusRow && focusRow.kwh < 1 ? 2 : 1)} kWh
              </text>
              <text x={cx} y={cx + 30} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">
                {focusRow ? `${((focusRow.kwh / total) * 100).toFixed(0)} % · ${money(focusRow.cost)}` : money(totalCost)}
              </text>
            </svg>

            <ul className="grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-2">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    onMouseEnter={() => setHovered(row.id)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => setPicked((p) => (p === row.id ? null : row.id))}
                    className={`grid w-full grid-cols-[0.75rem_1fr_auto_auto] items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
                      focus === row.id ? "bg-accent/40" : "hover:bg-accent/25"
                    } ${picked === row.id ? "ring-1 ring-primary" : ""}`}
                  >
                    <i className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} />
                    <span className="truncate">{row.name}</span>
                    <span className="metric text-muted-foreground">{((row.kwh / total) * 100).toFixed(0)} %</span>
                    <span className="metric w-16 text-right">{row.kwh.toFixed(row.kwh < 1 ? 2 : 1)} kWh</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {detail ? (
            <div className="animate-fade-up mt-3 rounded-lg border border-border bg-surface-raised p-3 text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold">
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: detail.color }} />
                  {detail.name} — {scopeLabel}: {detail.kwh.toFixed(2)} kWh · {money(detail.cost)}
                </div>
                <button onClick={() => setPicked(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close details">
                  ×
                </button>
              </div>
              <div className="mt-2 flex h-16 items-end gap-px">
                {profile.map((x) => (
                  <button
                    key={x.hour}
                    onClick={() => setNow(x.hour)}
                    title={`${hh(x.hour)}: ${x.v.toFixed(2)} kWh`}
                    className="flex-1 rounded-t-sm transition-opacity hover:opacity-100"
                    style={{ height: `${Math.max(2, (x.v / maxV) * 100)}%`, background: detail.color, opacity: x.hour === now ? 1 : 0.7 }}
                  />
                ))}
              </div>
              <div className="metric mt-0.5 flex justify-between text-[11px] text-muted-foreground">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>23</span>
              </div>
              <ul className="mt-2 space-y-0.5 text-muted-foreground">
                {busiest && busiest.v > 0 && (
                  <li>
                    ▸ Busiest hour today: <b className="text-foreground">{hh(busiest.hour)}</b> ({busiest.v.toFixed(2)} kWh at{" "}
                    {money(priceAt.get(busiest.hour) ?? 0)}/kWh)
                  </li>
                )}
                {detail.alwaysOn && <li>▸ Runs around the clock.</li>}
                {rec && (
                  <li>
                    ▸ Usually starts at {hh(rec.from)} — the plan moves it to <b className="text-saving">{hh(rec.to)}</b> (saves {money(rec.saving)}).
                  </li>
                )}
                {detail.windowLabel && <li>▸ Flexible: {detail.windowLabel}.</li>}
                {detail.peakTip && <li>▸ {detail.peakTip}</li>}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   CHART 3 — optimised heating and indoor temperature
   ========================================================= */

function HeatingChart({ plan, now, setNow }: { plan: PlanResponse; now: number; setNow: (h: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const hours = plan.hours;
  const bw = W / hours.length;
  const maxHeat = Math.max(...hours.flatMap((h) => [h.heatingUsual, h.heatingOpt])) * 1.15;
  const hgt = (v: number) => (v / maxHeat) * PLOT_H;
  // comfort band of the chosen level (scenario.json → heating.comfort_levels), lower at night
  const level = SCENARIO.comfortLevels.find((l) => l.id === plan.comfortLevel) ?? SCENARIO.comfortLevels[0];
  const night = new Set(SCENARIO.thermal?.nightHours ?? []);
  const band = (hour: number) => (level ? (night.has(hour) ? [level.nightMin, level.nightMax] : [level.dayMin, level.dayMax]) : [20, 22]);
  const temps = hours.map((h) => h.indoorTemp);
  const tLo = Math.min(...temps, ...hours.map((h) => band(h.hour)[0])) - 0.5;
  const tHi = Math.max(...temps, ...hours.map((h) => band(h.hour)[1])) + 0.5;
  const ty = (t: number) => BOTTOM - ((t - tLo) / (tHi - tLo)) * PLOT_H;
  const maxPrice = Math.max(...hours.map((h) => h.price));
  const tempPath = hours.map((h, i) => `${i ? "L" : "M"}${i * bw + bw / 2},${ty(h.indoorTemp)}`).join(" ");
  const tip = hovered !== null ? hours[hovered] : null;
  const hp = plan.heating;

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            Heating plan — the house as a heat battery
            <Info term="heatAhead" label="heat ahead" />
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Heat ahead while electricity is cheap, coast when it is expensive. Indoor stays {hp.minTemp.toFixed(1)}–{hp.maxTemp.toFixed(1)} °C.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-sm bg-muted-foreground/50" />
            Usual heating
            <Info term="coast" label="heating rests" />
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-sm" style={{ background: heatColor() }} />
            Optimised
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-0.5 w-3 bg-primary" />
            Indoor °C
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-2 w-3 rounded-sm bg-primary/15" />
            {level ? `${level.label}: ${level.dayMin}–${level.dayMax} °C day, ${level.nightMin}–${level.nightMax} °C night` : "comfort band"}
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" onMouseLeave={() => setHovered(null)}>
        {hours.map((h, i) => {
          const [lo, hi] = band(h.hour);
          return <rect key={`band-${h.hour}`} x={i * bw} y={ty(hi)} width={bw} height={ty(lo) - ty(hi)} fill="var(--primary)" opacity={0.09} />;
        })}
        {hours.map((h, i) => {
          const x = i * bw;
          const priceH = (h.price / maxPrice) * PLOT_H * 0.25;
          return (
            <g key={h.hour} onMouseEnter={() => setHovered(i)} onClick={() => setNow(h.hour)} className="cursor-pointer">
              <rect x={x} y={0} width={bw} height={BOTTOM} fill={now === h.hour ? "var(--primary)" : "transparent"} opacity={now === h.hour ? 0.08 : 1} />
              <rect x={x + 2} y={BOTTOM - priceH} width={bw - 4} height={priceH} fill="var(--peak)" opacity={0.15} />
              <rect
                className="bar-grow"
                style={{ animationDelay: `${i * 25}ms` }}
                x={x + bw * 0.14}
                y={BOTTOM - hgt(h.heatingUsual)}
                width={bw * 0.32}
                height={hgt(h.heatingUsual)}
                rx={2}
                fill="var(--muted-foreground)"
                opacity={0.45}
              />
              <rect
                className="bar-grow"
                style={{ animationDelay: `${i * 25 + 120}ms` }}
                x={x + bw * 0.5}
                y={BOTTOM - hgt(h.heatingOpt)}
                width={bw * 0.32}
                height={hgt(h.heatingOpt)}
                rx={2}
                fill={heatColor()}
                opacity={hovered === i || now === h.hour ? 1 : 0.85}
              />
            </g>
          );
        })}
        <path d={tempPath} fill="none" stroke="var(--primary)" strokeWidth={2} pointerEvents="none" />
        {[20, 21, 22].map((t) => (
          <text key={t} x={W - 2} y={ty(t) - 3} fontSize={12} fill="var(--muted-foreground)" textAnchor="end">
            {t} °C
          </text>
        ))}
        <HourAxis hours={hours} now={now} />
        {tip && hovered !== null && (
          <Tooltip
            x={hovered * bw + bw / 2}
            lines={[
              { text: `${hh(tip.hour)} · ${money(tip.price)}/kWh`, color: "var(--foreground)", bold: true },
              { text: `Usual heating: ${tip.heatingUsual.toFixed(2)} kWh` },
              { text: `Optimised: ${tip.heatingOpt.toFixed(2)} kWh`, color: heatColor() },
              { text: `Indoor: ${tip.indoorTemp.toFixed(1)} °C`, color: "var(--primary)" },
              { text: `Outdoor: ${tip.outdoorTemp.toFixed(1)} °C` },
            ]}
          />
        )}
      </svg>
      <p className="mt-2 text-xs text-muted-foreground">
        Heat ahead at {hp.preheatHours.map((h) => String(h).padStart(2, "0")).join(", ") || "—"} · coast at{" "}
        {hp.coastHours.map((h) => String(h).padStart(2, "0")).join(", ") || "—"} · heating cost <span className="metric text-saving">−{money(hp.saving)}</span>{" "}
        today ({hp.usualKwh.toFixed(1)} → {hp.optimisedKwh.toFixed(1)} kWh). Shaded bars show the tariff.
      </p>
    </div>
  );
}

/* =========================================================
   4 — HOURLY COST: USUAL VS OPTIMISED, WITH 24 H TOTAL
   ========================================================= */

/** Price band of an hour (for colours and plain-language labels). */
function priceBand(price: number, prices: number[]) {
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  if (price >= hi - 1e-9) return { label: "peak price", color: "var(--peak)" };
  if (price <= lo + 1e-9) return { label: "cheap night price", color: "var(--saving)" };
  return { label: "day price", color: "var(--solar)" };
}

/** One plain-language sentence for what the plan does in an hour and what it means for the bill. */
function hourStory(plan: PlanResponse, h: HourPlan, saving: number) {
  const parts: string[] = [];
  const flexible = APPLIANCES.filter((a) => a.flexible);
  for (const id of h.scheduled) {
    const rec = plan.recommendations.find((r) => r.applianceId === id);
    parts.push(
      rec && rec.from !== rec.to
        ? `The ${applianceName(id).toLowerCase()} runs now instead of at ${hh(rec.from)}.`
        : `The ${applianceName(id).toLowerCase()} runs now — its usual, already cheapest time.`,
    );
  }
  for (const a of flexible) {
    const rec = plan.recommendations.find((r) => r.applianceId === a.id);
    if (rec && rec.from === h.hour && rec.to !== h.hour) parts.push(`The ${a.name.toLowerCase()} would usually run now — the plan moves it to ${hh(rec.to)}.`);
  }
  const extraHeat = h.heatingOpt - h.heatingUsual;
  if (extraHeat > 0.3)
    parts.push(`The heat pump heats a little extra while electricity is cheaper — the house warms to ${h.indoorTempEnd.toFixed(1)} °C and stores the heat.`);
  if (extraHeat < -0.3) parts.push(`The heat pump rests and the stored warmth keeps the house at ${Math.min(h.indoorTemp, h.indoorTempEnd).toFixed(1)} °C.`);
  if (h.usualGrid < 0.01 && h.optimisedGrid < 0.01 && h.solar > 0) parts.push("The solar panels cover everything — no electricity is bought.");
  if (!parts.length) parts.push(h.isPeak ? "One of the busiest hours — the plan keeps extra appliances away." : "Nothing changes in this hour.");
  const money_ =
    saving > 0.005
      ? `This hour costs ${money(saving)} less than usual.`
      : saving < -0.005
        ? `This hour costs ${money(-saving)} more on purpose — it is paid back later in more expensive hours.`
        : "Same cost as usual.";
  return { text: parts.join(" "), money: money_ };
}

type CostRow = { h: HourPlan; usual: number; opt: number; saving: number };

/** Interactive cost chart: usual vs plan per hour, or the saving per hour — over the tariff zones. */
function HourlyCostChart({ rows, prices, picked, onPick }: { rows: CostRow[]; prices: number[]; picked: number; onPick: (hour: number) => void }) {
  const [mode, setMode] = useState<"compare" | "saving">("compare");
  const [hovered, setHovered] = useState<number | null>(null);
  const CH = 250;
  const left = 46;
  const top = 28;
  const bottom = CH - 24;
  const plotW = W - left - 6;
  const bw = plotW / rows.length;
  const x0 = (i: number) => left + i * bw;

  // value scale
  const maxCost = Math.max(...rows.flatMap((r) => [r.usual, r.opt]), 0.01) * 1.12;
  const hi = mode === "compare" ? maxCost : Math.max(0.01, ...rows.map((r) => r.saving)) * 1.12;
  const lo = mode === "compare" ? 0 : Math.min(0, ...rows.map((r) => r.saving)) * 1.3;
  const y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  // round axis steps (€0.05, €0.10, €0.25, …) so the labels read cleanly
  const step = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2].find((st) => (hi - lo) / st <= 4) ?? 5;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t < hi; t += step) ticks.push(Math.round(t * 100) / 100);

  // tariff zones: runs of hours with the same price band
  const zones: { from: number; to: number; band: ReturnType<typeof priceBand>; price: number }[] = [];
  rows.forEach((r, i) => {
    const band = priceBand(r.h.price, prices);
    const last = zones[zones.length - 1];
    if (last && last.price === r.h.price) last.to = i + 1;
    else zones.push({ from: i, to: i + 1, band, price: r.h.price });
  });
  const zoneName = (label: string) => (label === "peak price" ? "Peak" : label === "cheap night price" ? "Night" : "Day");

  const tip = hovered !== null ? rows[hovered] : null;
  const segment = (id: "compare" | "saving", label: string) => (
    <button
      key={id}
      onClick={() => setMode(id)}
      className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${mode === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-4 rounded-xl border border-border p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {segment("compare", "Usual vs plan")}
          {segment("saving", "Saving per hour")}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {mode === "compare" ? (
            <>
              <span className="flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/40" />
                Usual habits
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-sm bg-primary" />
                With the plan
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-sm bg-saving" />
                Saves
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-sm bg-[#ea580c]" />
                Extra on purpose (paid back later)
              </span>
            </>
          )}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${CH}`} className="w-full overflow-visible" onMouseLeave={() => setHovered(null)}>
        {/* tariff zones */}
        {zones.map((z) => (
          <g key={z.from} pointerEvents="none">
            <rect x={x0(z.from)} y={top - 22} width={(z.to - z.from) * bw} height={bottom - top + 22} fill={z.band.color} opacity={0.07} />
            <line x1={x0(z.from)} x2={x0(z.from)} y1={top - 22} y2={bottom} stroke="var(--border)" />
            {(z.to - z.from) * bw > 70 && (
              <text x={x0(z.from) + 6} y={top - 8} fontSize={12} fontWeight={600} fill={z.band.color}>
                {zoneName(z.band.label)} {money(z.price)}
              </text>
            )}
          </g>
        ))}

        {/* grid + value axis */}
        {ticks.map((t) => (
          <g key={t} pointerEvents="none">
            <line x1={left} x2={W - 6} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "3 3"} />
            <text x={left - 6} y={y(t) + 4} fontSize={12} fill="var(--muted-foreground)" textAnchor="end">
              {t < 0 ? "−" : ""}
              {money(Math.abs(t))}
            </text>
          </g>
        ))}

        {/* bars */}
        {rows.map((r, i) => {
          const x = x0(i);
          const isSel = r.h.hour === picked;
          const active = isSel || hovered === i;
          return (
            <g key={r.h.hour} onMouseEnter={() => setHovered(i)} onClick={() => onPick(r.h.hour)} className="cursor-pointer">
              <rect x={x} y={top - 22} width={bw} height={bottom - top + 22} fill={isSel ? "var(--primary)" : "transparent"} opacity={isSel ? 0.1 : 1} />
              {mode === "compare" ? (
                <>
                  <rect x={x + bw * 0.14} y={y(r.usual)} width={bw * 0.34} height={bottom - y(r.usual)} rx={2} fill="var(--muted-foreground)" opacity={active ? 0.55 : 0.35} />
                  <rect x={x + bw * 0.52} y={y(r.opt)} width={bw * 0.34} height={bottom - y(r.opt)} rx={2} fill="var(--primary)" opacity={active ? 1 : 0.8} />
                </>
              ) : (
                Math.abs(r.saving) > 0.005 && (
                  <rect
                    x={x + bw * 0.2}
                    y={Math.min(y(0), y(r.saving))}
                    width={bw * 0.6}
                    height={Math.abs(y(r.saving) - y(0))}
                    rx={2}
                    fill={r.saving > 0 ? "var(--saving)" : "#ea580c"}
                    opacity={active ? 1 : 0.8}
                  />
                )
              )}
            </g>
          );
        })}

        {/* hour axis */}
        {rows.map((r, i) =>
          i % 3 === 0 || r.h.hour === picked ? (
            <text
              key={r.h.hour}
              x={x0(i) + bw / 2}
              y={CH - 6}
              fontSize={12}
              textAnchor="middle"
              fill={r.h.hour === picked ? "var(--primary)" : "var(--muted-foreground)"}
              fontWeight={r.h.hour === picked ? 600 : 400}
            >
              {hh(r.h.hour)}
            </text>
          ) : null,
        )}

        {tip && hovered !== null && (
          <Tooltip
            x={x0(hovered) + bw / 2}
            lines={[
              { text: `${hh(tip.h.hour)} · ${money(tip.h.price)}/kWh`, color: "var(--foreground)", bold: true },
              { text: `Usual habits: ${money(tip.usual)}` },
              { text: `With the plan: ${money(tip.opt)}`, color: "var(--primary)" },
              {
                text: tip.saving > 0.005 ? `Saves ${money(tip.saving)}` : tip.saving < -0.005 ? `Extra ${money(-tip.saving)} on purpose` : "Same cost",
                color: tip.saving > 0.005 ? "var(--saving)" : tip.saving < -0.005 ? "#ea580c" : "var(--muted-foreground)",
              },
            ]}
          />
        )}
      </svg>
      <p className="mt-1 text-xs text-muted-foreground">Hover an hour for its cost; click it to see what the plan does in that hour.</p>
    </div>
  );
}

function HourlyCostTable({ plan, now, setNow }: { plan: PlanResponse; now: number; setNow: (h: number) => void }) {
  const [showTable, setShowTable] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const rows = plan.hours.map((h) => {
    const usual = h.usualGrid * h.price;
    const opt = h.optimisedGrid * h.price;
    return { h, usual, opt, saving: usual - opt };
  });
  const prices = plan.hours.map((h) => h.price);
  const total = rows.reduce(
    (s, r) => ({ usualKwh: s.usualKwh + r.h.usualLoad, optKwh: s.optKwh + r.h.optimisedLoad }),
    { usualKwh: 0, optKwh: 0 },
  );
  // headline totals from the plan (same figures as the banner and the other pages)
  const saved = plan.totals.usualCost - plan.totals.optimisedCost;
  const spentExtra = rows.reduce((sum, r) => sum + Math.max(0, -r.saving), 0);
  const savedGross = rows.reduce((sum, r) => sum + Math.max(0, r.saving), 0);
  const [picked, setPicked] = useState<number>(() => rows.reduce((best, r) => (r.saving > best.saving ? r : best), rows[0]).h.hour);
  const sel = rows.find((r) => r.h.hour === picked) ?? rows[0];
  const story = hourStory(plan, sel.h, sel.saving);
  const band = priceBand(sel.h.price, prices);
  const pick = (hour: number) => {
    setPicked(hour);
    setNow(hour);
  };
  const changed = (r: (typeof rows)[number]) => Math.abs(r.saving) > 0.005 || r.h.action === "run" || r.h.action === "preheat" || r.h.action === "coast";
  const tableRows = onlyChanged ? rows.filter(changed) : rows;

  // what changes today, in plain words
  const moves = plan.recommendations.filter((r) => r.from !== r.to);
  const hp = plan.heating;
  const listed = moves.reduce((sum, r) => sum + r.saving, 0) + (SCENARIO.heatingEnabled ? Math.max(0, hp.saving) : 0);
  const other = saved - listed;

  return (
    <div className="panel p-4">
      <h2 className="text-base font-semibold">
        Today's cost — usual habits vs the plan
        <Info term="tariff" label="price" />
      </h2>

      {/* 2. how */}
      <div className="mt-3 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs">
        <b>How the saving works:</b> the plan spends <span className="metric text-[#ea580c]">{money(spentExtra)}</span> extra in cheaper hours (heating ahead,
        running appliances at night) and saves <span className="metric text-saving">{money(savedGross)}</span> in expensive hours ={" "}
        <span className="metric font-semibold text-saving">{money(saved)}</span> less today, with the same comfort.
      </div>

      {/* 3. interactive 24-hour chart */}
      <HourlyCostChart rows={rows} prices={prices} picked={picked} onPick={pick} />

      {/* selected hour, in plain words */}
      <div key={picked} className="animate-fade-up mt-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5 text-xs">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">{hh(sel.h.hour)}</span>
          <span className="text-muted-foreground">
            {money(sel.h.price)}/kWh · <span style={{ color: band.color }}>{band.label}</span>
          </span>
        </div>
        <p className="mt-1">{story.text}</p>
        <p className={`mt-1 font-medium ${sel.saving > 0.005 ? "text-saving" : sel.saving < -0.005 ? "text-[#ea580c]" : "text-muted-foreground"}`}>
          {story.money}
        </p>
        <p className="metric mt-1 text-[11px] text-muted-foreground">
          usual {sel.h.usualLoad.toFixed(2)} kWh = {money(sel.usual)} · plan {sel.h.optimisedLoad.toFixed(2)} kWh = {money(sel.opt)}
          {sel.h.solar > 0.05 ? ` · solar ${sel.h.solar.toFixed(2)} kWh` : ""}
        </p>
      </div>

      {/* 4. what changes today */}
      <div className="mt-3">
        <div className="label-caps mb-1.5">What changes today</div>
        <ul className="space-y-1.5 text-xs">
          {moves.map((r) => (
            <li key={r.applianceId}>
              <button onClick={() => pick(r.to)} className="flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left hover:bg-accent/30">
                <span className="text-saving">▶</span>
                <span className="flex-1">
                  <b>{r.appliance}</b>: start at <b>{hh(r.to)}</b> instead of {hh(r.from)}
                </span>
                <span className="metric text-saving">−{money(r.saving)}</span>
              </button>
            </li>
          ))}
          {SCENARIO.heatingEnabled && (hp.preheatHours.length > 0 || hp.coastHours.length > 0) && (
            <li>
              <button
                onClick={() => pick(hp.coastHours[0] ?? hp.preheatHours[0])}
                className="flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left hover:bg-accent/30"
              >
                <span className="text-[#ff7a59]">▲</span>
                <span className="flex-1">
                  <b>Heat pump</b>: heat ahead at {hp.preheatHours.map(hh).join(", ") || "—"}, rest at {hp.coastHours.map(hh).join(", ") || "—"} — house stays{" "}
                  {hp.minTemp.toFixed(1)}–{hp.maxTemp.toFixed(1)} °C
                </span>
                <span className="metric text-saving">−{money(hp.saving)}</span>
              </button>
            </li>
          )}
          {other > 0.005 && (
            <li className="flex items-start gap-2 px-1 py-0.5">
              <span className="text-solar">☀</span>
              <span className="flex-1">
                <b>Solar and timing together</b>: moved loads use more of the own solar power and avoid the peak
              </span>
              <span className="metric text-saving">−{money(other)}</span>
            </li>
          )}
          <li className="flex items-start gap-2 border-t border-border px-1 pt-1.5 font-semibold">
            <span />
            <span className="flex-1">Total saving today</span>
            <span className="metric text-saving">−{money(saved)}</span>
          </li>
        </ul>
      </div>

      {/* 5. full table on demand */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
            showTable ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary hover:text-primary"
          }`}
        >
          📋 {showTable ? "Hide hourly table" : "Show hourly table"}
          <span aria-hidden className={`transition-transform ${showTable ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>
        {showTable && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} className="accent-primary" />
            only hours that change
          </label>
        )}
      </div>

      {showTable && (
        <div className="animate-fade-up mt-2 max-h-[26rem] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="label-caps border-b border-border text-left">
                <th className="py-1 font-normal">Hour · what happens</th>
                <th className="py-1 pl-3 text-right font-normal">Price</th>
                <th className="py-1 pl-3 text-right font-normal">Usual</th>
                <th className="py-1 pl-3 text-right font-normal">Plan</th>
                <th className="py-1 pl-3 text-right font-normal">Difference</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map(({ h, usual, opt, saving }) => (
                <tr
                  key={h.hour}
                  onClick={() => pick(h.hour)}
                  className={`cursor-pointer border-b border-border/60 hover:bg-accent/30 ${picked === h.hour ? "bg-primary/10" : ""}`}
                >
                  <td className="py-1.5 pr-2">
                    <span className="metric mr-2">{hh(h.hour)}</span>
                    <span className={h.action === "normal" ? "text-muted-foreground" : ACTION_STYLE[h.action].text}>{h.planNote}</span>
                  </td>
                  <td className="metric whitespace-nowrap py-1.5 pl-3 text-right" style={{ color: priceBand(h.price, prices).color }}>
                    {money(h.price)}
                  </td>
                  <td className="metric whitespace-nowrap py-1.5 pl-3 text-right">{money(usual)}</td>
                  <td className="metric whitespace-nowrap py-1.5 pl-3 text-right">{money(opt)}</td>
                  <td className="whitespace-nowrap py-1.5 pl-3 text-right">
                    <span className={`metric ${saving > 0.005 ? "text-saving" : saving < -0.005 ? "text-[#ea580c]" : "text-muted-foreground"}`}>
                      {saving > 0.005 ? "saves " : saving < -0.005 ? "extra " : ""}
                      {money(Math.abs(saving))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-card">
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2">
                  Total today ({total.usualKwh.toFixed(1)} → {total.optKwh.toFixed(1)} kWh)
                </td>
                <td />
                <td className="metric py-2 pl-3 text-right text-peak">{money(plan.totals.usualCost)}</td>
                <td className="metric py-2 pl-3 text-right text-primary">{money(plan.totals.optimisedCost)}</td>
                <td className="metric py-2 pl-3 text-right text-saving">saves {money(saved)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   YEARLY SOLAR SIMULATOR
   ========================================================= */

function SolarSimulator({ plan, pvKwp }: { plan: PlanResponse; pvKwp: number }) {
  const rows = plan.solarScenarios;
  const cfg = SCENARIO.solar;
  const [kwp, setKwp] = useState(pvKwp || cfg.defaultKwp);
  useEffect(() => setKwp((k) => (pvKwp > 0 ? pvKwp : k)), [pvKwp]);
  const nearest = (v: number) => rows.reduce((best, r) => (Math.abs(r.pvKwp - v) < Math.abs(best.pvKwp - v) ? r : best), rows[0]);
  const s = nearest(kwp);
  const cur = SCENARIO.currency;
  const eur = (v: number) => `${v < 0 ? "−" : ""}${cur}${Math.abs(Math.round(v)).toLocaleString("en")}`;
  const years = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} yr`);

  // where the solar power goes, and when the money comes back
  const homeKwh = Math.max(0, s.annualProductionKwh - s.exportKwh);
  const homePct = s.annualProductionKwh > 0 ? (homeKwh / s.annualProductionKwh) * 100 : 0;
  const horizonYears = 20;
  const standard = rows.filter((r) => PV_OPTIONS.includes(r.pvKwp) && r.pvKwp > 0);
  const maxPayback = Math.max(...standard.map((r) => r.paybackYears ?? 0), s.paybackYears ?? 0, 1);

  const card = "panel h-full p-4 sm:p-5";
  const title = "text-base font-semibold";

  return (
    <div className="space-y-4">
      <SolarHero s={s} kwp={kwp} setKwp={setKwp} />

      <View3D title="3D solar roof" hint="Panels follow the size slider above · drag to turn" camera={[6, 5, 10]}>
        <SolarRoof3D kwp={s.pvKwp} maxKwp={cfg.simulatorMax} />
      </View3D>

      {s.pvKwp > 0 ? (
        <>
          {/* 4. money + where the power goes */}
          <div className="grid gap-4 xl:grid-cols-2">
            <div className={card}>
              <h2 className={title}>Yearly money</h2>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="pb-2 text-left font-normal" />
                    <th className="pb-2 text-right font-normal">A · habits as now</th>
                    <th className="pb-2 text-right font-normal">B · smart habits</th>
                  </tr>
                </thead>
                <tbody className="metric">
                  <tr>
                    <td className="py-1.5 font-sans">Lower electricity bill</td>
                    <td className="text-right">{eur(s.billSaving)}</td>
                    <td className="text-right">{eur(s.billSavingWithShift)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 font-sans">+ export income ({money(cfg.feedInPrice)}/kWh)</td>
                    <td className="text-right">{eur(s.exportIncome)}</td>
                    <td className="text-right">{eur(s.exportIncomeWithShift)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 font-sans">− running cost ({cfg.annualOpexPct} %/yr)</td>
                    <td className="text-right text-peak">{eur(-s.annualOpex)}</td>
                    <td className="text-right text-peak">{eur(-s.annualOpex)}</td>
                  </tr>
                  <tr className="border-t border-border font-semibold">
                    <td className="py-2 font-sans">= net saving per year</td>
                    <td className="text-right text-saving">{eur(s.annualSavings)}</td>
                    <td className="text-right text-saving">{eur(s.annualSavingsWithShift)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 font-sans">
                      Investment ({cur}
                      {cfg.installCostPerKwp.toLocaleString("en")}/kWp)
                    </td>
                    <td className="text-right">{eur(s.installCost)}</td>
                    <td className="text-right">{eur(s.installCost)}</td>
                  </tr>
                  <tr className="font-semibold">
                    <td className="py-1.5 font-sans">Payback</td>
                    <td className="text-right">{years(s.paybackYears)}</td>
                    <td className="text-right text-saving">{years(s.paybackYearsWithShift)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className={card}>
              <h2 className={title}>Where does the solar power go?</h2>
              <div className="mt-3 flex h-10 overflow-hidden rounded-lg text-xs font-semibold text-white">
                <div className="flex items-center justify-center bg-saving transition-all duration-500" style={{ width: `${homePct}%` }}>
                  {homePct >= 15 ? `${homePct.toFixed(0)} % used at home` : ""}
                </div>
                <div className="flex flex-1 items-center justify-center bg-sky-500 transition-all duration-500">
                  {100 - homePct >= 15 ? `${(100 - homePct).toFixed(0)} % to the grid` : ""}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-surface-raised p-3">
                  <div className="font-semibold text-saving">Used in the house</div>
                  <div className="metric mt-1 text-lg font-semibold">{homeKwh.toLocaleString("en", { maximumFractionDigits: 0 })} kWh</div>
                  <div className="text-xs text-muted-foreground">
                    not bought from the grid → <b className="text-saving">{eur(s.billSaving)}</b>/yr
                  </div>
                </div>
                <div className="rounded-lg bg-surface-raised p-3">
                  <div className="font-semibold text-sky-600">Sent to the grid</div>
                  <div className="metric mt-1 text-lg font-semibold">{s.exportKwh.toLocaleString("en")} kWh</div>
                  <div className="text-xs text-muted-foreground">
                    paid only {money(cfg.feedInPrice)}/kWh → <b className="text-sky-600">{eur(s.exportIncome)}</b>/yr
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Every kWh used at home is worth {money(Math.min(...plan.hours.map((h) => h.price)))}–{money(Math.max(...plan.hours.map((h) => h.price)))}; a kWh
                sent to the grid only {money(cfg.feedInPrice)}. A bigger system sends a bigger share to the grid.
              </p>
            </div>
          </div>

          {/* 5. payback timeline + size comparison */}
          <div className="grid gap-4 xl:grid-cols-2">
            <div className={card}>
              <h2 className={title}>
                When is it paid back?
              </h2>
              <div className="mt-3 space-y-3 text-sm">
                {[
                  { label: "Habits as now", years: s.paybackYears, color: "var(--muted-foreground)" },
                  { label: "With smart habits", years: s.paybackYearsWithShift, color: "var(--saving)" },
                ].map((row) => (
                  <div key={row.label}>
                    <div className="mb-1 flex justify-between">
                      <span>{row.label}</span>
                      <b style={{ color: row.color }}>
                        {row.years === null ? "not within 20 years" : `year ${Math.ceil(row.years)} (${row.years.toFixed(1)} yr)`}
                      </b>
                    </div>
                    <div className="flex gap-px">
                      {Array.from({ length: horizonYears }, (_, y) => {
                        const paid = row.years !== null && y + 1 > row.years;
                        return (
                          <div
                            key={y}
                            title={`Year ${y + 1}${paid ? ": profit" : ": paying back"}`}
                            className="h-5 flex-1 rounded-sm transition-colors duration-500"
                            style={{ background: paid ? row.color : "var(--muted)", opacity: paid ? 0.85 : 1 }}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="metric flex justify-between text-xs text-muted-foreground">
                  <span>year 1</span>
                  <span>5</span>
                  <span>10</span>
                  <span>15</span>
                  <span>20</span>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Grey = the savings are still paying off the {eur(s.installCost)} investment. Coloured = after that, every year is pure saving.
              </p>
            </div>

            <div className={card}>
              <h2 className={title}>Compare sizes</h2>
              <p className="mt-1 text-xs text-muted-foreground">Payback time per system size — select one to explore it.</p>
              <div className="mt-3 space-y-1.5 text-sm">
                {standard.map((r) => (
                  <button
                    key={r.pvKwp}
                    onClick={() => setKwp(r.pvKwp)}
                    className={`grid w-full grid-cols-[4rem_1fr_4rem] items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-accent/30 ${
                      r.pvKwp === s.pvKwp ? "bg-primary/10 font-semibold text-primary" : ""
                    }`}
                  >
                    <span className="metric">{r.pvKwp} kWp</span>
                    <span className="h-3 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${((r.paybackYears ?? maxPayback) / maxPayback) * 100}%`,
                          background: "linear-gradient(90deg, #f59e0b, #f97316 55%, #0ea5e9)",
                        }}
                      />
                    </span>
                    <span className="metric text-right">{years(r.paybackYears)}</span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Shorter bar = paid back sooner. Bigger systems save more per year but take longer to pay back.
              </p>
            </div>
          </div>
        </>
      ) : null}

      {/* 6. every size side by side */}
      <div className="panel p-4 sm:p-5">
        <h2 className={title}>All sizes compared</h2>
        <div className="mt-3">
          <SolarTable plan={plan} selected={s.pvKwp} onPick={setKwp} />
        </div>
      </div>
    </div>
  );
}

function SolarTable({ plan, selected, onPick }: { plan: PlanResponse; selected: number; onPick: (kwp: number) => void }) {
  const sizes = new Set([...PV_OPTIONS.filter((k) => k > 0), selected]);
  const rows = plan.solarScenarios.filter((s) => s.pvKwp > 0 && sizes.has(s.pvKwp)).sort((a, b) => a.pvKwp - b.pvKwp);
  const years = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} yr`);
  const eur = (v: number) => `${SCENARIO.currency}${Math.round(v).toLocaleString("en")}`;
  const heads = [
    "PV",
    "Investment",
    "Production",
    "Covers",
    "Less grid",
    "Bill saving",
    "Export income",
    "Running cost",
    "Net saving",
    "Payback A",
    "Payback B",
  ];
  return (
    <div>
      {/* phones: one card per size */}
      <div className="grid gap-2 sm:hidden">
        {rows.map((s) => (
          <button
            key={s.pvKwp}
            onClick={() => onPick(s.pvKwp)}
            className={`rounded-lg border p-3 text-left text-xs ${s.pvKwp === selected ? "border-primary bg-primary/5" : "border-border bg-surface-raised"}`}
          >
            <div className="flex items-baseline justify-between">
              <span className={`metric text-sm font-semibold ${s.pvKwp === selected ? "text-primary" : ""}`}>{s.pvKwp} kWp</span>
              <span className="metric text-muted-foreground">{eur(s.installCost)}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
              <span className="text-muted-foreground">Production</span>
              <span className="metric text-right">{s.annualProductionKwh.toLocaleString("en")} kWh</span>
              <span className="text-muted-foreground">Covers demand</span>
              <span className="metric text-right">{s.demandCoveredPct.toFixed(0)}%</span>
              <span className="text-muted-foreground">Net saving</span>
              <span className="metric text-right text-saving">{eur(s.annualSavings)}/yr</span>
              <span className="text-muted-foreground">Payback A / B</span>
              <span className="metric text-right">
                {years(s.paybackYears)} / <span className="text-saving">{years(s.paybackYearsWithShift)}</span>
              </span>
            </div>
          </button>
        ))}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="label-caps border-b border-border text-left">
              {heads.map((h, i) => (
                <th key={h} className={`py-2 font-normal ${i ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.pvKwp}
                onClick={() => onPick(s.pvKwp)}
                className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-accent/30 ${s.pvKwp === selected ? "font-semibold text-primary" : ""}`}
              >
                <td className="metric py-2">{s.pvKwp} kWp</td>
                <td className="metric py-2 text-right">{eur(s.installCost)}</td>
                <td className="metric py-2 text-right">{s.annualProductionKwh.toLocaleString("en")} kWh</td>
                <td className="metric py-2 text-right">{s.demandCoveredPct.toFixed(0)}%</td>
                <td className="metric py-2 text-right">{s.gridReductionKwh.toLocaleString("en")} kWh</td>
                <td className="metric py-2 text-right">{eur(s.billSaving)}</td>
                <td className="metric py-2 text-right">{eur(s.exportIncome)}</td>
                <td className="metric py-2 text-right text-peak">−{eur(s.annualOpex)}</td>
                <td className="metric py-2 text-right text-saving">{eur(s.annualSavings)}/yr</td>
                <td className="metric py-2 text-right">{years(s.paybackYears)}</td>
                <td className="metric py-2 text-right text-saving">{years(s.paybackYearsWithShift)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =========================================================
   SELECTED HOUR — every appliance + advice
   ========================================================= */

function HourDetail({ plan, hour, selected }: { plan: PlanResponse; hour: HourPlan; selected: RoomId | null }) {
  const rows = APPLIANCES.map((a) => ({ ...a, forecast: hour.forecastByAppliance[a.id], plan: hour.byAppliance[a.id] })).sort(
    (a, b) => b.forecast - a.forecast,
  );
  const max = Math.max(...rows.map((r) => Math.max(r.forecast, r.plan)), 0.01);
  const style = ACTION_STYLE[hour.action];
  const [open, setOpen] = useState(false);

  return (
    <div className="panel p-4">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
        <span>
          <span className="text-base font-semibold">Forecast at {hh(hour.hour)} — every appliance</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {hour.forecastLoad.toFixed(2)} kWh · {money(hour.price)}/kWh · biggest {rows[0]?.name.toLowerCase()}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className={`rounded-full border border-current px-2.5 py-0.5 text-xs ${style.text}`}>{style.label}</span>
          <span
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
              open ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary hover:text-primary"
            }`}
          >
            {open ? "Hide details" : "Show details"}
            <span aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}>
              ▾
            </span>
          </span>
        </span>
      </button>

      {open && (
        <div className="animate-fade-up">
          <p className="mt-2 text-xs text-muted-foreground">
            {hour.forecastLoad.toFixed(2)} kWh predicted (short peaks up to {hour.peakKw.toFixed(1)} kW)
            {hour.actualLoad !== null ? ` · ${hour.actualLoad.toFixed(2)} kWh actual` : ""} · {money(hour.price)}/kWh · {hour.outdoorTemp.toFixed(1)} °C outside
            · {hour.indoorTemp.toFixed(1)} °C inside · home: {whoIsHome(hour.presence)}
          </p>

          <ul className="mt-3 space-y-1.5">
            {rows.map((r) => {
              const dim = selected && r.room !== selected;
              const rec = plan.recommendations.find((x) => x.applianceId === r.id);
              return (
                <li key={r.id} className={`grid grid-cols-[8.5rem_1fr_4.5rem_5rem] items-center gap-2 text-xs transition-opacity ${dim ? "opacity-30" : ""}`}>
                  <span className="flex items-center gap-1.5 truncate">
                    <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: APPLIANCE_COLORS[r.id] }} />
                    {r.name}
                  </span>
                  <span className="relative h-2.5 rounded-full bg-muted">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${Math.max(1, (r.forecast / max) * 100)}%`, background: APPLIANCE_COLORS[r.id] }}
                    />
                  </span>
                  <span className="metric text-right">{r.forecast.toFixed(3)}</span>
                  <span className="text-right text-[11px]">
                    {r.id === SCENARIO.heatingAppliance && Math.abs(hour.heatingOpt - hour.heatingUsual) > 0.05 ? (
                      <span className={hour.heatingOpt > hour.heatingUsual ? "text-[#ff7a59]" : "text-primary"}>plan {hour.heatingOpt.toFixed(2)}</span>
                    ) : rec ? (
                      rec.to === hour.hour ? (
                        <span className="text-saving">run {rec.powerKw} kWh</span>
                      ) : (
                        <span className="text-muted-foreground">→ {hh(rec.to)}</span>
                      )
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-3">
            <div className="label-caps mb-1.5">What to do</div>
            <ul className="space-y-1.5 text-xs">
              {hour.advice.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span className={style.text}>▸</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   LIVE SMART-METER DATA
   ========================================================= */

/* =========================================================
   PERSONALISED INSIGHTS
   ========================================================= */

export function InsightsPanel({ insights, embedded = false }: { insights: Insight[]; embedded?: boolean }) {
  const tone = { saving: "text-saving", peak: "text-peak", info: "text-primary" } as const;
  return (
    <div className={embedded ? "" : "panel p-4"}>
      {!embedded && (
        <>
          <h2 className="text-base font-semibold">Personalised energy insights</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">From {SCENARIO.household.name}'s own data, today's forecast and the plan.</p>
        </>
      )}
      <div className={`grid gap-2 sm:grid-cols-2 ${embedded ? "" : "mt-3"}`}>
        {insights.map((i) => (
          <div key={i.id} className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium">{i.title}</span>
              <span className={`metric shrink-0 text-sm font-semibold ${tone[i.tone]}`}>{i.value}</span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{i.detail}</p>
            {i.tip && <p className="mt-1 text-[11px] leading-snug text-foreground/80">💡 {i.tip}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   TODAY'S ACTIONS — only the moments where something changes
   ========================================================= */

export type ActionItem = { start: number; end: number; icon: string; tone: string; text: string };

/** Heating counts as shifted when it differs from the forecast by more than this (kWh), as in the backend. */
const SHIFT_KWH = 0.5;

/** Groups consecutive hours that share the same key. */
function runs<T>(hours: HourPlan[], key: (h: HourPlan) => T | null) {
  const out: { value: T; start: number; end: number; hours: HourPlan[] }[] = [];
  for (const h of hours) {
    const v = key(h);
    const last = out[out.length - 1];
    if (v !== null && last && last.value === v && last.end === h.hour) {
      last.end = h.hour + 1;
      last.hours.push(h);
    } else if (v !== null) {
      out.push({ value: v, start: h.hour, end: h.hour + 1, hours: [h] });
    }
  }
  return out;
}

export function buildActions(plan: PlanResponse): ActionItem[] {
  const hours = plan.hours;
  const maxPrice = Math.max(...hours.map((h) => h.price));
  const items: ActionItem[] = [];

  for (const h of hours) {
    for (const id of h.scheduled) {
      const when = h.hour < 6 ? "overnight, " : "";
      items.push({
        start: h.hour,
        end: h.hour + 1,
        icon: "▶",
        tone: "text-saving",
        text: `Start the ${applianceName(id).toLowerCase()} (${when}${money(h.price)}/kWh — cheapest slot)`,
      });
    }
  }

  const heatState = (h: HourPlan) => (h.heatingOpt - h.heatingUsual > SHIFT_KWH ? "up" : h.heatingUsual - h.heatingOpt > SHIFT_KWH ? "down" : null);
  for (const r of runs(hours, heatState)) {
    const endTemp = r.hours[r.hours.length - 1].indoorTempEnd;
    const until = r.end - r.start > 1 ? ` until ${hh(r.end)}` : "";
    if (r.value === "up" && r.hours.every((h) => h.price === maxPrice)) {
      items.push({ start: r.start, end: r.end, icon: "▲", tone: "text-[#ff7a59]", text: "Heating a little higher — top up before the dinner peak" });
    } else if (r.value === "up") {
      items.push({
        start: r.start,
        end: r.end,
        icon: "▲",
        tone: "text-[#ff7a59]",
        text: `Heating up${until} — warm the house to ${endTemp.toFixed(1)} °C while power is cheap (${money(r.hours[0].price)})`,
      });
    } else {
      const low = Math.min(endTemp, ...r.hours.map((h) => h.indoorTemp));
      items.push({
        start: r.start,
        end: r.end,
        icon: "▼",
        tone: "text-primary",
        text: `Heating down${until} — the house stays at ${low.toFixed(1)} °C or more on stored warmth`,
      });
    }
  }

  for (const r of runs(hours, (h) => (h.isPeak ? "peak" : null))) {
    const oven = r.hours.some((h) => h.forecastByAppliance.oven_kwh > 0.2);
    items.push({
      start: r.start,
      end: r.end,
      icon: "✕",
      tone: "text-peak",
      text: `Peak demand${r.end - r.start > 1 ? ` until ${hh(r.end)}` : ""} — avoid extra appliances${oven ? "; use the hob rather than the oven" : ""}`,
    });
  }

  return items.sort((a, b) => a.start - b.start || a.icon.localeCompare(b.icon));
}

/** Real calendar days (YYYY-MM-DD) on which at least half of the actions were ticked off. */
function readStreakDays(): string[] {
  try {
    return JSON.parse(localStorage.getItem("energypilot-streak") ?? "[]");
  } catch {
    return [];
  }
}

function streakLength(days: string[]) {
  const set = new Set(days);
  let n = 0;
  const d = new Date();
  while (set.has(d.toISOString().slice(0, 10))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function TodaysActions({ plan, now, setNow }: { plan: PlanResponse; now: number; setNow: (h: number) => void }) {
  const items = buildActions(plan);
  const status = (a: ActionItem) => (a.end <= now ? "done" : a.start <= now ? "now" : "next");
  const upcoming = items.find((a) => a.start > now);
  const storageKey = `energypilot-done-${plan.forecastDate}`;
  // Ticks are stored per action (time + type), so they survive a change of comfort level or PV size.
  const keyOf = (a: ActionItem) => `${a.start}|${a.icon}`;
  const [done, setDone] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    } catch {
      return [];
    }
  });
  const [streak, setStreak] = useState(() => streakLength(readStreakDays()));

  const toggle = (a: ActionItem) => {
    const k = keyOf(a);
    const next = done.includes(k) ? done.filter((x) => x !== k) : [...done, k];
    setDone(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      const today = new Date().toISOString().slice(0, 10);
      const days = readStreakDays().filter((d) => d !== today);
      if (items.filter((x) => next.includes(keyOf(x))).length >= Math.ceil(items.length / 2)) days.push(today);
      localStorage.setItem("energypilot-streak", JSON.stringify(days));
      setStreak(streakLength(days));
    } catch {
      /* storage unavailable — the score just isn't remembered */
    }
  };
  const score = items.filter((a) => done.includes(keyOf(a))).length;
  const pct = items.length ? Math.round((score / items.length) * 100) : 0;

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Today's actions</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Tick off what you did. Click a line to see that hour.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="metric text-primary">now {hh(now)}</span>
          <button
            onClick={() => setNow(new Date().getHours())}
            className="rounded-full border border-border px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            Use current time
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-raised px-3 py-2">
        <span className="text-lg" aria-hidden>
          {pct === 100 ? "🏆" : pct >= 50 ? "🏅" : "🎯"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">
            {score} of {items.length} done {pct === 100 ? "— perfect day!" : pct >= 50 ? "— great job" : ""}
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-saving transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <span className="metric rounded-full bg-peak/15 px-2.5 py-1 text-xs text-peak" title="Days in a row with at least half the actions done">
          🔥 {streak} day{streak === 1 ? "" : "s"} streak
        </span>
      </div>

      <ul className="mt-2 divide-y divide-border/60">
        {items.map((a, i) => {
          const st = status(a);
          const ticked = done.includes(keyOf(a));
          return (
            <li
              key={i}
              className={`flex items-start gap-2 py-2 text-xs ${st === "now" ? "-mx-2 rounded-md bg-primary/10 px-2" : ""} ${
                st === "done" && !ticked ? "opacity-55" : ""
              }`}
            >
              <button
                onClick={() => toggle(a)}
                aria-pressed={ticked}
                aria-label={ticked ? "Mark as not done" : "Mark as done"}
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[11px] transition-all ${
                  ticked ? "border-saving bg-saving text-white" : "border-border hover:border-primary"
                }`}
              >
                {ticked ? "✓" : ""}
              </button>
              <button onClick={() => setNow(a.start)} className="flex min-w-0 flex-1 items-start gap-3 text-left transition-colors hover:text-primary">
                <span className={`w-4 shrink-0 text-center ${a.tone}`}>{a.icon}</span>
                <span className="metric w-11 shrink-0">{hh(a.start)}</span>
                <span className={`flex-1 ${ticked ? "line-through decoration-muted-foreground/50" : ""}`}>{a.text}</span>
                {st === "now" && <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">NOW</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 rounded-md border border-border bg-surface-raised px-3 py-2.5 text-xs">
        {upcoming ? (
          <>
            <span className="label-caps mr-2">Next</span>
            <span className="metric text-primary">{hh(upcoming.start)}</span>
            <span className="text-muted-foreground"> · in {upcoming.start - now} h · </span>
            {upcoming.text}
          </>
        ) : (
          <span className="text-muted-foreground">No more actions today — the plan is complete.</span>
        )}
      </div>
    </div>
  );
}

/** Mixes two hex colours (t = 0 → a, 1 → b); three.js materials need plain colours. */
function mixHex(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/* =========================================================
   OVERVIEW CARDS
   ========================================================= */

/** "Why this forecast" (button): the reasons and the busiest hours. */
function WhyForecastCard({ period: p }: { period: HorizonPeriod }) {
  const [open, setOpen] = useState(false);
  const label = (ts: string) =>
    `${new Date(`${ts.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ${ts.slice(11, 16)}`;
  return (
    <div className="panel p-4">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
        <span className="text-base font-semibold">Why this forecast</span>
        <span
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
            open ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary hover:text-primary"
          }`}
        >
          {open ? "Hide details" : "Show details"}
          <span aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </span>
      </button>
      {open && (
        <div className="animate-fade-up mt-4 grid gap-5 md:grid-cols-2">
          <ul className="space-y-2.5 text-sm leading-relaxed">
            {p.summary.map((line, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <div>
            <div className="label-caps">Highest expected demand</div>
            <ol className="mt-2 space-y-1.5 text-sm">
              {p.peakHours.map((x, i) => (
                <li key={x.timestamp} className="flex items-center justify-between gap-2 rounded-lg bg-peak/10 px-3 py-1.5">
                  <span>
                    <span className="mr-2 font-semibold text-peak">{i + 1}</span>
                    {label(x.timestamp)}
                  </span>
                  <span className="metric font-semibold text-peak">{x.kwh.toFixed(2)} kWh</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

/** "How accurate is the forecast?" (button): backtest error per hour and per period, in plain words. */
function AccuracyCard({ accuracy }: { accuracy: ForecastAccuracy }) {
  const [open, setOpen] = useState(false);
  const a = accuracy.afterCalibration;
  const tiles = [
    { label: "A single hour", value: a.hourly_mae_pct, note: "exact timing varies", color: "#f59e0b" },
    { label: "Next 24 hours (total)", value: a.error_1d_pct, note: "used for the daily plan", color: "#2563eb" },
    { label: "3 days (total)", value: a.error_3d_pct, note: "", color: "#7c3aed" },
    { label: "7 days (total)", value: a.error_7d_pct, note: "", color: "#0d9488" },
  ];
  return (
    <div className="panel p-4">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
        <span className="text-base font-semibold">How accurate is the forecast?</span>
        <span
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
            open ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary hover:text-primary"
          }`}
        >
          {open ? "Hide details" : "Show details"}
          <span aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </span>
      </button>
      {open && (
        <div className="animate-fade-up mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {tiles.map((t) => (
              <div
                key={t.label}
                className="rounded-lg border-l-4 px-3 py-2.5"
                style={{ borderColor: t.color, background: `color-mix(in srgb, ${t.color} 9%, var(--card))` }}
              >
                <div className="text-xs text-muted-foreground">{t.label}</div>
                <div className="metric mt-0.5 text-xl font-semibold" style={{ color: t.color }}>
                  ±{t.value.toFixed(0)} %
                </div>
                {t.note && <div className="text-[11px] text-muted-foreground">{t.note}</div>}
              </div>
            ))}
          </div>
          <div className="grid gap-4 text-sm leading-relaxed md:grid-cols-2">
            <p>
              <b>Why single hours are less precise.</b> In one household, the exact minute the kettle, oven or washing machine is switched on cannot be
              known in advance — a meal 30 minutes later moves energy from one hour to the next. Over a day these shifts cancel out, so the{" "}
              <b>daily and multi-day totals are much more accurate</b> than any single hour.
            </p>
            <p>
              <b>How we use it.</b> The plan and the cost are based on the totals and the likely range, not on one exact hour. The forecast is also set
              about {Math.max(0, a.bias_pct).toFixed(0)} % on the high side on purpose, so at most 1 day in 5 turns out higher than forecast — that safety
              margin is most of the 3- and 7-day error. Measured on {accuracy.backtestWeeks} past weeks the model had not seen before.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   DASHBOARD — one layout per page
   ========================================================= */

export type PageId = "overview" | "forecast" | "heating" | "costs" | "solar" | "appliances";

export const PAGES: { id: PageId; label: string; icon: IconName; title: string; subtitle: string }[] = [
  { id: "overview", label: "Overview", icon: "overview", title: "Overview", subtitle: "Energy demand forecast, cost optimisation and solar assessment for a four-person household with a heat pump." },
  {
    id: "forecast",
    label: "Forecast",
    icon: "forecast",
    title: "Energy forecast",
    subtitle: "Hourly electricity demand for the next 24 hours, 3 days and 7 days, based on the weather forecast and household occupancy.",
  },
  { id: "heating", label: "Heat pump", icon: "heating", title: "Heat pump", subtitle: "Heat-pump schedule that pre-heats the building during low-tariff hours and reduces operation during peak pricing." },
  { id: "costs", label: "Cost & plan", icon: "costs", title: "Cost & plan", subtitle: "Hourly electricity cost, optimised appliance scheduling and scenario analysis." },
  { id: "solar", label: "Solar", icon: "solar", title: "Solar simulator", subtitle: "Assess a rooftop solar installation for the household: select a system size to see its annual production, self-consumption, reduction in grid electricity, net savings and payback period." },
  { id: "appliances", label: "Appliances", icon: "appliances", title: "Appliances", subtitle: "Forecast consumption by appliance and room." },
];

export function Dashboard({
  page,
  setPage,
  now,
  setNow,
  selected,
  setSelected,
  pvKwp,
  setPvKwp,
  plan,
  comfort,
  setComfort,
  scene,
}: {
  page: PageId;
  setPage: (p: PageId) => void;
  now: number;
  setNow: (h: number) => void;
  selected: RoomId | null;
  setSelected: (r: RoomId | null) => void;
  pvKwp: number;
  setPvKwp: (kwp: number) => void;
  plan: PlanResponse;
  comfort: string;
  setComfort: (id: string) => void;
  /** The 3D house (owned by App so it keeps its camera between renders); shown at the start of the Overview. */
  scene: ReactNode;
}) {
  const [openWhy, setOpenWhy] = useState<string | null>(plan.recommendations[0]?.applianceId ?? null);
  const hour = plan.hours.find((h) => h.hour === now) ?? plan.hours[0];

  const appliances = useMemo(() => APPLIANCES.filter((a) => !selected || a.room === selected), [selected]);
  const daily = (id: ApplianceId) => plan.hours.reduce((s, h) => s + h.forecastByAppliance[id], 0);
  const heatingOn = SCENARIO.heatingEnabled;
  const [period, setPeriod] = useState(1);
  const horizon = plan.horizon;
  const day = horizon?.periods[0] ?? null;

  const solar = <SolarSimulator plan={plan} pvKwp={pvKwp} />;

  const hourSlider = (
    <div className="flex flex-wrap items-center gap-4">
      <div className="min-w-32">
        <div className="label-caps">Selected hour</div>
        <div className="metric text-lg text-primary">{hh(now)}</div>
      </div>
      <input
        type="range"
        min={0}
        max={23}
        value={now}
        onChange={(e) => setNow(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded bg-muted accent-primary"
        aria-label="Hour of day"
      />
      <div className="text-xs text-muted-foreground">{hour.outdoorTemp.toFixed(1)} °C outside</div>
    </div>
  );

  const schedule = (
    <div className="panel h-full p-4 sm:p-5">
      <h2 className="text-base font-semibold">
        Suggested habit changes
        <Info term="plan" label="plan" />
      </h2>
      <ul className="mt-3 space-y-2">
        {plan.recommendations.map((r) => (
          <li key={r.applianceId} className="rounded-md border border-border bg-surface-raised">
            <button
              onClick={() => {
                setOpenWhy(openWhy === r.applianceId ? null : r.applianceId);
                setSelected(r.room);
                setNow(r.to);
              }}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
            >
              <span className="flex-1 text-sm font-medium">{r.appliance}</span>
              {r.from !== r.to && <span className="metric text-xs text-muted-foreground line-through">{hh(r.from)}</span>}
              <span className="metric text-xs text-primary">
                {r.from !== r.to ? "→ " : ""}
                {hh(r.to)}
              </span>
              <span className="metric rounded bg-saving/15 px-2 py-0.5 text-xs text-saving">{r.saving >= 0.005 ? `−${money(r.saving)}` : "same cost"}</span>
              <span className="text-xs text-muted-foreground">{openWhy === r.applianceId ? "Hide why" : "Why?"}</span>
            </button>
            {openWhy === r.applianceId && (
              <ul className="space-y-1.5 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                {r.reasons.map((reason, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-primary">▸</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {SCENARIO.heatingEnabled && (plan.heating.preheatHours.length > 0 || plan.heating.coastHours.length > 0) && (
          <li className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
            <div className="flex items-center gap-3">
              <span className="flex-1 text-sm font-medium">{SCENARIO.heatingAppliance ? applianceName(SCENARIO.heatingAppliance) : "Heating"}</span>
              <span className="metric text-xs text-primary">
                heat ahead {plan.heating.preheatHours.map(hh).join(", ") || "—"} · rest {plan.heating.coastHours.map(hh).join(", ") || "—"}
              </span>
              <span className="metric rounded bg-saving/15 px-2 py-0.5 text-xs text-saving">
                {plan.heating.saving >= 0.005 ? `−${money(plan.heating.saving)}` : "same cost"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Warms the house a little more while electricity is cheaper and uses the stored warmth later — indoor stays {plan.heating.minTemp.toFixed(1)}–
              {plan.heating.maxTemp.toFixed(1)} °C.
            </p>
          </li>
        )}
      </ul>
    </div>
  );

  const applianceTable = (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Appliances</h2>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setSelected(null)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${!selected ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            All rooms
          </button>
          {ROOMS.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${selected === r.id ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="label-caps border-b border-border text-left">
              <th className="py-2 font-normal">Appliance</th>
              <th className="hidden py-2 font-normal sm:table-cell">Room</th>
              <th className="py-2 text-right font-normal">{hh(now)}</th>
              <th className="py-2 text-right font-normal">24 h</th>
              <th className="py-2 pl-3 font-normal">Plan</th>
            </tr>
          </thead>
          <tbody>
            {appliances.map((a) => {
              const rec = plan.recommendations.find((r) => r.applianceId === a.id);
              return (
                <tr key={a.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2">
                    <span className="flex items-center gap-2.5">
                      <span
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-base"
                        style={{ background: `color-mix(in srgb, ${APPLIANCE_COLORS[a.id]} 22%, var(--card))` }}
                        aria-hidden
                      >
                        {appliancePicture(a.name)}
                      </span>
                      {a.name}
                    </span>
                  </td>
                  <td className="hidden py-2 text-muted-foreground sm:table-cell">{ROOMS.find((r) => r.id === a.room)?.label}</td>
                  <td className="metric py-2 text-right">{hour.forecastByAppliance[a.id].toFixed(3)}</td>
                  <td className="metric py-2 text-right text-muted-foreground">{daily(a.id).toFixed(2)}</td>
                  <td className="py-2 pl-3 text-xs">
                    {rec ? (
                      <span className="text-primary">Run at {hh(rec.to)}</span>
                    ) : a.id === SCENARIO.heatingAppliance ? (
                      <span className="text-[#ff7a59]">Heats ahead</span>
                    ) : (
                      <span className="text-muted-foreground">Fixed</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const chart1 = <TotalForecastChart hours={plan.hours} now={now} setNow={setNow} />;
  const why = day ? <WhyForecastCard period={day} /> : null;
  const chartWithWhy = (
    <div className="space-y-4">
      {chart1}
      {why}
    </div>
  );
  const chart2 = <ApplianceForecastPie plan={plan} now={now} setNow={setNow} hourControl={hourSlider} />;
  const heatingChart = heatingOn ? <HeatingChart plan={plan} now={now} setNow={setNow} /> : null;
  const costTable = <HourlyCostTable plan={plan} now={now} setNow={setNow} />;
  const hourDetail = <HourDetail plan={plan} hour={hour} selected={selected} />;
  const actions = <TodaysActions plan={plan} now={now} setNow={setNow} />;
  const nowLight = <NowLight plan={plan} now={now} setNow={setNow} />;
  const weekCalendar = <WeekCalendar plan={plan} now={now} setNow={setNow} />;
  const comfortSlider = heatingOn ? <ComfortSlider plan={plan} comfort={comfort} setComfort={setComfort} /> : null;
  const whatIf = horizon ? <WhatIf plan={plan} days={period} /> : null;
  const equivalents = <Equivalents plan={plan} pvKwp={pvKwp} />;
  const whoHome = <WhoIsHome plan={plan} now={now} setNow={setNow} />;
  const forecastHero = horizon ? <ForecastHero horizon={horizon} period={period} setPeriod={setPeriod} /> : null;
  const multiDay = horizon && period > 1;
  const accuracyCard = plan.accuracy ? <AccuracyCard accuracy={plan.accuracy} /> : null;

  // 3D views, one per page (the Overview has the 3D house)
  const periodNow = horizon?.periods.find((x) => x.days === period) ?? horizon?.periods[0];
  const forecast3d = (
    <View3D title="3D energy clock" hint="Drag to turn · orange = busiest hours">
      {period > 1 && periodNow ? (
        <EnergyClock3D
          values={periodNow.daily.map((d) => d.forecastKwh)}
          peaks={[]}
          dayLabels={periodNow.daily.map((d) => new Date(`${d.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" }))}
        />
      ) : (
        <EnergyClock3D values={plan.hours.map((h) => h.forecastLoad)} peaks={plan.hours.map((h) => h.isPeak)} />
      )}
    </View3D>
  );
  // indoor colour: cooler blue at the bottom of the comfort band → warm orange at the top
  const warm = Math.round(Math.min(1, Math.max(0, (hour.indoorTempEnd - (plan.heating.minTemp - 0.5)) / (plan.heating.maxTemp - plan.heating.minTemp + 1))) * 100);
  const heat3d = (
    <View3D title={`3D heat pump at ${hh(now)}`} hint="Follows the hour slider above · drag to turn" camera={[8, 6, 12]}>
      <HeatHouse3D
        indoorColor={mixHex("#93c5fd", "#fb923c", warm / 100)}
        heatLevel={hour.heatingOpt / Math.max(...plan.hours.map((h) => h.heatingOpt), 0.01)}
        resting={hour.action === "coast"}
        indoor={hour.indoorTempEnd}
      />
    </View3D>
  );
  const hourPrices = plan.hours.map((h) => h.price);
  const zone = (p: number) => (p <= Math.min(...hourPrices) + 1e-9 ? "#bbf7d0" : p >= Math.max(...hourPrices) - 1e-9 ? "#fecaca" : "#fde68a");
  const cost3d = (
    <View3D title="3D cost per hour" hint="Floor colour = tariff: green €0.18 · yellow €0.28 · red €0.40" camera={[0, 8, 11]}>
      <CostBars3D usual={plan.hours.map((h) => h.usualGrid * h.price)} plan={plan.hours.map((h) => h.optimisedGrid * h.price)} zoneColors={plan.hours.map((h) => zone(h.price))} />
    </View3D>
  );
  const dailyByAppliance = APPLIANCES.map((a) => ({ id: a.id, name: a.name, room: a.room, color: APPLIANCE_COLORS[a.id], kwh: daily(a.id) }))
    .sort((x, y) => y.kwh - x.kwh)
    .slice(0, 10);
  const appliances3d = (
    <View3D title="3D appliance energy" hint="Sphere size = energy today · click a sphere to show its room" camera={[0, 7, 13]}>
      <ApplianceOrbs3D items={dailyByAppliance} selectedRoom={selected} onPick={(room) => setSelected(selected === room ? null : (room as RoomId))} />
    </View3D>
  );

  const pages: Record<PageId, ReactNode[]> = {
    overview: [
      <TwinHero plan={plan} now={now} setNow={setNow} selected={selected} setSelected={setSelected} />,
      scene,
      hourDetail,
      <OverviewHero plan={plan} />,
      <SolutionSteps setPage={setPage} />,
      nowLight,
      chartWithWhy,
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <HabitChanges plan={plan} setPage={setPage} />
        </div>
        <SolarGlance plan={plan} pvKwp={pvKwp} setPage={setPage} />
      </div>,
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {whoHome}
        {weekCalendar}
      </div>,
    ],
    forecast: multiDay
      ? [
          forecastHero,
          forecast3d,
          <MultiDayForecast key={`md-${period}`} horizon={horizon} days={period} />,
          <WhyForecastCard period={horizon.periods.find((x) => x.days === period) ?? horizon.periods[0]} />,
          accuracyCard,
        ]
      : [forecastHero, forecast3d, chartWithWhy, <TimeOfDay plan={plan} />, accuracyCard, whoHome, hourDetail],
    heating: [<HeatPumpHero plan={plan} now={now} setNow={setNow} />, heat3d, <HeatBatterySteps plan={plan} />, comfortSlider, heatingChart],
    costs: [
      <CostHero plan={plan} />,
      cost3d,
      costTable,
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {schedule}
        {actions}
      </div>,
      whatIf,
      equivalents,
    ],
    solar: [solar],
    appliances: [<AppliancesHero plan={plan} selected={selected} setSelected={setSelected} />, appliances3d, chart2, applianceTable],
  };

  return (
    <div className="space-y-4">
      {page === "heating" && <PageBackdrop glows={["bg-orange-400/15", "bg-rose-400/12", "bg-violet-400/12"]} />}
      {page === "costs" && <PageBackdrop glows={["bg-emerald-400/15", "bg-teal-400/12", "bg-cyan-400/12"]} />}
      {page === "solar" && <PageBackdrop glows={["bg-amber-400/18", "bg-orange-400/12", "bg-sky-400/15"]} />}
      {page === "appliances" && <PageBackdrop glows={["bg-violet-400/15", "bg-fuchsia-400/12", "bg-indigo-400/12"]} />}
      {pages[page].filter(Boolean).map((node, i) => (
        <div key={`${page}-${i}`} className="animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
          {node}
        </div>
      ))}
    </div>
  );
}
