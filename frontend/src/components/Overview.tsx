import { SCENARIO, hh, money, type PlanResponse } from "../data/contract";
import { CountUp, type PageId } from "./Dashboard";
import { Icon, type IconName } from "./Icon";
import { appliancePicture } from "./pictures";

/*
 * Overview page visuals:
 *   OverviewHero   — colourful banner: today's key numbers + animated house (sun, grid, energy flow)
 *   SolutionSteps  — the solution in four colour-coded steps (click to open the page)
 *   HabitChanges   — what the plan moves today, as pictures: usual time → new time, saving
 *   SolarGlance    — the chosen PV size: share of the home covered (ring), yearly numbers
 */

/** Whole currency amounts for yearly figures (€848, €6,500). */
const whole = (v: number) => `${SCENARIO.currency}${Math.round(v).toLocaleString("en")}`;

/** Solar scenario for the chosen size (the closest simulated one). */
function solarFor(plan: PlanResponse, kwp: number) {
  return [...plan.solarScenarios].sort((a, b) => Math.abs(a.pvKwp - kwp) - Math.abs(b.pvKwp - kwp))[0];
}

/* ------------------------------------------------------------------ hero */

export function OverviewHero({ plan }: { plan: PlanResponse }) {
  const t = plan.totals;
  const saving = Math.max(0, t.usualCost - t.optimisedCost);
  const pct = t.usualCost > 0 ? Math.round((saving / t.usualCost) * 100) : 0;
  const tiles: { icon: IconName; label: string; value: string; sub: string }[] = [
    { icon: "bolt", label: "Energy next 24 h", value: `${t.forecastKwh.toFixed(1)} kWh`, sub: "forecast" },
    { icon: "wallet", label: "Cost today", value: money(t.optimisedCost), sub: `${money(saving)} saved by the plan` },
    { icon: "clock", label: "Peak hours", value: plan.peakHours.slice(0, 2).map(hh).join(" · "), sub: "avoid extra appliances" },
    { icon: "solar", label: "Solar today", value: `${t.solarKwh.toFixed(1)} kWh`, sub: `from ${plan.pvKwp} kWp panels` },
  ];
  return (
    <section
      className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg sm:p-6"
      style={{ background: "linear-gradient(120deg, #2563eb 0%, #7c3aed 55%, #db2777 100%)" }}
    >
      <span className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
      <span className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-amber-300/20 blur-3xl" />
      <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/75">Today at a glance</div>
          <h2 className="mt-1 text-xl font-semibold leading-snug [text-wrap:balance] sm:text-2xl">
            The house needs <CountUp text={`${t.forecastKwh.toFixed(1)} kWh`} /> today — the plan saves <CountUp text={money(saving)} /> ({pct} %).
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {tiles.map((x) => (
              <div key={x.label} className="lift rounded-xl bg-white/15 p-3 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-xs text-white/85">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/20">
                    <Icon name={x.icon} size={15} />
                  </span>
                  {x.label}
                </div>
                <div className="metric mt-2 text-xl font-semibold">
                  <CountUp text={x.value} />
                </div>
                <div className="text-[11px] text-white/75">{x.sub}</div>
              </div>
            ))}
          </div>
        </div>
        <HouseIllustration />
      </div>
    </section>
  );
}

