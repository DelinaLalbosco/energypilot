import { useState, type PointerEvent } from "react";
import { SCENARIO, type SolarScenario } from "../data/contract";
import { CountUp } from "./Dashboard";
import { Icon, type IconName } from "./Icon";

/*
 * Solar page visuals:
 *   SolarHero — sun-to-sky banner with a glow that follows the pointer, the system-size slider, the key yearly
 *               numbers and an animated house: panels appear on the roof as the size grows, and the energy
 *               flows split between the house and the grid
 */

const whole = (v: number) => `${v < 0 ? "−" : ""}${SCENARIO.currency}${Math.abs(Math.round(v)).toLocaleString("en")}`;

export function SolarHero({ s, kwp, setKwp }: { s: SolarScenario; kwp: number; setKwp: (k: number) => void }) {
  const cfg = SCENARIO.solar;
  const [glow, setGlow] = useState({ x: 70, y: 30 });
  const has = s.pvKwp > 0;
  const homeKwh = Math.max(0, s.annualProductionKwh - s.exportKwh);
  const homePct = s.annualProductionKwh > 0 ? (homeKwh / s.annualProductionKwh) * 100 : 0;
  const tiles: { icon: IconName; label: string; value: string; sub: string }[] = [
    { icon: "solar", label: "Yearly production", value: has ? `${Math.round(s.annualProductionKwh).toLocaleString("en")} kWh` : "—", sub: "PVGIS, Katowice" },
    { icon: "overview", label: "Home covered", value: has ? `${Math.round(s.demandCoveredPct)} %` : "—", sub: `of ${Math.round(s.annualDemandKwh).toLocaleString("en")} kWh a year` },
    { icon: "leaf", label: "Net saving", value: has ? `${whole(s.annualSavings)}/yr` : "—", sub: has ? `${whole(s.annualSavingsWithShift)}/yr with smart habits` : "" },
    { icon: "clock", label: "Payback", value: s.paybackYears ? `${s.paybackYears.toFixed(1)} yrs` : "—", sub: s.paybackYearsWithShift ? `${s.paybackYearsWithShift.toFixed(1)} yrs with smart habits` : "" },
  ];
  const move = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setGlow({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };
  const step = (d: number) => setKwp(Math.min(cfg.simulatorMax, Math.max(0, +(kwp + d).toFixed(2))));

  return (
    <section
      onPointerMove={move}
      className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg sm:p-6"
      style={{
        background: `radial-gradient(circle at ${glow.x}% ${glow.y}%, rgba(255,255,255,0.24), transparent 38%), linear-gradient(120deg, #d97706 0%, #ea580c 38%, #0284c7 100%)`,
      }}
    >
      <span className="drift pointer-events-none absolute -left-12 -top-16 h-56 w-56 rounded-full bg-yellow-200/25 blur-2xl" />
      <span className="drift pointer-events-none absolute -bottom-24 right-10 h-64 w-64 rounded-full bg-sky-300/25 blur-3xl" style={{ animationDelay: "-4s" }} />
      <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/80">Solar simulator · rooftop panels</div>
          <h2 className="mt-1 text-xl font-semibold leading-snug [text-wrap:balance] sm:text-2xl">
            {has ? (
              <>
                A {s.pvKwp.toFixed(1)} kWp system costs {whole(s.installCost)} and pays for itself in {s.paybackYears ? `${s.paybackYears.toFixed(1)} years` : "more than 20 years"}.
              </>
            ) : (
              "Move the slider to size a solar installation."
            )}
          </h2>

          {/* system size */}
          <div className="mt-4 rounded-xl bg-white/15 p-3 backdrop-blur-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label htmlFor="pv-size" className="text-sm">
                System size <span className="metric ml-1 text-xl font-bold">{s.pvKwp.toFixed(1)} kWp</span>
                <span className="ml-2 text-xs text-white/80">≈ {Math.round(s.pvKwp / 0.42)} panels</span>
              </label>
              <div className="flex gap-1.5">
                {[-cfg.simulatorStep, cfg.simulatorStep].map((d) => (
                  <button
                    key={d}
                    onClick={() => step(d)}
                    className="h-9 w-9 rounded-lg bg-white/20 text-lg font-semibold hover:bg-white/30"
                    aria-label={d > 0 ? "Bigger" : "Smaller"}
                  >
                    {d > 0 ? "+" : "−"}
                  </button>
                ))}
              </div>
            </div>
            <input
              id="pv-size"
              type="range"
              min={0}
              max={cfg.simulatorMax}
              step={cfg.simulatorStep}
              value={s.pvKwp}
              onChange={(e) => setKwp(Number(e.target.value))}
              className="mt-2 w-full cursor-pointer accent-white"
            />
            <div className="metric flex justify-between text-[11px] text-white/75">
              <span>0 kWp</span>
              <span>{cfg.simulatorMax / 2} kWp</span>
              <span>{cfg.simulatorMax} kWp</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {tiles.map((x) => (
              <div key={x.label} className="lift rounded-xl bg-white/15 p-3 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-xs text-white/85">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/20">
                    <Icon name={x.icon} size={15} />
                  </span>
                  {x.label}
                </div>
                <div className="metric mt-2 text-lg font-semibold">
                  <CountUp text={x.value} duration={500} />
                </div>
                <div className="text-[11px] text-white/75">{x.sub}</div>
              </div>
            ))}
          </div>
        </div>
        <SolarHouse kwp={s.pvKwp} homePct={homePct} />
      </div>
    </section>
  );
}

/** House whose roof fills with panels as the system grows; energy flows to the house and to the grid. */
function SolarHouse({ kwp, homePct }: { kwp: number; homePct: number }) {
  const cols = 6;
  const rows = 3;
  const shown = kwp > 0 ? Math.max(1, Math.round((kwp / SCENARIO.solar.simulatorMax) * cols * rows)) : 0;
  const exportPct = kwp > 0 ? 100 - homePct : 0;
  // roof: a parallelogram from (150,108)-(300,108) at the eaves up to (180,54)-(330,54)
  const panel = (i: number) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x0 = 158 + c * 24 + (rows - 1 - r) * 9;
    const y0 = 60 + r * 16;
    return `${x0},${y0 + 14} ${x0 + 20},${y0 + 14} ${x0 + 26},${y0} ${x0 + 6},${y0}`;
  };
  return (
    <svg viewBox="0 0 380 230" className="mx-auto w-full max-w-[380px]" role="img" aria-label={`${kwp} kWp of panels; ${Math.round(homePct)} % used at home`}>
      {/* sun */}
      <g className="spin-slow">
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return <line key={i} x1={60 + Math.cos(a) * 28} y1={44 + Math.sin(a) * 28} x2={60 + Math.cos(a) * 38} y2={44 + Math.sin(a) * 38} stroke="#fde68a" strokeWidth={4} strokeLinecap="round" />;
        })}
      </g>
      <circle cx="60" cy="44" r="21" fill="#fcd34d" />
      {kwp > 0 && <path d="M84 56 Q130 40 176 70" fill="none" stroke="#fde68a" strokeWidth={3} className="flow" strokeLinecap="round" />}
      {/* ground */}
      <rect x="0" y="210" width="380" height="20" rx="4" fill="white" opacity={0.2} />
      {/* house */}
      <polygon points="140,112 180,50 340,50 310,112" fill="#1e293b" opacity={0.8} />
      {Array.from({ length: cols * rows }, (_, i) => (
        <polygon
          key={i}
          points={panel(i)}
          fill="#38bdf8"
          stroke="#e0f2fe"
          strokeWidth={1}
          opacity={i < shown ? 1 : 0.08}
          style={{ transition: "opacity 0.35s ease", transitionDelay: `${(i % cols) * 25}ms` }}
        />
      ))}
      <rect x="150" y="112" width="150" height="98" rx="3" fill="white" />
      <rect x="208" y="160" width="30" height="50" rx="2" fill="#0284c7" opacity={0.85} />
      <rect x="166" y="128" width="28" height="22" rx="2" fill="#fbbf24" className="glow" />
      <rect x="254" y="128" width="28" height="22" rx="2" fill="#fbbf24" className="glow" style={{ animationDelay: "1.2s" }} />
      {/* pylon (grid) */}
      <g stroke="white" strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.9}>
        <path d="M350 210 L360 120 L370 210" />
        <path d="M353 180 L367 180 M356 150 L364 150 M344 128 L376 128" />
      </g>
      {/* flows: to the house and to the grid, thickness = share */}
      {kwp > 0 && (
        <>
          <path d="M226 96 L226 124" stroke="#86efac" strokeWidth={2 + homePct / 9} className="flow" strokeLinecap="round" />
          <path d="M318 70 Q348 78 360 124" fill="none" stroke="#bae6fd" strokeWidth={2 + exportPct / 9} className="flow" strokeLinecap="round" />
          <g fontSize={12} fontWeight={700} fill="white">
            <text x="120" y="190" textAnchor="middle">
              {Math.round(homePct)} % home
            </text>
            <text x="352" y="104" textAnchor="middle">
              {Math.round(exportPct)} % grid
            </text>
          </g>
        </>
      )}
      <circle cx="120" cy="166" r="11" fill="#22c55e" className="bob" />
      <path d="M122 158 L115 168 L120 168 L118 175 L125 165 L120 165 Z" fill="white" className="bob" />
    </svg>
  );
}
