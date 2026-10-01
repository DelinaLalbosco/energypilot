import { useEffect, useMemo, useState } from "react";
import { APPLIANCES, SCENARIO, hh, money, type HourPlan, type PlanResponse, type Presence } from "../data/contract";
import { Info } from "./Info";

/*
 * Features that make the plan understandable at a glance:
 *   NowLight       — traffic light "Is now a good time?" + Read my day
 *   WeekCalendar   — best times this week (7 × 24 grid)
 *   ComfortSlider  — choose warmth vs cost; each stop is a real optimised plan
 *   WhatIf         — interactive planner: family trip / guests / cold snap (days, guests, degrees)
 *   Equivalents    — the numbers in everyday terms
 *   WhoIsHome      — who is expected home / asleep / away each hour (family calendar)
 */

type Light = "green" | "yellow" | "red";

const LIGHT: Record<Light, { color: string; title: string }> = {
  green: { color: "var(--saving)", title: "Good time to use energy" },
  yellow: { color: "var(--solar)", title: "Okay — use what you need" },
  red: { color: "var(--peak)", title: "Avoid extra energy now" },
};

function lightFor(h: HourPlan, prices: number[]): Light {
  const sorted = [...prices].sort((a, b) => a - b);
  const cheap = sorted[Math.floor(sorted.length / 3)];
  const max = sorted[sorted.length - 1];
  if (h.action === "avoid" || h.isPeak || h.price === max) return "red";
  if (h.action === "run" || h.action === "preheat" || h.action === "solar" || h.price <= cheap) return "green";
  return "yellow";
}

/** Plain-language sentence for the current hour and the next change. */
function nowSentence(plan: PlanResponse, now: number): { text: string; next?: string } {
  const hours = plan.hours;
  const prices = hours.map((h) => h.price);
  const i = hours.findIndex((h) => h.hour === now);
  const h = hours[i];
  const light = lightFor(h, prices);
  const later = [...hours.slice(i + 1), ...hours.slice(0, i)];
  const nextGreen = later.find((x) => lightFor(x, prices) === "green");
  const endOfRun = later.find((x) => lightFor(x, prices) !== light);
  const flexible = APPLIANCES.filter((a) => a.flexible).map((a) => a.name.toLowerCase());

  if (h.scheduled.length) {
    const names = h.scheduled.map((id) => APPLIANCES.find((a) => a.id === id)?.name.toLowerCase() ?? id).join(" and ");
    return { text: `Start the ${names} now — this is the cheapest time for it today.` };
  }
  if (light === "red") {
    return {
      text: `Electricity costs ${money(h.price)}/kWh now${endOfRun ? ` until ${hh(endOfRun.hour)}` : ""}. Wait before using extra appliances.`,
      next: nextGreen ? `Next good time: ${hh(nextGreen.hour)}` : undefined,
    };
  }
  if (light === "green") {
    return {
      text: `Cheap power${endOfRun ? ` until ${hh(endOfRun.hour)}` : ""} (${money(h.price)}/kWh)${flexible.length ? ` — a good time for the ${flexible.join(" or ")}` : ""}.`,
    };
  }
  return {
    text: `Normal price (${money(h.price)}/kWh). Use what you need, but save big jobs for a cheaper hour.`,
    next: nextGreen ? `Next good time: ${hh(nextGreen.hour)}` : undefined,
  };
}