/** Animated house: sun on the solar roof, power from the grid, glowing windows, drifting clouds. */
function HouseIllustration() {
  return (
    <svg viewBox="0 0 360 220" className="mx-auto w-full max-w-[360px]" role="img" aria-label="House with solar panels powered by the sun and the grid">
      {/* clouds */}
      <g className="drift" fill="white" opacity={0.35}>
        <ellipse cx="90" cy="38" rx="26" ry="10" />
        <ellipse cx="108" cy="32" rx="18" ry="10" />
      </g>
      {/* sun */}
      <g className="spin-slow">
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return (
            <line key={i} x1={300 + Math.cos(a) * 30} y1={44 + Math.sin(a) * 30} x2={300 + Math.cos(a) * 40} y2={44 + Math.sin(a) * 40} stroke="#fde68a" strokeWidth={4} strokeLinecap="round" />
          );
        })}
      </g>
      <circle cx="300" cy="44" r="22" fill="#fcd34d" />
      {/* sunlight → roof */}
      <path d="M282 62 L236 104" stroke="#fde68a" strokeWidth={3} fill="none" className="flow" strokeLinecap="round" />
      {/* ground */}
      <rect x="0" y="196" width="360" height="24" rx="4" fill="white" opacity={0.18} />
      {/* pylon */}
      <g stroke="white" strokeWidth={2.5} opacity={0.9} fill="none" strokeLinecap="round">
        <path d="M40 196 L52 92 L64 196" />
        <path d="M44 160 L60 160 M47 128 L57 128 M36 104 L68 104" />
      </g>
      {/* grid → house */}
      <path d="M68 104 Q118 96 150 142" stroke="#bfdbfe" strokeWidth={3} fill="none" className="flow" strokeLinecap="round" />
      {/* tree */}
      <rect x="322" y="170" width="6" height="26" rx="2" fill="#78350f" opacity={0.8} />
      <circle cx="325" cy="160" r="18" fill="#34d399" opacity={0.9} className="bob" />
      {/* house */}
      <polygon points="150,116 230,70 310,116" fill="#1e293b" opacity={0.85} />
      <g fill="#60a5fa">
        <polygon points="200,96 222,84 238,93 216,105" />
        <polygon points="226,82 248,70 264,79 242,91" />
        <polygon points="220,108 242,96 258,105 236,117" opacity={0.9} />
      </g>
      <rect x="160" y="116" width="140" height="80" rx="3" fill="white" />
      <rect x="215" y="150" width="28" height="46" rx="2" fill="#7c3aed" opacity={0.85} />
      <rect x="176" y="132" width="26" height="22" rx="2" fill="#fbbf24" className="glow" />
      <rect x="258" y="132" width="26" height="22" rx="2" fill="#fbbf24" className="glow" style={{ animationDelay: "1.3s" }} />
      {/* energy badge */}
      <g className="bob" style={{ animationDelay: "0.6s" }}>
        <circle cx="160" cy="88" r="14" fill="#22c55e" />
        <path d="M162 79 L154 90 L160 90 L158 97 L166 86 L160 86 Z" fill="white" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ steps */

const STEP_COLORS = ["#7c3aed", "#2563eb", "#16a34a", "#f59e0b"];

