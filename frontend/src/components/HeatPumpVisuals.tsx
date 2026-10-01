import { useState, type PointerEvent } from "react";
import { hh, money, type HourPlan, type PlanResponse } from "../data/contract";
import { CountUp } from "./Dashboard";
import { Icon, type IconName } from "./Icon";

/*
 * Heat pump page visuals:
 *   HeatPumpHero      — warm banner with a glow that follows the pointer, today's heat-pump numbers and an
 *                       interactive house scene: pick an hour and see the fan, heat waves, indoor colour and
 *                       temperature react
 *   HeatBatterySteps  — how the house works as a heat battery: charge → store → rest, with today's hours
 */

type Status = { label: string; picture: string; color: string };

function statusOf(h: HourPlan): Status {
  if (h.action === "preheat") return { label: "Heating ahead — storing warmth", picture: "🔥", color: "#fdba74" };
  if (h.action === "coast") return { label: "Resting on stored warmth", picture: "💤", color: "#99f6e4" };
  if (h.heatingOpt > 0.05) return { label: "Heating", picture: "♨️", color: "#fecdd3" };
  return { label: "Off — warm enough", picture: "⏸️", color: "#e2e8f0" };
}

export function HeatPumpHero({ plan, now, setNow }: { plan: PlanResponse; now: number; setNow: (h: number) => void }) {
  const [glow, setGlow] = useState({ x: 70, y: 30 });
  const hp = plan.heating;
  const hour = plan.hours.find((h) => h.hour === now) ?? plan.hours[0];
  const heatKwh = plan.hours.reduce((s, h) => s + h.heatingOpt, 0);
  const houseKwh = plan.hours.reduce((s, h) => s + h.optimisedLoad, 0) || 1;
  const tiles: { icon: IconName; label: string; value: string; sub: string }[] = [
    { icon: "heating", label: "Heat pump today", value: `${heatKwh.toFixed(1)} kWh`, sub: `${Math.round((heatKwh / houseKwh) * 100)} % of the house` },
    { icon: "leaf", label: "Saved by pre-heating", value: money(Math.max(0, hp.saving)), sub: "same comfort" },
    { icon: "clock", label: "Heats ahead at", value: hp.preheatHours.slice(0, 3).map(hh).join(" · ") || "—", sub: "cheaper hours" },
    { icon: "thermometer", label: "Indoor comfort", value: `${hp.minTemp.toFixed(1)}–${hp.maxTemp.toFixed(1)} °C`, sub: "kept all day" },
  ];
  const move = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setGlow({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };
  const status = statusOf(hour);

  return (
    <section
      onPointerMove={move}
      className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg sm:p-6"
      style={{
        background: `radial-gradient(circle at ${glow.x}% ${glow.y}%, rgba(255,255,255,0.22), transparent 38%), linear-gradient(120deg, #f97316 0%, #e11d48 52%, #7c3aed 100%)`,
      }}
    >
      <span className="drift pointer-events-none absolute -left-12 -top-16 h-56 w-56 rounded-full bg-amber-200/20 blur-2xl" />
      <span className="drift pointer-events-none absolute -bottom-24 right-10 h-64 w-64 rounded-full bg-fuchsia-300/20 blur-3xl" style={{ animationDelay: "-4s" }} />
      <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/80">Heat pump · the house as a heat battery</div>
          <h2 className="mt-1 text-xl font-semibold leading-snug [text-wrap:balance] sm:text-2xl">
            Warms the house while power is cheap and rests when it is expensive — saving <CountUp text={money(Math.max(0, hp.saving))} /> today.
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
                <div className="metric mt-2 text-lg font-semibold">
                  <CountUp text={x.value} />
                </div>
                <div className="text-[11px] text-white/75">{x.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* interactive scene */}
        <div className="rounded-2xl bg-white/10 p-3 backdrop-blur-sm">
          <HouseScene hour={hour} maxHeat={Math.max(...plan.hours.map((h) => h.heatingOpt), 0.01)} band={[hp.minTemp, hp.maxTemp]} />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-slate-900" style={{ background: status.color }}>
              <span aria-hidden>{status.picture}</span>
              {status.label}
            </span>
            <span className="metric text-xs text-white/85">{money(hour.price)}/kWh</span>
          </div>
          <label className="mt-3 flex items-center gap-3 text-sm">
            <span className="metric w-12 font-semibold">{hh(now)}</span>
            <input
              type="range"
              min={0}
              max={23}
              value={now}
              onChange={(e) => setNow(Number(e.target.value))}
              className="h-1.5 flex-1 cursor-pointer accent-white"
              aria-label="Hour of day"
            />
          </label>
          <p className="mt-1 text-[11px] text-white/75">Move the slider to see what the heat pump does in each hour.</p>
        </div>
      </div>
    </section>
  );
}

/** House cut-away: outdoor unit with a spinning fan, warm pipe, heat waves, indoor colour and thermometer. */
function HouseScene({ hour, maxHeat, band }: { hour: HourPlan; maxHeat: number; band: [number, number] }) {
  const level = Math.min(1, hour.heatingOpt / maxHeat);
  const heating = hour.heatingOpt > 0.05;
  const t = hour.indoorTempEnd;
  // indoor colour: cooler blue at the bottom of the band → warm orange at the top
  const warm = Math.round(Math.min(1, Math.max(0, (t - (band[0] - 0.5)) / (band[1] - band[0] + 1))) * 100);
  const indoor = `color-mix(in srgb, #fb923c ${warm}%, #93c5fd)`;
  const fill = Math.min(1, Math.max(0.08, (t - 16) / 8));
  return (
    <svg viewBox="0 0 360 210" className="w-full" role="img" aria-label={`At ${hh(hour.hour)}: indoor ${t.toFixed(1)} °C, heat pump ${hour.heatingOpt.toFixed(2)} kWh`}>
      {/* outside temperature */}
      <g transform="translate(14 14)">
        <rect width="92" height="30" rx="10" fill="white" opacity={0.18} />
        <text x="12" y="20" fontSize={12} fill="white">
          outside {hour.outdoorTemp.toFixed(0)} °C
        </text>
      </g>
      {/* ground */}
      <rect x="0" y="192" width="360" height="18" rx="4" fill="white" opacity={0.18} />
      {/* house */}
      <polygon points="130,92 225,40 320,92" fill="#1e1b4b" opacity={0.75} />
      <rect x="140" y="92" width="170" height="100" rx="4" fill={indoor} style={{ transition: "fill 0.6s ease" }} />
      <rect x="140" y="92" width="170" height="100" rx="4" fill="none" stroke="white" strokeWidth={3} />
      {/* sofa */}
      <rect x="160" y="160" width="62" height="18" rx="6" fill="white" opacity={0.55} />
      <rect x="156" y="152" width="12" height="26" rx="5" fill="white" opacity={0.55} />
      <rect x="214" y="152" width="12" height="26" rx="5" fill="white" opacity={0.55} />
      {/* heat waves */}
      {heating &&
        [176, 200, 224].map((x, i) => (
          <path
            key={x}
            d={`M${x} 150 q6 -8 0 -16 q-6 -8 0 -16`}
            fill="none"
            stroke="white"
            strokeWidth={3}
            strokeLinecap="round"
            className="rise"
            style={{ animationDelay: `${i * 0.45}s`, animationDuration: `${2.4 - level}s` }}
          />
        ))}
      {hour.action === "coast" && (
        <text x="236" y="138" fontSize={20} fontWeight={700} fill="white" className="bob">
          z z
        </text>
      )}
      {/* thermometer */}
      <g transform="translate(276 104)">
        <rect x="0" y="0" width="12" height="62" rx="6" fill="white" opacity={0.9} />
        <rect x="3" y={3 + 56 * (1 - fill)} width="6" height={56 * fill} rx="3" fill="#ef4444" style={{ transition: "all 0.6s ease" }} />
        <circle cx="6" cy="68" r="9" fill="#ef4444" stroke="white" strokeWidth={3} />
      </g>
      <text x="232" y="112" fontSize={16} fontWeight={700} fill="white">
        {t.toFixed(1)}°
      </text>
      {/* pipe from the outdoor unit */}
      <path d="M100 176 H140" stroke={heating ? "#fdba74" : "white"} strokeWidth={5} opacity={heating ? 1 : 0.4} className={heating ? "flow" : ""} />
      {/* outdoor unit with fan */}
      <rect x="22" y="138" width="80" height="54" rx="8" fill="white" opacity={0.92} />
      <circle cx="54" cy="165" r="19" fill="#e2e8f0" />
      <g
        className="spin-slow"
        style={{
          transformBox: "view-box",
          transformOrigin: "54px 165px",
          animationDuration: `${Math.max(0.35, 1.8 - level * 1.4)}s`,
          animationPlayState: heating ? "running" : "paused",
        }}
      >
        {[0, 120, 240].map((a) => (
          <ellipse key={a} cx="54" cy="156" rx="5" ry="10" fill="#64748b" transform={`rotate(${a} 54 165)`} />
        ))}
      </g>
      <circle cx="54" cy="165" r="4" fill="#334155" />
      <rect x="80" y="148" width="14" height="34" rx="3" fill="#cbd5e1" />
      <text x="62" y="206" fontSize={11} fill="white" textAnchor="middle" opacity={0.9}>
        {hour.heatingOpt.toFixed(2)} kWh
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ heat battery steps */

export function HeatBatterySteps({ plan }: { plan: PlanResponse }) {
  const hp = plan.heating;
  const list = (hours: number[]) => (hours.length ? hours.map(hh).join(", ") : "—");
  const steps = [
    { picture: "🔥", title: "Charge", color: "#f97316", text: "Heat a little extra while electricity is cheaper.", detail: list(hp.preheatHours) },
    { picture: "🏠", title: "Store", color: "#e11d48", text: "The walls and floors keep the warmth, like a battery.", detail: `${hp.minTemp.toFixed(1)}–${hp.maxTemp.toFixed(1)} °C inside` },
    { picture: "💤", title: "Rest", color: "#7c3aed", text: "The heat pump rests when electricity is expensive.", detail: list(hp.coastHours) },
  ];
  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">How the heat battery works</h2>
        <span className="metric rounded-full bg-saving/15 px-3 py-1 text-xs font-semibold text-saving">saves {money(Math.max(0, hp.saving))} today · same comfort</span>
      </div>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map((st, i) => (
          <li key={st.title} className="relative">
            <div
              className="lift flex h-full flex-col gap-2 rounded-xl border p-4"
              style={{ borderColor: `color-mix(in srgb, ${st.color} 35%, var(--border))`, background: `color-mix(in srgb, ${st.color} 8%, var(--card))` }}
            >
              <span className="flex items-center gap-3">
                <span
                  className="bob grid h-12 w-12 place-items-center rounded-2xl text-2xl shadow-md"
                  style={{ background: `linear-gradient(135deg, ${st.color}, color-mix(in srgb, ${st.color} 55%, white))`, animationDelay: `${i * 0.4}s` }}
                  aria-hidden
                >
                  {st.picture}
                </span>
                <span>
                  <span className="block text-[11px] font-semibold uppercase tracking-wider" style={{ color: st.color }}>
                    Step {i + 1}
                  </span>
                  <span className="block text-base font-semibold">{st.title}</span>
                </span>
              </span>
              <span className="text-sm text-muted-foreground">{st.text}</span>
              <span className="metric mt-auto rounded-lg bg-card px-3 py-1.5 text-sm font-semibold" style={{ color: st.color }}>
                {st.detail}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span className="nudge pointer-events-none absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-border bg-card p-0.5 text-muted-foreground shadow-sm md:block">
                <Icon name="arrow" size={14} />
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
