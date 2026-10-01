import { useEffect, useState, type ReactNode } from "react";
import { SCENARIO, money, type PlanResponse } from "../data/contract";
import { exportPdfReport } from "../pdfReport";
import { downloadHourlyCsv } from "../report";
import { InsightsPanel } from "./Dashboard";
import { AskAssistant } from "./AskAssistant";
import { Icon, type IconName } from "./Icon";

/*
 * Header actions: Export energy report, Get personalised energy insights, the Ask assistant
 * and Assumptions & data.
 * Each button opens a modal with its content.
 */

export type ActionId = "export" | "insights" | "ask" | "assumptions";

function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`panel animate-fade-up my-4 w-full p-4 shadow-2xl sm:my-8 sm:p-5 ${wide ? "max-w-5xl" : "max-w-2xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-lg leading-none text-muted-foreground hover:bg-muted hover:text-foreground">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ExportContent({ plan }: { plan: PlanResponse }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const t = plan.totals;

  const pdf = () => {
    setBusy(true);
    // Let the button repaint before the PDF is built.
    setTimeout(() => {
      try {
        exportPdfReport(plan);
        setDone(`EnergyPilot_report_${plan.forecastDate}_${plan.pvKwp}kWp.pdf downloaded.`);
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md border border-border bg-surface-raised px-3 py-2">
          <div className="label-caps">Forecast</div>
          <div className="metric mt-0.5 text-base text-primary">{t.forecastKwh.toFixed(1)} kWh</div>
        </div>
        <div className="rounded-md border border-border bg-surface-raised px-3 py-2">
          <div className="label-caps">Cost</div>
          <div className="metric mt-0.5 text-base">{money(t.optimisedCost)}</div>
        </div>
        <div className="rounded-md border border-border bg-surface-raised px-3 py-2">
          <div className="label-caps">Saving</div>
          <div className="metric mt-0.5 text-base text-saving">{money(t.usualCost - t.optimisedCost)}</div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface-raised p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-medium">PDF report</div>
            <div className="text-xs text-muted-foreground">{(plan.live.readings > 0 ? 6 : 5) + (plan.horizon ? 1 : 0)} pages, landscape A4 — ready to print or share.</div>
          </div>
          <button
            onClick={pdf}
            disabled={busy}
            className="rounded-full border border-primary bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Creating PDF…" : "Download PDF"}
          </button>
        </div>
        <ul className="mt-2 grid list-disc gap-x-6 pl-4 text-xs text-muted-foreground sm:grid-cols-2">
          <li>Summary, KPIs and the busiest hour</li>
          <li>Forecast, heating and cost charts</li>
          <li>24 h, 3-day and 7-day forecast</li>
          <li>Today's actions</li>
          <li>Personalised insights</li>
          <li>Hourly analysis, all 24 hours</li>
          <li>Appliance forecast per hour</li>
          <li>Optimiser schedule and solar payback</li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-raised p-3">
        <div>
          <div className="font-medium">Hourly data (CSV)</div>
          <div className="text-xs text-muted-foreground">One row per hour with every appliance forecast — opens in Excel.</div>
        </div>
        <button
          onClick={() => {
            downloadHourlyCsv(plan);
            setDone(`energypilot_hourly_${plan.forecastDate}_${plan.pvKwp}kWp.csv downloaded.`);
          }}
          className="rounded-full border border-border px-4 py-1.5 text-xs text-foreground hover:bg-muted"
        >
          Download CSV
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Uses the current selection: {plan.pvKwp} kWp solar, forecast for {plan.forecastDate}.
      </p>
      {done && <p className="text-xs text-saving">✓ {done}</p>}
    </div>
  );
}

export function ActionButtons({ onOpen }: { onOpen: (id: ActionId) => void }) {
  const items: { id: ActionId; label: string; icon: IconName; primary?: boolean }[] = [
    { id: "ask", label: "Ask EnergyPilot", icon: "message" },
    { id: "insights", label: "Insights", icon: "sparkles" },
    { id: "assumptions", label: "Assumptions", icon: "clipboard" },
    { id: "export", label: "Export report", icon: "download", primary: true },
  ];
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
      {items.map((i) => (
        <button
          key={i.id}
          onClick={() => onOpen(i.id)}
          className={`flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium shadow-sm transition-colors ${
            i.primary
              ? "border-primary bg-primary text-primary-foreground hover:opacity-90"
              : "border-border bg-card text-foreground hover:border-primary hover:text-primary"
          }`}
        >
          <Icon name={i.icon} size={15} />
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function ActionModal({
  open,
  plan,
  mock,
  now,
  onClose,
}: {
  open: ActionId | null;
  plan: PlanResponse;
  mock: boolean;
  now: number;
  onClose: () => void;
}) {
  if (open === "export") {
    return (
      <Modal title="Export energy report" subtitle="Download the 24 h analysis as a PDF report or as hourly data." onClose={onClose}>
        <ExportContent plan={plan} />
      </Modal>
    );
  }
  if (open === "insights") {
    return (
      <Modal
        title="Personalised energy insights"
        subtitle={`From ${SCENARIO.household.name}'s own data, today's forecast and the optimised plan.`}
        onClose={onClose}
      >
        <InsightsPanel insights={plan.insights} embedded />
      </Modal>
    );
  }
  if (open === "assumptions") {
    return (
      <Modal wide title="📋 Assumptions & data sources" subtitle={`Everything ${SCENARIO.household.name}'s solution assumes — from model-training/scenario.json.`} onClose={onClose}>
        <Assumptions plan={plan} />
      </Modal>
    );
  }
  if (open === "ask") {
    return (
      <Modal title="💬 Ask EnergyPilot" subtitle="Ask any question about your energy — answers use your own forecast, prices and plan." onClose={onClose}>
        <AskAssistant plan={plan} mock={mock} now={now} />
      </Modal>
    );
  }
  return null;
}

