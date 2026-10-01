import { useState, type PointerEvent } from "react";
import { money, type PlanResponse } from "../data/contract";
import { CountUp } from "./Dashboard";
import { Icon, type IconName } from "./Icon";

/*
 * Cost & plan page visuals:
 *   CostHero — green banner with a glow that follows the pointer, today's bill (usual vs plan), the saving,
 *              and an animated picture: coins dropping into a piggy bank next to the two bills
 */

export function CostHero({ plan }: { plan: PlanResponse }) {
  const [glow, setGlow] = useState({ x: 70, y: 30 });
  const t = plan.totals;
  const saving = Math.max(0, t.usualCost - t.optimisedCost);
  const pct = t.usualCost > 0 ? Math.round((saving / t.usualCost) * 100) : 0;
  const tiles: { icon: IconName; label: string; value: string; sub: string }[] = [
    { icon: "history", label: "Usual habits", value: money(t.usualCost), sub: "nothing moved" },
    { icon: "wallet", label: "With the plan", value: money(t.optimisedCost), sub: "next 24 hours" },
    { icon: "leaf", label: "Saved today", value: money(saving), sub: `${pct} % of the bill` },
    { icon: "target", label: "Over a year", value: `≈ ${money(saving * 365, 0)}`, sub: "if every day saved as much" },
  ];
  const move = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setGlow({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };

  return (
    <section
      onPointerMove={move}
      className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg sm:p-6"
      style={{
        background: `radial-gradient(circle at ${glow.x}% ${glow.y}%, rgba(255,255,255,0.22), transparent 38%), linear-gradient(120deg, #059669 0%, #0d9488 50%, #0891b2 100%)`,
      }}
    >
      <span className="drift pointer-events-none absolute -left-12 -top-16 h-56 w-56 rounded-full bg-lime-200/20 blur-2xl" />
      <span className="drift pointer-events-none absolute -bottom-24 right-10 h-64 w-64 rounded-full bg-sky-300/20 blur-3xl" style={{ animationDelay: "-4s" }} />
      <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/80">Cost & plan · next 24 hours</div>
          <h2 className="mt-1 text-xl font-semibold leading-snug [text-wrap:balance] sm:text-2xl">
            The plan cuts today's bill from {money(t.usualCost)} to <CountUp text={money(t.optimisedCost)} /> — {pct} % less, with the same comfort.
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
                  <CountUp text={x.value} />
                </div>
                <div className="text-[11px] text-white/75">{x.sub}</div>
              </div>
            ))}
          </div>
        </div>
        <SavingsPicture usual={t.usualCost} plan={t.optimisedCost} />
      </div>
    </section>
  );
}

/** Two bills (usual vs plan) that grow, and coins dropping into a piggy bank. */
function SavingsPicture({ usual, plan }: { usual: number; plan: number }) {
  const max = Math.max(usual, plan, 0.01);
  const barH = (v: number) => (v / max) * 120;
  return (
    <svg viewBox="0 0 340 200" className="mx-auto w-full max-w-[340px]" role="img" aria-label={`Bill ${money(usual)} with usual habits, ${money(plan)} with the plan`}>
      {/* bills */}
      {[
        { x: 22, v: usual, label: "usual", fill: "white", opacity: 0.45 },
        { x: 82, v: plan, label: "plan", fill: "#fde047", opacity: 1 },
      ].map((b) => (
        <g key={b.label}>
          <rect className="bar-grow" x={b.x} y={170 - barH(b.v)} width="44" height={barH(b.v)} rx="8" fill={b.fill} opacity={b.opacity} />
          <text x={b.x + 22} y={162 - barH(b.v)} textAnchor="middle" fontSize={13} fontWeight={700} fill="white">
            {money(b.v)}
          </text>
          <text x={b.x + 22} y={188} textAnchor="middle" fontSize={11} fill="white" opacity={0.85}>
            {b.label}
          </text>
        </g>
      ))}
      <path d={`M44 ${160 - barH(usual)} Q70 ${140 - barH(usual)} 100 ${156 - barH(plan)}`} fill="none" stroke="white" strokeWidth={2} strokeDasharray="4 4" className="flow" opacity={0.8} />

      {/* coins dropping */}
      {[0, 1, 2].map((i) => (
        <g key={i} className="coin-drop" style={{ animationDelay: `${i * 0.7}s` }}>
          <circle cx={238 + i * 6} cy="46" r="11" fill="#facc15" stroke="#ca8a04" strokeWidth={2} />
          <text x={238 + i * 6} y="50" textAnchor="middle" fontSize={11} fontWeight={700} fill="#854d0e">
            €
          </text>
        </g>
      ))}

      {/* piggy bank */}
      <g className="bob">
        <ellipse cx="250" cy="130" rx="62" ry="44" fill="#f9a8d4" />
        <ellipse cx="250" cy="122" rx="48" ry="26" fill="#fbcfe8" opacity={0.6} />
        <polygon points="222,96 230,72 244,92" fill="#f472b6" />
        <ellipse cx="310" cy="132" rx="14" ry="12" fill="#f472b6" />
        <circle cx="306" cy="130" r="2.5" fill="#831843" />
        <circle cx="314" cy="130" r="2.5" fill="#831843" />
        <circle cx="284" cy="114" r="4" fill="#831843" />
        <rect x="236" y="88" width="30" height="6" rx="3" fill="#831843" />
        <rect x="212" y="164" width="14" height="20" rx="5" fill="#f472b6" />
        <rect x="270" y="164" width="14" height="20" rx="5" fill="#f472b6" />
        <path d="M188 124 q-12 -4 -8 -14" fill="none" stroke="#f472b6" strokeWidth={4} strokeLinecap="round" />
      </g>
    </svg>
  );
}