function readMyDayText(plan: PlanResponse, now: number) {
  const s = nowSentence(plan, now);
  const t = plan.totals;
  const day1 = plan.horizon?.periods.find((p) => p.days === 1);
  const upcoming = plan.hours.filter((h) => h.hour >= now && h.planNote !== "As usual").slice(0, 3);
  const parts = [
    `Good day, ${SCENARIO.household.name}.`,
    `It is ${hh(now)}. ${
      LIGHT[
        lightFor(
          plan.hours.find((h) => h.hour === now)!,
          plan.hours.map((h) => h.price),
        )
      ].title
    }.`,
    s.text,
    s.next ? `${s.next}.` : "",
    `Today you will use about ${Math.round(day1?.forecastKwh ?? t.forecastKwh)} kilowatt hours.`,
    `The busiest hours are ${plan.peakHours.map((h) => hh(h)).join(", ")}.`,
    upcoming.length ? `Coming up: ${upcoming.map((h) => `at ${hh(h.hour)}, ${h.planNote}`).join(". ")}.` : "",
    `Following the plan saves about ${money(Math.max(0, t.usualCost - t.optimisedCost))} today, and the house stays comfortable.`,
  ];
  return parts.filter(Boolean).join(" ").replace(/→/g, "to").replace(/·/g, ",");
}