/** Model names for people (output/forecast_accuracy.json → model). */
const MODEL_NAME: Record<string, string> = {
  hist_gbm: "gradient boosting",
  ensemble: "ensemble of XGBoost and gradient boosting",
  xgboost_direct: "XGBoost",
  xgboost_recursive: "XGBoost",
  lstm: "LSTM neural network",
  gru: "GRU neural network",
  ridge: "linear regression",
  seasonal_naive: "seasonal baseline",
};

function Assumptions({ plan }: { plan: PlanResponse }) {
  const members = SCENARIO.members;
  const acc = plan.accuracy;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-4">
        {members.map((m) => (
          <div key={m.id} className="rounded-md border border-border bg-surface-raised px-3 py-2">
            <div className="text-lg" aria-hidden>{m.icon}</div>
            <div className="font-semibold">{m.name}</div>
            <div className="text-xs text-muted-foreground">{m.role}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {SCENARIO.assumptions.map((group) => (
          <div key={group.topic} className="rounded-md border border-border bg-surface-raised p-3">
            <h3 className="label-caps mb-1.5">{group.topic}</h3>
            <ul className="space-y-1.5 text-xs leading-relaxed">
              {group.items.map((item, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-primary">▸</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="rounded-md border border-border bg-surface-raised p-3 text-xs">
        <h3 className="label-caps mb-1.5">Data sources</h3>
        <ul className="space-y-1">
          <li>🌡️ Weather history and 7-day forecast: Open-Meteo (archive-api.open-meteo.com, api.open-meteo.com) for {SCENARIO.location.name} ({SCENARIO.location.latitude} °N, {SCENARIO.location.longitude} °E)</li>
          <li>☀️ Solar production: JRC PVGIS, {SCENARIO.solar.yieldKwhPerKwp} kWh per kWp per year</li>
          <li>💶 Tariff and PV costs: HackoWatt common assumptions — {SCENARIO.tariffNote}</li>
          <li>🏠 Household consumption: simulated hour by hour from the family calendar and the appliance ranges in the brief</li>
          {acc && <li>🤖 Forecast model: {MODEL_NAME[acc.model] ?? acc.model}, the most accurate of 8 models tested on 8 past weeks</li>}
        </ul>
      </div>
    </div>
  );
}
