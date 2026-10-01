import { useCallback, useEffect, useState } from "react";
import { Dashboard, PAGES, type PageId } from "./components/Dashboard";
import { HouseScene } from "./components/HouseScene";
import { Icon } from "./components/Icon";
import { getPlan, type PlanResponse } from "./data";
import { SCENARIO, applyScenario, hh, money, type HourAction, type RoomId } from "./data/contract";
import { ActionButtons, ActionModal, type ActionId } from "./components/ActionModals";

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
/** How often the dashboard re-reads the plan (picks up the automatic daily refresh). */
const LIVE_REFRESH_MS = 10_000;

export type Theme = "bright" | "dark";

/** Colour of each plan action (full-screen 3D info card). */
const ACTION_COLOR: Record<HourAction, string> = {
  run: "#22c55e",
  preheat: "#f97316",
  coast: "#14b8a6",
  avoid: "#f59e0b",
  solar: "#facc15",
  normal: "#94a3b8",
};

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the choice just isn't remembered */
  }
}

export default function App() {
  const [now, setNow] = useState(18);
  // null until the first plan arrives; then the scenario's default PV size.
  const [pvKwp, setPvKwp] = useState<number | null>(null);
  // null until the first plan arrives; then the scenario's default comfort level.
  const [comfort, setComfort] = useState<string | null>(null);
  const [selected, setSelected] = useState<RoomId | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [openAction, setOpenAction] = useState<ActionId | null>(null);
  const [theme, setTheme] = useState<Theme>(() => stored("energypilot-theme", ["bright", "dark"] as const, "bright"));
  const [page, setPageState] = useState<PageId>(() => stored("energypilot-tab", PAGES.map((p) => p.id), "overview"));
  const [full3d, setFull3d] = useState(false);

  const setPage = (id: PageId) => {
    setPageState(id);
    remember("energypilot-tab", id);
    window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    if (!full3d) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull3d(false);
      if (e.key === "ArrowRight") setNow((h) => (h + 1) % 24);
      if (e.key === "ArrowLeft") setNow((h) => (h + 23) % 24);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full3d]);
  const bright = theme === "bright";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    remember("energypilot-theme", theme);
  }, [theme]);

  // The plan covers all 24 hours, so only a PV or comfort change (or new meter data) needs a new request.
  const refresh = useCallback(() => {
    getPlan(now, pvKwp ?? undefined, comfort ?? undefined).then((next) => {
      // Register the scenario (appliances, rooms, colours, currency) before rendering.
      applyScenario(next.scenario);
      setPlan(next);
      setPvKwp((current) => current ?? next.pvKwp);
      setComfort((current) => current ?? next.comfortLevel);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvKwp, comfort]);

  useEffect(() => {
    refresh();
    if (USE_MOCK) return;
    const timer = setInterval(refresh, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!plan) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading energy forecast…</div>;
  }

  const heatingOn = SCENARIO.heatingEnabled;
  const pages = PAGES.filter((p) => p.id !== "heating" || heatingOn);
  const current: PageId = page === "heating" && !heatingOn ? "overview" : page;
  const info = PAGES.find((p) => p.id === current)!;
  const dateLabel = new Date(`${plan.forecastDate}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  const hour = plan.hours.find((h) => h.hour === now) ?? plan.hours[0];
  const twin = { roomLoad: hour.roomLoad, solarNow: hour.solar, gridNow: hour.optimisedGrid, byAppliance: hour.byAppliance };
  // Heat stored: where the indoor temperature sits in the band of the selected comfort level.
  const band = SCENARIO.comfortLevels.find((l) => l.id === (comfort ?? plan.comfortLevel)) ?? SCENARIO.comfort;
  const battery =
    heatingOn && band ? { level: (hour.indoorTempEnd - band.nightMin) / Math.max(0.1, band.dayMax - band.nightMin), action: hour.action } : null;
  const hourCost = hour.optimisedGrid * hour.price;

  const scene = (
    <section
      className={
        full3d
          ? "fixed inset-0 z-50 overflow-hidden bg-background"
          : "panel relative h-[380px] min-w-0 overflow-hidden sm:h-[480px] xl:h-[560px]"
      }
    >
      <div className="absolute inset-0">
        <HouseScene twin={twin} selected={selected} onSelect={setSelected} theme={theme} />
      </div>
      <button
        onClick={() => setFull3d(!full3d)}
        className={`absolute z-30 rounded-lg border border-border bg-card/90 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur-md hover:bg-card ${
          full3d ? "right-4 top-4" : "bottom-10 right-4"
        }`}
      >
        {full3d ? "✕ Exit full screen" : "⛶ Full screen"}
      </button>
      {full3d && (
        <div className="pointer-events-none absolute inset-x-4 bottom-4 z-30 flex flex-wrap items-end justify-between gap-3">
          <div className="pointer-events-auto panel flex items-center gap-3 px-4 py-3">
            <button onClick={() => setNow((now + 23) % 24)} className="rounded-md px-2 py-1 text-lg hover:bg-muted" aria-label="Previous hour">
              ◀
            </button>
            <div className="text-center">
              <div className="label-caps">Hour</div>
              <div className="metric text-2xl font-semibold text-primary">{hh(now)}</div>
            </div>
            <button onClick={() => setNow((now + 1) % 24)} className="rounded-md px-2 py-1 text-lg hover:bg-muted" aria-label="Next hour">
              ▶
            </button>
          </div>
          <div className="panel hidden max-w-md px-4 py-3 md:block">
            <div className="flex items-center gap-2">
              <i className="h-2.5 w-2.5 rounded-full" style={{ background: ACTION_COLOR[hour.action] }} />
              <span className="text-sm font-medium">{hour.planNote}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{hour.explanation}</div>
          </div>
          <div className="panel grid grid-cols-3 gap-4 px-4 py-3 text-center">
            <div>
              <div className="label-caps">Load</div>
              <div className="metric text-lg font-semibold">{hour.optimisedLoad.toFixed(2)}</div>
              <div className="text-[11px] text-muted-foreground">kWh</div>
            </div>
            <div>
              <div className="label-caps">Cost</div>
              <div className="metric text-lg font-semibold">{money(hourCost)}</div>
              <div className="text-[11px] text-muted-foreground">{money(hour.price)}/kWh</div>
            </div>
            <div>
              <div className="label-caps">{battery ? "Indoor" : "Outdoor"}</div>
              <div className="metric text-lg font-semibold text-primary">{(battery ? hour.indoorTempEnd : hour.outdoorTemp).toFixed(1)}°</div>
              <div className="text-[11px] text-muted-foreground">{battery ? `heat stored ${Math.round(Math.max(0, Math.min(1, battery.level)) * 100)}%` : "°C"}</div>
            </div>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute left-4 top-4 space-y-1">
        <div className="metric rounded-md border border-border bg-card/90 px-2.5 py-1.5 text-xs backdrop-blur-sm">
          {hh(now)} · {hour.optimisedLoad.toFixed(2)} kWh used · {hour.optimisedGrid.toFixed(2)} kWh from grid
        </div>
        {selected && (
          <div className="metric rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs text-primary backdrop-blur-sm">
            {selected} · {hour.roomLoad[selected].toFixed(2)} kWh
          </div>
        )}
      </div>
      {!full3d && (
        <div className="pointer-events-none absolute bottom-4 right-4 text-right text-[11px] text-muted-foreground">
          Drag to rotate · pinch or scroll to zoom · tap a room
        </div>
      )}
    </section>
  );

  const themeButton = (
    <button
      onClick={() => setTheme(bright ? "dark" : "bright")}
      title={bright ? "Switch to dark theme" : "Switch to light theme"}
      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <Icon name={bright ? "moon" : "sun"} size={16} />
      {bright ? "Dark mode" : "Light mode"}
    </button>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      {/* ---------- sidebar (desktop) ---------- */}
      <aside className="sticky top-0 hidden h-screen flex-col gap-6 overflow-y-auto border-r border-border bg-sidebar/80 px-4 py-5 backdrop-blur-md lg:flex">
        <Brand />
        <nav aria-label="Dashboard pages" className="flex flex-col gap-1">
          <div className="label-caps px-3 pb-1">Menu</div>
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => setPage(p.id)}
              aria-current={current === p.id ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                current === p.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon name={p.icon} size={18} />
              {p.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <HouseholdCard />
          <SourceStatus mock={USE_MOCK} />
          {themeButton}
        </div>
      </aside>

      <div className="min-w-0">
        {/* ---------- mobile / tablet: brand + page tabs ---------- */}
        <div className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 pt-3">
            <Brand />
            {themeButton}
          </div>
          <nav aria-label="Dashboard pages" className="flex gap-1 overflow-x-auto px-4 py-2.5 [scrollbar-width:none]">
            {pages.map((p) => (
              <button
                key={p.id}
                onClick={() => setPage(p.id)}
                aria-current={current === p.id ? "page" : undefined}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  current === p.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon name={p.icon} size={15} />
                {p.label}
              </button>
            ))}
          </nav>
        </div>

        {/* ---------- page header ---------- */}
        <header className="mx-auto flex max-w-[1440px] flex-wrap items-end justify-between gap-4 px-4 pt-5 sm:px-6 lg:px-8 lg:pt-7">
          <div className="min-w-0">
            {current !== "overview" && (
              <button
                onClick={() => setPage("overview")}
                className="mb-2 flex items-center gap-1.5 rounded-lg py-1 pr-2 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
              >
                <Icon name="arrow" size={15} className="rotate-180" />
                Back to Overview
              </button>
            )}
            <h1 className="text-2xl font-semibold tracking-tight [text-wrap:balance] sm:text-[28px]">{info.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{info.subtitle}</p>
            {current === "overview" && (
              <dl className="mt-3 flex flex-wrap gap-2 text-xs">
                {[
                  { icon: "pin" as const, label: "Location", value: SCENARIO.location.name },
                  { icon: "clock" as const, label: "Forecast date", value: dateLabel },
                  { icon: "users" as const, label: "Household", value: `${SCENARIO.members.length} residents${heatingOn ? " · heat pump" : ""}` },
                ].map((m) => (
                  <div key={m.label} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5">
                    <Icon name={m.icon} size={14} className="text-primary" />
                    <dt className="text-muted-foreground">{m.label}:</dt>
                    <dd className="font-medium">{m.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {current === "overview" && <ActionButtons onOpen={setOpenAction} />}
        </header>

        <FreshnessBanner plan={plan} mock={USE_MOCK} />

        <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8">
          <Dashboard
            page={current}
            setPage={setPage}
            now={now}
            setNow={setNow}
            selected={selected}
            setSelected={setSelected}
            pvKwp={pvKwp ?? plan.pvKwp}
            comfort={comfort ?? plan.comfortLevel}
            setComfort={setComfort}
            setPvKwp={setPvKwp}
            plan={plan}
            scene={scene}
          />
        </main>
      </div>

      <ActionModal open={openAction} plan={plan} mock={USE_MOCK} now={now} onClose={() => setOpenAction(null)} />
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Icon name="bolt" size={18} />
      </span>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">EnergyPilot</div>
        <div className="text-[11px] text-muted-foreground">Home Energy Planner</div>
      </div>
    </div>
  );
}

/** Who the dashboard is for — the family of the scenario. */
function HouseholdCard() {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-3">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Icon name="users" size={15} className="text-primary" />
        {SCENARIO.household.title}
      </div>
      <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        {SCENARIO.members.map((m) => (
          <li key={m.id} className="flex gap-1.5">
            <span aria-hidden>{m.icon}</span>
            <span>
              <span className="font-medium text-foreground">{m.name}</span> · {m.role}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceStatus({ mock }: { mock: boolean }) {
  return (
    <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${mock ? "bg-solar" : "bg-saving"}`} />
      {mock ? "Offline snapshot" : "Connected to energy pipeline"}
    </div>
  );
}

/** Tells the user when the forecast is not for today — and that the backend is updating it. */
function FreshnessBanner({ plan, mock }: { plan: PlanResponse; mock: boolean }) {
  const f = plan.source.freshness;
  if (!f) return null;
  const day = new Date(`${f.forecastStart.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  let body = null;
  if (mock) {
    body = (
      <div className="rounded-lg border border-border bg-card px-4 py-2 text-xs text-muted-foreground">
        Offline snapshot — forecast made for <b className="text-foreground">{day}</b>. Run the pipeline and the backend for today's forecast.
      </div>
    );
  } else if (f.stale || f.refreshing) {
    body = (
      <div className="flex items-center gap-2 rounded-lg border border-solar bg-solar/10 px-4 py-2 text-xs">
        {f.refreshing && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-solar border-t-transparent" />}
        <span>{f.refreshing ? `Updating to today's forecast (new weather, new day of history, re-training) — about 30 s. Showing ${day} meanwhile.` : f.message}</span>
      </div>
    );
  }
  return body && <div className="mx-auto mt-4 max-w-[1440px] px-4 sm:px-6 lg:px-8">{body}</div>;
}