export function NowLight({ plan, now, setNow }: { plan: PlanResponse; now: number; setNow: (h: number) => void }) {
  const h = plan.hours.find((x) => x.hour === now) ?? plan.hours[0];
  const light = lightFor(
    h,
    plan.hours.map((x) => x.price),
  );
  const sentence = nowSentence(plan, now);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  const [speaking, setSpeaking] = useState(false);

  useEffect(
    () => () => {
      if (canSpeak) window.speechSynthesis.cancel();
    },
    [canSpeak],
  );

  const toggleSpeech = () => {
    if (!canSpeak) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(readMyDayText(plan, now));
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  };

  return (
    <div
      className="panel relative overflow-hidden p-4 pl-5"
      style={{ background: `linear-gradient(110deg, color-mix(in srgb, ${LIGHT[light].color} 16%, var(--card)), var(--card) 70%)` }}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: LIGHT[light].color }} />
      <div className="flex flex-wrap items-center gap-4">
        {/* the traffic light */}
        <div className="flex flex-col gap-1.5 rounded-xl bg-[oklch(0.3_0.02_260)] p-1.5" aria-hidden>
          {(["red", "yellow", "green"] as Light[]).map((l) => (
            <span
              key={l}
              className="block h-5 w-5 rounded-full transition-all duration-500"
              style={{
                background: LIGHT[l].color,
                opacity: l === light ? 1 : 0.18,
              }}
            />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="label-caps">Right now · {hh(now)}</div>
          <div className="text-lg font-semibold" style={{ color: LIGHT[light].color }}>
            {LIGHT[light].title}
          </div>
          <p className="mt-0.5 text-sm">{sentence.text}</p>
          {sentence.next && <p className="mt-0.5 text-xs text-muted-foreground">{sentence.next}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          {canSpeak && (
            <button
              onClick={toggleSpeech}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
              aria-pressed={speaking}
            >
              {speaking ? "⏹ Stop" : "🔊 Read my day"}
            </button>
          )}
          <button
            onClick={() => setNow(new Date().getHours())}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Use current time
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function WeekCalendar({ plan, now, setNow }: { plan: PlanResponse; now: number; setNow: (h: number) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const priceAt = useMemo(() => new Map(plan.hours.map((h) => [h.hour, h.price])), [plan.hours]);
  const source = plan.horizon?.hours.length ? plan.horizon.hours : plan.hours.map((h) => ({ timestamp: h.timestamp, hour: h.hour, forecast: h.forecastLoad }));

  const days = useMemo(() => {
    const byDate = new Map<string, { hour: number; forecast: number; price: number; ts: string }[]>();
    for (const h of source) {
      const d = h.timestamp.slice(0, 10);
      byDate.set(d, [...(byDate.get(d) ?? []), { hour: h.hour, forecast: h.forecast, price: priceAt.get(h.hour) ?? 0, ts: h.timestamp }]);
    }
    return [...byDate.entries()];
  }, [source, priceAt]);

  // "Stress" = 60 % price + 40 % expected demand, both scaled 0–1 → green (cheap & calm) to red.
  const all = days.flatMap(([, hs]) => hs);
  const pMin = Math.min(...all.map((x) => x.price));
  const pMax = Math.max(...all.map((x) => x.price));
  const fMin = Math.min(...all.map((x) => x.forecast));
  const fMax = Math.max(...all.map((x) => x.forecast));
  const stress = (x: { price: number; forecast: number }) =>
    0.6 * ((x.price - pMin) / Math.max(1e-6, pMax - pMin)) + 0.4 * ((x.forecast - fMin) / Math.max(1e-6, fMax - fMin));
  const color = (v: number) =>
    v < 0.5
      ? `color-mix(in oklch, var(--saving) ${Math.round((1 - v * 2) * 100)}%, var(--solar))`
      : `color-mix(in oklch, var(--peak) ${Math.round((v - 0.5) * 200)}%, var(--solar))`;
  const label = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
  const hovered = hover ? all.find((x) => x.ts === hover) : null;

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            Best times this week
            <Info term="tariff" label="price" />
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Like a weather map for electricity: green is cheap and calm, red is expensive and busy. ★ = best time each day.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>Best</span>
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <i key={v} className="h-3 w-4 rounded-sm" style={{ background: color(v) }} />
          ))}
          <span>Avoid</span>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <div className="space-y-1 sm:min-w-[30rem]">
          <div className="grid grid-cols-[2.2rem_repeat(24,minmax(0,1fr))] gap-px text-center text-[11px] text-muted-foreground sm:grid-cols-[3.2rem_repeat(24,minmax(0,1fr))] sm:gap-[3px] sm:text-[11px]">
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="metric">
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </span>
            ))}
          </div>
          {days.map(([d, hs], di) => {
            const best = hs.reduce((a, b) => (stress(b) < stress(a) ? b : a));
            return (
              <div key={d} className="grid grid-cols-[2.2rem_repeat(24,minmax(0,1fr))] items-center gap-px sm:grid-cols-[3.2rem_repeat(24,minmax(0,1fr))] sm:gap-[3px]">
                <span className="text-[11px] font-medium">{label(d)}</span>
                {hs.map((x) => (
                  <button
                    key={x.ts}
                    onMouseEnter={() => setHover(x.ts)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => di === 0 && setNow(x.hour)}
                    title={`${label(d)} ${hh(x.hour)} · ${x.forecast.toFixed(2)} kWh · ${money(x.price)}/kWh`}
                    className={`grid aspect-square place-items-center rounded-[4px] text-[11px] leading-none text-white transition-transform hover:scale-125 ${
                      di === 0 && x.hour === now ? "ring-2 ring-foreground ring-offset-1 ring-offset-card" : ""
                    }`}
                    style={{ background: color(stress(x)), animationDelay: `${di * 40 + x.hour * 8}ms` }}
                  >
                    {x.ts === best.ts ? "★" : ""}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-2 min-h-4 text-xs text-muted-foreground">
        {hovered
          ? `${label(hovered.ts.slice(0, 10))} ${hh(hovered.hour)} — ${hovered.forecast.toFixed(2)} kWh expected at ${money(hovered.price)}/kWh.`
          : "Hover a square for details; click a square in the first row to select that hour."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function ComfortSlider({ plan, comfort, setComfort }: { plan: PlanResponse; comfort: string; setComfort: (id: string) => void }) {
  const options = plan.comfortOptions;
  if (options.length <= 1) return null;
  const index = Math.max(
    0,
    options.findIndex((o) => o.id === comfort),
  );
  const current = options[index];
  const maxSaving = Math.max(...options.map((o) => o.saving), 0.01);

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            Comfort level
            <Info term="comfort" label="comfort" />
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Indoor temperature range the heat pump must keep. A wider range allows more pre-heating before the 17:00–22:00 peak and lowers the cost. Each level
            has its own optimised plan.
          </p>
        </div>
        <div className="text-right">
          <div className="metric text-xl font-semibold text-saving">−{money(current.saving)}</div>
          <div className="text-[11px] text-muted-foreground">saved today ({current.savingPct} %)</div>
        </div>
      </div>

      <div className="mt-4 px-1">
        <input
          id="comfort-slider"
          type="range"
          min={0}
          max={options.length - 1}
          step={1}
          value={index}
          onChange={(e) => setComfort(options[Number(e.target.value)].id)}
          className="w-full cursor-pointer accent-primary"
          aria-label="Comfort level"
          style={{ accentColor: "var(--primary)" }}
        />
        <div className="mt-1 grid text-[11px]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
          {options.map((o, i) => (
            <button
              key={o.id}
              onClick={() => setComfort(o.id)}
              className={`text-center transition-colors ${i === index ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {i === 0 ? "🔥 " : i === options.length - 1 ? "💰 " : ""}
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="rounded-md border border-border bg-surface-raised px-3 py-2 text-xs">
          <div className="font-medium">
            {current.label}: {current.band}
          </div>
          <div className="mt-0.5 text-muted-foreground">
            Today's cost: {money(current.cost)} (usual habits: {money(current.cost + current.saving)}).
          </div>
        </div>
        <div className="rounded-md border border-border bg-surface-raised px-3 py-2" aria-hidden>
          <div className="mb-1 text-[11px] text-muted-foreground">Saving per level</div>
          <div className="flex items-end gap-1.5">
            {options.map((o, i) => (
              <div key={o.id} className="flex flex-col items-center gap-0.5">
                <div
                  className="w-5 rounded-t transition-all duration-500"
                  style={{ height: `${8 + (o.saving / maxSaving) * 32}px`, background: i === index ? "var(--saving)" : "var(--muted)" }}
                />
                <span className="metric text-[11px] text-muted-foreground">{money(o.saving, 2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

type WhatIfId = "trip" | "visit" | "cold";

const WHAT_IF: { id: WhatIfId; label: string; icon: string; question: string }[] = [
  { id: "trip", label: "Family trip", icon: "🧳", question: "What if the whole family goes away?" },
  { id: "visit", label: "Guests visit", icon: "👵", question: "What if grandparents or friends stay with us?" },
  { id: "cold", label: "Cold snap", icon: "❄️", question: "What if it gets colder than forecast?" },
];

const TIPS: Record<WhatIfId, string> = {
  trip: "Before leaving: set the heat pump to away mode (about 16–17 °C) and switch off standby devices. The fridge and Wi-Fi router keep running.",
  visit:
    "More people means more cooking, washing and showers: run the dishwasher and washing machine at night (€0.18/kWh) and cook before 17:00 when possible.",
  cold: "The plan already pre-heats before the 17:00–22:00 peak. Keep doors closed and let the heat pump run steadily instead of turning it up and down.",
};

/** Interactive what-if planner over the forecast week. */
export function WhatIf({ plan }: { plan: PlanResponse; days?: number }) {
  const [choice, setChoice] = useState<WhatIfId>("trip");
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(2);
  const [amount, setAmount] = useState(2); // guests for "visit", degrees for "cold"
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const heatId = SCENARIO.heatingAppliance;
  const alwaysOn = new Set(APPLIANCES.filter((a) => a.alwaysOn).map((a) => a.id));
  const priceAt = new Map(plan.hours.map((h) => [h.hour, h.price]));
  const hours = plan.horizon?.hours ?? [];
  const dayKeys = [...new Set(hours.map((h) => h.timestamp.slice(0, 10)))];
  if (!hours.length) return null;

  const dayName = (d: string, long = false) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: long ? "long" : "short" });
  const len = Math.min(length, dayKeys.length - start);
  const affected = new Set(dayKeys.slice(start, start + len));

  const adjust = (id: string, v: number, h: (typeof hours)[number]) => {
    if (!affected.has(h.timestamp.slice(0, 10))) return v;
    if (choice === "trip") return id === heatId ? v * 0.6 : alwaysOn.has(id) ? v : v * 0.08;
    if (choice === "visit") return id === heatId ? v * (1 + 0.02 * amount) : alwaysOn.has(id) ? v : v * (1 + 0.2 * amount);
    // cold: extra heating from the house's heat loss while heating is needed
    return id === heatId && h.outdoorTemp - amount < 15 ? v + SCENARIO.heatLossPerC * amount : v;
  };
  const perDay = dayKeys.map((d) => {
    const hs = hours.filter((h) => h.timestamp.startsWith(d));
    let base = 0;
    let alt = 0;
    let baseCost = 0;
    let altCost = 0;
    for (const h of hs) {
      const ids = Object.keys(h.byAppliance);
      const b = ids.reduce((sum, id) => sum + h.byAppliance[id], 0);
      const x = ids.reduce((sum, id) => sum + adjust(id, h.byAppliance[id], h), 0);
      const p = priceAt.get(h.hour) ?? 0;
      base += b;
      alt += x;
      baseCost += b * p;
      altCost += x * p;
    }
    return { d, base, alt, baseCost, altCost, hit: affected.has(d) };
  });
  const sum = (k: "base" | "alt" | "baseCost" | "altCost") => perDay.reduce((s, x) => s + x[k], 0);
  const dKwh = sum("alt") - sum("base");
  const dCost = sum("altCost") - sum("baseCost");
  const maxDay = Math.max(...perDay.map((x) => Math.max(x.base, x.alt)), 1);
  const first = dayName(dayKeys[start], true);
  const span = len === 1 ? `on ${first}` : `for ${len} days from ${first}`;
  const sentence =
    choice === "trip"
      ? `If the family is away ${span}, the house uses ${Math.abs(dKwh).toFixed(0)} kWh less and you save ${money(Math.abs(dCost))}.`
      : choice === "visit"
        ? `With ${amount} guest${amount > 1 ? "s" : ""} ${span}, the house uses ${dKwh.toFixed(0)} kWh more — about ${money(dCost)} extra.`
        : `If it is ${amount} °C colder ${span}, the heat pump needs ${dKwh.toFixed(0)} kWh more — about ${money(dCost)} extra.`;
  const option = WHAT_IF.find((w) => w.id === choice)!;
  const dayDetail = perDay.find((x) => x.d === pickedDay);

  return (
    <div className="panel p-4">
      <h2 className="text-base font-semibold">What if…?</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Pick a situation and adjust it — the forecast for the coming week updates instantly.</p>

      {/* 1. choose a situation */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {WHAT_IF.filter((w) => w.id !== "cold" || heatId).map((w, i) => {
          const color = ["#2563eb", "#f59e0b", "#0891b2"][i % 3];
          const on = choice === w.id;
          return (
            <button
              key={w.id}
              onClick={() => {
                setChoice(w.id);
                setAmount(w.id === "cold" ? 5 : 2);
              }}
              className="lift rounded-xl border-2 px-2 py-3 text-center"
              style={{
                borderColor: on ? color : `color-mix(in srgb, ${color} 25%, var(--border))`,
                background: `color-mix(in srgb, ${color} ${on ? 16 : 6}%, var(--card))`,
              }}
            >
              <div className={`text-3xl ${on ? "bob" : ""}`} aria-hidden>
                {w.icon}
              </div>
              <div className="mt-1 text-xs font-semibold" style={on ? { color } : undefined}>
                {w.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* 2. adjust it */}
      <div className="mt-3 space-y-3 rounded-lg border border-border bg-surface-raised p-3 text-xs">
        <div className="font-medium">{option.question}</div>
        <div>
          <div className="mb-1 text-muted-foreground">From</div>
          <div className="flex flex-wrap gap-1">
            {dayKeys.map((d, i) => (
              <button
                key={d}
                onClick={() => setStart(i)}
                className={`rounded-full border px-2.5 py-1 transition-all ${
                  affected.has(d) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary"
                }`}
              >
                {dayName(d)}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="flex justify-between text-muted-foreground">
            <span>How many days</span>
            <b className="text-foreground">
              {len} day{len > 1 ? "s" : ""}
            </b>
          </span>
          <input
            type="range"
            min={1}
            max={dayKeys.length - start}
            value={len}
            onChange={(e) => setLength(Number(e.target.value))}
            className="mt-1 w-full accent-[var(--primary)]"
          />
        </label>
        {choice !== "trip" && (
          <label className="block">
            <span className="flex justify-between text-muted-foreground">
              <span>{choice === "visit" ? "Number of guests" : "How much colder"}</span>
              <b className="text-foreground">{choice === "visit" ? `${amount} guest${amount > 1 ? "s" : ""}` : `−${amount} °C`}</b>
            </span>
            <input
              type="range"
              min={1}
              max={choice === "visit" ? 4 : 10}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="mt-1 w-full accent-[var(--primary)]"
            />
          </label>
        )}
      </div>

      {/* 3. the answer */}
      <div key={`${choice}-${start}-${len}-${amount}`} className="animate-fade-up mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
        <p className="text-sm font-medium">{sentence}</p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
          <div className="rounded-md bg-card px-2 py-2">
            <div className="label-caps">Energy this week</div>
            <div className="metric mt-0.5 text-base">
              {sum("base").toFixed(0)} → <b>{sum("alt").toFixed(0)}</b> kWh
            </div>
            <div className={dKwh < 0 ? "text-saving" : "text-peak"}>
              {dKwh >= 0 ? "+" : "−"}
              {Math.abs(dKwh).toFixed(0)} kWh ({Math.abs((dKwh / sum("base")) * 100).toFixed(0)} %)
            </div>
          </div>
          <div className="rounded-md bg-card px-2 py-2">
            <div className="label-caps">Cost this week</div>
            <div className="metric mt-0.5 text-base">
              {money(sum("baseCost"), 0)} → <b>{money(sum("altCost"), 0)}</b>
            </div>
            <div className={dCost < 0 ? "text-saving" : "text-peak"}>
              {dCost >= 0 ? "+" : "−"}
              {money(Math.abs(dCost))}
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">💡 {TIPS[choice]}</p>
      </div>

      {/* 4. day by day */}
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
          <span>Day by day — tap a day</span>
          <span>
            <span className="mr-2">▮ normal</span>
            <span className="text-primary">▮ {option.label.toLowerCase()}</span>
          </span>
        </div>
        <div className="flex h-28 items-end gap-1.5">
          {perDay.map((x) => (
            <button
              key={x.d}
              onClick={() => setPickedDay((p) => (p === x.d ? null : x.d))}
              className={`flex flex-1 flex-col items-center gap-1 rounded-md pt-1 transition-colors ${pickedDay === x.d ? "bg-primary/10" : "hover:bg-accent/30"}`}
            >
              <div className="flex h-20 w-full items-end justify-center gap-0.5">
                <div className="w-1/3 rounded-t bg-muted-foreground/35 transition-all duration-500" style={{ height: `${(x.base / maxDay) * 100}%` }} />
                <div
                  className={`w-1/3 rounded-t transition-all duration-500 ${x.hit ? "bg-primary" : "bg-primary/30"}`}
                  style={{ height: `${(x.alt / maxDay) * 100}%` }}
                />
              </div>
              <span className={`text-[11px] ${x.hit ? "font-semibold text-primary" : "text-muted-foreground"}`}>{dayName(x.d)}</span>
            </button>
          ))}
        </div>
        {dayDetail && (
          <p className="animate-fade-up mt-1 text-xs">
            <b>{dayName(dayDetail.d, true)}:</b> {dayDetail.base.toFixed(1)} kWh ({money(dayDetail.baseCost)}) normally
            {dayDetail.hit
              ? ` → ${dayDetail.alt.toFixed(1)} kWh (${money(dayDetail.altCost)}) ${choice === "trip" ? "while away" : choice === "visit" ? "with guests" : "in the cold"}`
              : " — not affected"}
            .
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function Equivalents({ plan, pvKwp }: { plan: PlanResponse; pvKwp: number }) {
  const priceAt = new Map(plan.hours.map((h) => [h.hour, h.price]));
  const week = plan.horizon?.periods.find((p) => p.days === 7);
  const weekHours = plan.horizon?.hours.slice(0, 168) ?? [];
  const weekBill = weekHours.length ? weekHours.reduce((s, h) => s + h.forecast * (priceAt.get(h.hour) ?? 0), 0) : plan.totals.usualCost * 7;
  const daySaving = Math.max(0, plan.totals.usualCost - plan.totals.optimisedCost);
  const todayKwh = plan.horizon?.periods.find((p) => p.days === 1)?.forecastKwh ?? plan.totals.forecastKwh;
  const solar = plan.solarScenarios.find((s) => s.pvKwp === pvKwp);
  const co2 = (solar?.annualProductionKwh ?? 0) * SCENARIO.co2KgPerKwh;

  const cards = [
    {
      icon: "🧾",
      value: money(weekBill, 0),
      label: "expected bill this week",
      sub: week ? `${week.forecastKwh.toFixed(0)} kWh over 7 days` : "estimate from today",
    },
    { icon: "💚", value: money(daySaving * 7, 2), label: "saved per week with the plan", sub: `${money(daySaving)} a day, same comfort` },
    {
      icon: "📱",
      value: Math.round(todayKwh / 0.012).toLocaleString("en"),
      label: "phone charges = today's energy",
      sub: `or ${Math.round(todayKwh / 0.17)} km in an electric car`,
    },
    solar && pvKwp > 0
      ? {
          icon: "🌳",
          value: `${Math.round(co2 / 21)} trees`,
          label: `CO₂ absorbed = ${pvKwp} kWp solar`,
          sub: `${Math.round(co2).toLocaleString("en")} kg CO₂ avoided per year`,
        }
      : { icon: "☀️", value: "Add solar", label: "to cut CO₂ and bills", sub: "see the Solar tab" },
  ];

  return (
    <div className="panel p-4">
      <h2 className="text-base font-semibold">In everyday terms</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">The same numbers, in things everyone knows.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cards.map((c, i) => {
          const color = ["#2563eb", "#16a34a", "#7c3aed", "#0d9488"][i];
          return (
          <div
            key={c.label}
            className="lift rounded-xl border px-3 py-3"
            style={{ borderColor: `color-mix(in srgb, ${color} 35%, var(--border))`, background: `color-mix(in srgb, ${color} 8%, var(--card))` }}
          >
            <div className="bob text-3xl" style={{ animationDelay: `${i * 0.4}s` }} aria-hidden>
              {c.icon}
            </div>
            <div className="metric mt-1 text-xl font-semibold" style={{ color }}>
              {c.value}
            </div>
            <div className="text-[11px] leading-snug">{c.label}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{c.sub}</div>
          </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Assumptions: phone charge 0.012 kWh, electric car 0.17 kWh/km, grid {SCENARIO.co2KgPerKwh} kg CO₂/kWh, one tree absorbs about 21 kg CO₂ a year.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const STATE = [
  { label: "away", cls: "bg-muted text-muted-foreground/40" },
  { label: "home", cls: "bg-saving/75 text-white" },
  { label: "asleep", cls: "bg-violet/45 text-white" },
];

/** "Ania, Kuba (asleep: Marek)" — for tooltips. */
export function whoIsHome(p: Presence): string {
  const awake = SCENARIO.members.filter((m) => p[m.id] === 1).map((m) => m.name);
  const asleep = SCENARIO.members.filter((m) => p[m.id] === 2).map((m) => m.name);
  if (!awake.length && !asleep.length) return "nobody";
  return [awake.join(", "), asleep.length ? `asleep: ${asleep.join(", ")}` : ""].filter(Boolean).join(" · ");
}

const PIE_COLOR = ["var(--muted-foreground)", "var(--saving)", "var(--violet)"]; // away, home, asleep

/** "14:00–23:00" style periods in which the member has the given state. */
function periods(hours: HourPlan[], id: string, state: number): string[] {
  const out: string[] = [];
  let start: number | null = null;
  hours.forEach((h, i) => {
    const on = (h.presence[id] ?? 0) === state;
    if (on && start === null) start = h.hour;
    const last = i === hours.length - 1;
    if (start !== null && (!on || last)) {
      out.push(`${hh(start)}–${hh(on && last ? 24 : h.hour)}`.replace("24:00", "24:00"));
      start = null;
    }
  });
  return out;
}

function Donut({ counts, size = 96 }: { counts: number[]; size?: number }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const total = counts.reduce((x, y) => x + y, 0) || 1;
  let offset = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="hours away, at home and asleep">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={14} />
      {counts.map((n, k) => {
        if (!n) return null;
        const len = (n / total) * c;
        const seg = (
          <circle
            key={k}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={PIE_COLOR[k]}
            strokeOpacity={k === 0 ? 0.35 : 0.9}
            strokeWidth={14}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke-dasharray 0.6s ease" }}
          />
        );
        offset += len;
        return seg;
      })}
    </svg>
  );
}

export function WhoIsHome({ plan, now }: { plan: PlanResponse; now: number; setNow?: (h: number) => void }) {
  const [open, setOpen] = useState(false);
  const members = SCENARIO.members;
  if (!members.length) return null;
  const hours = plan.hours;
  const hour = hours.find((h) => h.hour === now) ?? hours[0];
  const labels = ["away", "at home", "asleep"];

  return (
    <div className="panel p-4">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
        <span>
          <span className="text-base font-semibold">Who's home today</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {hh(hour.hour)}: {whoIsHome(hour.presence)}
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

      {open && (
        <div className="animate-fade-up mt-3">
          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            {labels.map((l, k) => (
              <span key={l} className="flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLOR[k], opacity: k === 0 ? 0.45 : 1 }} />
                {l}
              </span>
            ))}
            <span>· hours of today (family calendar: shifts, home office, school)</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {members.map((m) => {
              const counts = [0, 1, 2].map((st) => hours.filter((h) => (h.presence[m.id] ?? 0) === st).length);
              const away = periods(hours, m.id, 0);
              const nowState = hour.presence[m.id] ?? 0;
              return (
                <div key={m.id} className="rounded-lg border border-border bg-surface-raised p-3">
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <Donut counts={counts} />
                      <span className="absolute inset-0 flex items-center justify-center text-2xl" aria-hidden>
                        {m.icon}
                      </span>
                    </div>
                    <div className="min-w-0 text-xs">
                      <div className="text-sm font-semibold">{m.name}</div>
                      <div className="text-[11px] text-muted-foreground">{m.role}</div>
                      <div className="metric mt-1">
                        <span style={{ color: "var(--saving)" }}>{counts[1]} h home</span> ·{" "}
                        <span style={{ color: "var(--violet)" }}>{counts[2]} h asleep</span> · <span className="text-muted-foreground">{counts[0]} h away</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] leading-snug">
                    <div>
                      <b>At {hh(hour.hour)}:</b> {labels[nowState]}
                    </div>
                    <div className="text-muted-foreground">{away.length ? `Away ${away.join(", ")}` : "Home all day"}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs">
            <b>{hh(hour.hour)}:</b> {hour.explanation}
          </p>
        </div>
      )}
    </div>
  );
}
