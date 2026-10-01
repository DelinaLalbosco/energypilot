import { hh, money, type Horizon, type PlanResponse } from "../data/contract";
import { CountUp } from "./Dashboard";
import { Icon, type IconName } from "./Icon";

/*
 * Forecast page visuals:
 *   ForecastHero — colourful banner: period switch (24 h / 3 days / 7 days), the period's key numbers,
 *                  a weather picture and the forecast curve drawing itself
 *   TimeOfDay    — where the next 24 hours of energy go: night, morning, afternoon, evening
 */

const dayTime = (ts: string) =>
  `${new Date(`${ts.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" })} ${ts.slice(11, 16)}`;

export function ForecastHero({ horizon, period, setPeriod }: { horizon: Horizon; period: number; setPeriod: (d: number) => void }) {
  const p = horizon.periods.find((x) => x.days === period) ?? horizon.periods[0];
  const series = horizon.hours.slice(0, p.days * 24);
  const tiles: { icon: IconName; label: string; value: string; sub: string }[] = [
    { icon: "bolt", label: `Total, next ${p.label}`, value: `${p.forecastKwh.toFixed(1)} kWh`, sub: p.days === 1 ? "forecast" : `likely ${p.lowKwh.toFixed(0)}–${p.highKwh.toFixed(0)} kWh` },
    p.days === 1
      ? { icon: "target", label: "Likely range", value: `${p.lowKwh.toFixed(0)}–${p.highKwh.toFixed(0)} kWh`, sub: "8 in 10 days fall inside" }
      : { icon: "history", label: "Per day", value: `${(p.forecastKwh / p.days).toFixed(1)} kWh`, sub: "average" },
    { icon: "clock", label: "Highest hour", value: `${p.peakHours[0].kwh.toFixed(2)} kWh`, sub: dayTime(p.peakHours[0].timestamp) },
    { icon: "thermometer", label: "Outdoor", value: `${p.minTemp.toFixed(0)}…${p.maxTemp.toFixed(0)} °C`, sub: `average ${p.avgTemp.toFixed(1)} °C` },
  ];
  return (
    <section
      className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg sm:p-6"
      style={{ background: "linear-gradient(120deg, #0d9488 0%, #2563eb 50%, #4f46e5 100%)" }}
    >
      <span className="pointer-events-none absolute -left-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
      <span className="pointer-events-none absolute -bottom-24 right-1/4 h-56 w-56 rounded-full bg-cyan-300/20 blur-3xl" />
      <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-white/75">Energy forecast</div>
            <div className="flex gap-1 rounded-xl bg-white/15 p-1 backdrop-blur-sm" role="tablist" aria-label="Forecast period">
              {horizon.periods.map((x) => (
                <button
                  key={x.days}
                  role="tab"
                  aria-selected={period === x.days}
                  onClick={() => setPeriod(x.days)}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${period === x.days ? "bg-white text-[#1d4ed8] shadow-sm" : "text-white/85 hover:bg-white/15"}`}
                >
                  {x.label}
                </button>
              ))}
            </div>
          </div>
          <h2 className="mt-2 text-xl font-semibold leading-snug [text-wrap:balance] sm:text-2xl">
            The next {p.label} need about <CountUp key={p.days} text={`${p.forecastKwh.toFixed(1)} kWh`} />.
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {tiles.map((x) => (
              <div key={x.label} className="lift rounded-xl bg-white/15 p-3 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-xs text-white/85">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/20">
                    <Icon name={x.icon} size={15} />
                  </span>
                  {x.label}
                </div>
                <div className="metric mt-2 text-xl font-semibold">
                  <CountUp key={`${p.days}-${x.label}`} text={x.value} />
                </div>
                <div className="text-[11px] text-white/75">{x.sub}</div>
              </div>
            ))}
          </div>
        </div>
        <ForecastPicture key={p.days} values={series.map((h) => h.forecast)} peaks={series.map((h) => p.peakHours.some((x) => x.timestamp === h.timestamp))} avgTemp={p.avgTemp} />
      </div>
    </section>
  );
}

/** Weather scene (sun behind a drifting cloud, temperature) above the forecast curve, which draws itself. */
function ForecastPicture({ values, peaks, avgTemp }: { values: number[]; peaks: boolean[]; avgTemp: number }) {
  const W = 340;
  const top = 104;
  const bottom = 196;
  const max = Math.max(...values, 0.01);
  const x = (i: number) => 8 + (i / Math.max(1, values.length - 1)) * (W - 16);
  const y = (v: number) => bottom - (v / max) * (bottom - top);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(values.length - 1)},${bottom} L${x(0)},${bottom} Z`;
  return (
    <svg viewBox={`0 0 ${W} 205`} className="mx-auto w-full max-w-[340px]" role="img" aria-label="Weather and the forecast curve">
      {/* sun + cloud */}
      <g className="spin-slow">
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i * Math.PI) / 5;
          return <line key={i} x1={96 + Math.cos(a) * 26} y1={46 + Math.sin(a) * 26} x2={96 + Math.cos(a) * 34} y2={46 + Math.sin(a) * 34} stroke="#fde68a" strokeWidth={4} strokeLinecap="round" />;
        })}
      </g>
      <circle cx="96" cy="46" r="19" fill="#fcd34d" />
      <g className="drift" fill="white">
        <ellipse cx="124" cy="62" rx="30" ry="13" opacity={0.95} />
        <ellipse cx="104" cy="66" rx="20" ry="10" opacity={0.95} />
        <ellipse cx="146" cy="66" rx="18" ry="9" opacity={0.95} />
      </g>
      {/* temperature */}
      <g transform="translate(212 20)">
        <rect width="112" height="58" rx="14" fill="white" opacity={0.16} />
        <path d="M22 14 v20 a8 8 0 1 0 6 0 v-20 a3 3 0 0 0 -6 0 z" fill="none" stroke="white" strokeWidth={2.2} />
        <circle cx="25" cy="40" r="4" fill="#f87171" />
        <text x="42" y="30" fontSize={11} fill="white" opacity={0.85}>
          average
        </text>
        <text x="42" y="47" fontSize={18} fontWeight={700} fill="white">
          {avgTemp.toFixed(0)} °C
        </text>
      </g>
      {/* forecast curve */}
      <path d={area} fill="white" opacity={0.14} />
      <path d={line} pathLength={1} fill="none" stroke="white" strokeWidth={2.5} strokeLinejoin="round" className="draw" />
      {values.map((v, i) =>
        peaks[i] ? (
          <g key={i} className="bob">
            <circle cx={x(i)} cy={y(v)} r={6} fill="#fb923c" stroke="white" strokeWidth={2} />
          </g>
        ) : null,
      )}
      <line x1="8" x2={W - 8} y1={bottom} y2={bottom} stroke="white" opacity={0.35} />
    </svg>
  );
}

/* ------------------------------------------------------------------ time of day */

const PARTS: { name: string; picture: string; from: number; to: number; color: string }[] = [
  { name: "Night", picture: "🌙", from: 0, to: 6, color: "#6366f1" },
  { name: "Morning", picture: "🌅", from: 6, to: 12, color: "#f59e0b" },
  { name: "Afternoon", picture: "☀️", from: 12, to: 17, color: "#0ea5e9" },
  { name: "Evening", picture: "🌆", from: 17, to: 24, color: "#ec4899" },
];

export function TimeOfDay({ plan }: { plan: PlanResponse }) {
  const parts = PARTS.map((part) => {
    const hours = plan.hours.filter((h) => h.hour >= part.from && h.hour < part.to);
    const kwh = hours.reduce((s, h) => s + h.forecastLoad, 0);
    const cost = hours.reduce((s, h) => s + h.forecastLoad * h.price, 0);
    return { ...part, kwh, avgPrice: kwh > 0 ? cost / kwh : 0 };
  });
  const total = parts.reduce((s, x) => s + x.kwh, 0) || 1;
  const biggest = parts.reduce((m, x) => (x.kwh > m.kwh ? x : m), parts[0]);
  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">When is the energy used?</h2>
        <p className="text-xs text-muted-foreground">Next 24 hours, by time of day</p>
      </div>
      {/* one bar for the whole day */}
      <div className="mt-4 flex h-3 overflow-hidden rounded-full">
        {parts.map((x) => (
          <span key={x.name} className="h-full transition-all duration-700" style={{ width: `${(x.kwh / total) * 100}%`, background: x.color }} />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {parts.map((x, i) => (
          <div
            key={x.name}
            className="lift relative rounded-xl border p-3"
            style={{ borderColor: `color-mix(in srgb, ${x.color} 35%, var(--border))`, background: `color-mix(in srgb, ${x.color} 8%, var(--card))` }}
          >
            {x === biggest && (
              <span className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: x.color }}>
                Most energy
              </span>
            )}
            <div className="flex items-center gap-2.5">
              <span className="bob text-3xl" style={{ animationDelay: `${i * 0.35}s` }} aria-hidden>
                {x.picture}
              </span>
              <span>
                <span className="block text-sm font-semibold">{x.name}</span>
                <span className="metric block text-[11px] text-muted-foreground">
                  {hh(x.from)}–{hh(x.to % 24)}
                </span>
              </span>
            </div>
            <div className="metric mt-3 text-xl font-semibold" style={{ color: x.color }}>
              {x.kwh.toFixed(1)} kWh
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(x.kwh / total) * 100}%`, background: x.color }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
              <span>{Math.round((x.kwh / total) * 100)} % of the day</span>
              <span className="metric">{money(x.avgPrice)}/kWh</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