/** The solution in four steps — click a step to open its page. */
export function SolutionSteps({ setPage }: { setPage: (p: PageId) => void }) {
  const steps: { page: PageId; icon: IconName; title: string; text: string }[] = [
    { page: "appliances", icon: "history", title: "Learn the family's habits", text: "A year of hourly use, per appliance." },
    { page: "forecast", icon: "brain", title: "Forecast demand", text: "Weather + who's home → next 24 h, 3 and 7 days." },
    { page: "costs", icon: "target", title: "Optimise the cost", text: "Move appliances, pre-heat before the peak." },
    { page: "solar", icon: "solar", title: "Simulate solar panels", text: "Pick a size, see savings and payback." },
  ];
  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">How EnergyPilot works</h2>
        <p className="text-xs text-muted-foreground">Select a step for details.</p>
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((st, i) => {
          const c = STEP_COLORS[i];
          return (
            <li key={st.page} className="relative">
              <button
                onClick={() => setPage(st.page)}
                className="lift group flex h-full w-full flex-col items-start gap-3 rounded-xl border p-4 text-left"
                style={{ borderColor: `color-mix(in srgb, ${c} 35%, var(--border))`, background: `color-mix(in srgb, ${c} 7%, var(--card))` }}
              >
                <span className="flex w-full items-center justify-between">
                  <span
                    className="grid h-12 w-12 place-items-center rounded-2xl text-white shadow-md"
                    style={{ background: `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 60%, white))` }}
                  >
                    <Icon name={st.icon} size={24} />
                  </span>
                  <span className="text-3xl font-bold opacity-15" style={{ color: c }}>
                    {i + 1}
                  </span>
                </span>
                <span className="text-sm font-semibold">{st.title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{st.text}</span>
                <span className="mt-auto flex items-center gap-1.5 text-xs font-semibold" style={{ color: c }}>
                  View details
                  <Icon name="arrow" size={14} className="transition-transform group-hover:translate-x-1" />
                </span>
              </button>
              {i < steps.length - 1 && (
                <span className="nudge pointer-events-none absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-border bg-card p-0.5 text-muted-foreground shadow-sm xl:block">
                  <Icon name="arrow" size={14} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ habit changes */


export function HabitChanges({ plan, setPage }: { plan: PlanResponse; setPage: (p: PageId) => void }) {
  const hp = plan.heating;
  const rows: { key: string; name: string; from?: string; to: string; saving: number }[] = plan.recommendations.map((r) => ({
    key: r.applianceId,
    name: r.appliance,
    from: r.from !== r.to ? hh(r.from) : undefined,
    to: hh(r.to),
    saving: r.saving,
  }));
  if (SCENARIO.heatingEnabled && hp.preheatHours.length)
    rows.push({ key: "heating", name: "Heat pump", to: hp.preheatHours.slice(0, 2).map(hh).join(", "), saving: hp.saving });
  const total = Math.max(0, plan.totals.usualCost - plan.totals.optimisedCost);
  return (
    <div className="panel flex h-full flex-col p-4 sm:p-5">
      <h2 className="text-base font-semibold">Suggested habit changes</h2>
      <ul className="mt-4 space-y-3">
        {rows.map((r, i) => (
          <li key={r.key} className="lift flex flex-wrap items-center gap-3 rounded-xl bg-surface-raised p-3">
            <span className="bob grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-card text-2xl shadow-sm" style={{ animationDelay: `${i * 0.4}s` }} aria-hidden>
              {appliancePicture(r.name)}
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold">
              {r.name}
              <span className="block text-xs font-normal text-muted-foreground">{r.key === "heating" ? "heats ahead while power is cheap" : r.from ? "move to a cheaper hour" : "already at the best hour"}</span>
            </span>
            <span className="flex items-center gap-2 text-sm">
              {r.from && <span className="metric rounded-lg bg-peak/15 px-2 py-1 text-peak line-through decoration-2">{r.from}</span>}
              {r.from && (
                <span className="nudge text-primary">
                  <Icon name="arrow" size={16} />
                </span>
              )}
              <span className="metric rounded-lg bg-primary/15 px-2 py-1 font-semibold text-primary">{r.to}</span>
            </span>
            <span className="metric rounded-full bg-saving/15 px-2.5 py-1 text-xs font-semibold text-saving">{r.saving >= 0.005 ? `−${money(r.saving)}` : "±0"}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <span className="text-sm">
          Together: <b className="text-saving">−{money(total)} today</b>
        </span>
        <button onClick={() => setPage("costs")} className="flex items-center gap-1.5 text-xs font-semibold text-primary">
          Why these hours
          <Icon name="arrow" size={14} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ solar */

export function SolarGlance({ plan, pvKwp, setPage }: { plan: PlanResponse; pvKwp: number; setPage: (p: PageId) => void }) {
  const s = solarFor(plan, pvKwp);
  if (!s) return null;
  const covered = Math.round(s.demandCoveredPct);
  const R = 42;
  const C = 2 * Math.PI * R;
  const stats: { icon: IconName; label: string; value: string }[] = [
    { icon: "solar", label: "Production", value: `${Math.round(s.annualProductionKwh).toLocaleString("en-GB")} kWh/yr` },
    { icon: "leaf", label: "Net saving", value: `${whole(s.annualSavings)}/yr` },
    { icon: "clock", label: "Payback", value: s.paybackYears ? `${s.paybackYears.toFixed(1)} years` : "—" },
  ];
  return (
    <div className="panel flex h-full flex-col p-4 sm:p-5" style={{ background: "linear-gradient(160deg, color-mix(in srgb, var(--solar) 14%, var(--card)), var(--card) 60%)" }}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Solar panels</h2>
        <span className="metric rounded-md bg-solar/20 px-2 py-0.5 text-xs font-semibold">{s.pvKwp} kWp</span>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <svg viewBox="0 0 110 110" className="h-28 w-28 shrink-0" role="img" aria-label={`Covers ${covered} % of the home's demand`}>
          <circle cx="55" cy="55" r={R} fill="none" stroke="var(--muted)" strokeWidth={10} />
          <circle
            cx="55"
            cy="55"
            r={R}
            fill="none"
            stroke="var(--solar)"
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={`${(covered / 100) * C} ${C}`}
            transform="rotate(-90 55 55)"
            style={{ transition: "stroke-dasharray 0.8s ease" }}
          />
          <g className="spin-slow">
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i * Math.PI) / 4;
              return <line key={i} x1={55 + Math.cos(a) * 15} y1={48 + Math.sin(a) * 15} x2={55 + Math.cos(a) * 19} y2={48 + Math.sin(a) * 19} stroke="var(--solar)" strokeWidth={2.5} strokeLinecap="round" />;
            })}
          </g>
          <circle cx="55" cy="48" r="10" fill="var(--solar)" />
          <text x="55" y="80" textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--foreground)">
            {covered} %
          </text>
        </svg>
        <div className="min-w-0 text-sm">
          <p className="font-medium">of the home's yearly electricity comes from the roof.</p>
          <p className="mt-1 text-xs text-muted-foreground">Investment {whole(s.installCost)}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {stats.map((x) => (
          <div key={x.label} className="flex items-center justify-between rounded-lg bg-card/70 px-3 py-2 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Icon name={x.icon} size={15} className="text-solar" />
              {x.label}
            </span>
            <span className="metric font-semibold">{x.value}</span>
          </div>
        ))}
      </div>
      <button
        onClick={() => setPage("solar")}
        className="lift mt-auto flex items-center justify-center gap-2 rounded-lg bg-solar px-3 py-2 text-xs font-semibold text-[oklch(0.25_0.05_70)]"
        style={{ marginTop: "1rem" }}
      >
        Try other sizes
        <Icon name="arrow" size={14} />
      </button>
    </div>
  );
}
