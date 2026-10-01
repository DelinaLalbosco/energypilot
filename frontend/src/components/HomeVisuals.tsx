import { useState, type PointerEvent, type ReactNode } from "react";
import { APPLIANCES, ROOMS, hh, type PlanResponse, type RoomId } from "../data/contract";
import { CountUp } from "./Dashboard";
import { Icon, type IconName } from "./Icon";
import { appliancePicture, roomPicture } from "./pictures";

/*
 * Appliances and 3D house page visuals:
 *   AppliancesHero — violet banner: the day's appliance numbers and the biggest users as bubbles
 *                    (size = energy); click a bubble to show only its room in the table below
 *   TwinHero       — indigo banner for the 3D house: hour slider and one tile per room (energy in that hour);
 *                    click a room to highlight it in the 3D house
 */

function Banner({ gradient, children }: { gradient: string; children: ReactNode }) {
  const [glow, setGlow] = useState({ x: 70, y: 30 });
  const move = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setGlow({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };
  return (
    <section
      onPointerMove={move}
      className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg sm:p-6"
      style={{ background: `radial-gradient(circle at ${glow.x}% ${glow.y}%, rgba(255,255,255,0.22), transparent 38%), ${gradient}` }}
    >
      <span className="drift pointer-events-none absolute -left-12 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
      <span className="drift pointer-events-none absolute -bottom-24 right-10 h-64 w-64 rounded-full bg-fuchsia-300/20 blur-3xl" style={{ animationDelay: "-4s" }} />
      <div className="relative">{children}</div>
    </section>
  );
}

function GlassTiles({ tiles }: { tiles: { icon: IconName; label: string; value: string; sub: string }[] }) {
  return (
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
  );
}

/* ------------------------------------------------------------------ appliances */

export function AppliancesHero({ plan, selected, setSelected }: { plan: PlanResponse; selected: RoomId | null; setSelected: (r: RoomId | null) => void }) {
  const daily = APPLIANCES.map((a) => ({ ...a, kwh: plan.hours.reduce((s, h) => s + h.forecastByAppliance[a.id], 0) })).sort((x, y) => y.kwh - x.kwh);
  const total = daily.reduce((s, a) => s + a.kwh, 0) || 1;
  const top = daily[0];
  const flexible = daily.filter((a) => a.flexible);
  const alwaysOn = daily.filter((a) => a.alwaysOn).reduce((s, a) => s + a.kwh, 0);
  const tiles: { icon: IconName; label: string; value: string; sub: string }[] = [
    { icon: "appliances", label: "Appliances", value: `${daily.length}`, sub: `in ${ROOMS.length} rooms` },
    { icon: "bolt", label: "Biggest user", value: `${Math.round((top.kwh / total) * 100)} %`, sub: top.name },
    { icon: "clock", label: "Can be moved", value: `${flexible.length}`, sub: flexible.map((a) => a.name.toLowerCase()).join(", ") },
    { icon: "leaf", label: "Always on", value: `${alwaysOn.toFixed(1)} kWh`, sub: "per day (fridge, router, standby)" },
  ];
  return (
    <Banner gradient="linear-gradient(120deg, #7c3aed 0%, #c026d3 50%, #4f46e5 100%)">
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/80">Appliances · next 24 hours</div>
          <h2 className="mt-1 text-xl font-semibold leading-snug [text-wrap:balance] sm:text-2xl">
            {top.name} uses the most energy today — <CountUp text={`${top.kwh.toFixed(1)} kWh`} /> of {total.toFixed(1)} kWh.
          </h2>
          <GlassTiles tiles={tiles} />
        </div>
        <Bubbles items={daily.slice(0, 6)} total={total} selected={selected} setSelected={setSelected} />
      </div>
    </Banner>
  );
}

/** The biggest users as floating bubbles (area ≈ energy); click one to filter the table by its room. */
function Bubbles({
  items,
  total,
  selected,
  setSelected,
}: {
  items: { id: string; name: string; room: RoomId; color: string; kwh: number }[];
  total: number;
  selected: RoomId | null;
  setSelected: (r: RoomId | null) => void;
}) {
  // positions chosen so the bubbles never overlap or leave the picture (max radius 54)
  const spots = [
    [105, 118],
    [235, 80],
    [300, 178],
    [202, 198],
    [58, 208],
    [322, 58],
  ];
  const max = items[0]?.kwh || 1;
  return (
    <div>
      <svg viewBox="0 0 360 250" className="mx-auto w-full max-w-[360px]" role="img" aria-label="Biggest energy users">
        {items.map((a, i) => {
          const [cx, cy] = spots[i];
          const r = 18 + Math.sqrt(a.kwh / max) * 36;
          const dim = selected && selected !== a.room;
          return (
            <g
              key={a.id}
              className="bob cursor-pointer"
              style={{ animationDelay: `${i * 0.35}s`, opacity: dim ? 0.45 : 1, transition: "opacity 0.3s" }}
              onClick={() => setSelected(selected === a.room ? null : a.room)}
            >
              <title>{`${a.name}: ${a.kwh.toFixed(2)} kWh (${Math.round((a.kwh / total) * 100)} %) — click to show its room`}</title>
              <circle cx={cx} cy={cy} r={r} fill={a.color} opacity={0.9} stroke="white" strokeWidth={selected === a.room ? 4 : 2} />
              <text x={cx} y={cy + (r > 40 ? -2 : 5)} textAnchor="middle" fontSize={r > 40 ? 26 : 17}>
                {appliancePicture(a.name)}
              </text>
              {r > 40 && (
                <text x={cx} y={cy + 20} textAnchor="middle" fontSize={12} fontWeight={700} fill="white">
                  {Math.round((a.kwh / total) * 100)} %
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="text-center text-[11px] text-white/80">Bubble size = energy today · click a bubble to show its room</p>
    </div>
  );
}

/* ------------------------------------------------------------------ 3D house */

export function TwinHero({
  plan,
  now,
  setNow,
  selected,
  setSelected,
}: {
  plan: PlanResponse;
  now: number;
  setNow: (h: number) => void;
  selected: RoomId | null;
  setSelected: (r: RoomId | null) => void;
}) {
  const hour = plan.hours.find((h) => h.hour === now) ?? plan.hours[0];
  const rooms = ROOMS.map((r) => ({ ...r, kwh: hour.roomLoad[r.id] ?? 0 }));
  const total = rooms.reduce((s, r) => s + r.kwh, 0) || 1;
  const busiest = rooms.reduce((m, r) => (r.kwh > m.kwh ? r : m), rooms[0]);
  const colors = ["#f59e0b", "#ec4899", "#22c55e", "#38bdf8", "#f97316"];
  return (
    <Banner gradient="linear-gradient(120deg, #4f46e5 0%, #7c3aed 50%, #0ea5e9 100%)">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/80">Digital twin · energy by room</div>
          <h2 className="mt-1 text-xl font-semibold leading-snug [text-wrap:balance] sm:text-2xl">
            At {hh(now)} the house uses <CountUp key={now} text={`${hour.optimisedLoad.toFixed(2)} kWh`} duration={400} /> — most in the {busiest.label.split(" ·")[0].toLowerCase()}.
          </h2>
        </div>
        <label className="flex w-full max-w-sm items-center gap-3 rounded-xl bg-white/15 px-3 py-2 text-sm backdrop-blur-sm">
          <span className="metric w-12 font-semibold">{hh(now)}</span>
          <input type="range" min={0} max={23} value={now} onChange={(e) => setNow(Number(e.target.value))} className="flex-1 cursor-pointer accent-white" aria-label="Hour of day" />
          <span className="text-xs text-white/80">{hour.outdoorTemp.toFixed(0)} °C</span>
        </label>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {rooms.map((r, i) => {
          const on = selected === r.id;
          return (
            <button
              key={r.id}
              onClick={() => setSelected(on ? null : r.id)}
              aria-pressed={on}
              className={`lift rounded-xl p-3 text-left backdrop-blur-sm ${on ? "bg-white text-slate-900" : "bg-white/15"}`}
            >
              <div className="flex items-center gap-2">
                <span className="bob text-2xl" style={{ animationDelay: `${i * 0.3}s` }} aria-hidden>
                  {roomPicture(r.label)}
                </span>
                <span className="text-xs font-semibold leading-tight">{r.label}</span>
              </div>
              <div className="metric mt-2 text-lg font-semibold">{r.kwh.toFixed(2)} kWh</div>
              <div className={`mt-1 h-1.5 overflow-hidden rounded-full ${on ? "bg-slate-200" : "bg-white/20"}`}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(r.kwh / total) * 100}%`, background: colors[i % colors.length] }} />
              </div>
              <div className={`mt-1 text-[11px] ${on ? "text-slate-500" : "text-white/75"}`}>{Math.round((r.kwh / total) * 100)} % of this hour</div>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-white/80">Click a room to highlight it in the 3D house · move the slider to change the hour</p>
    </Banner>
  );
}
