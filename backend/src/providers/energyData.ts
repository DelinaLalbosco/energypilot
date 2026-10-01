import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyScenario, type ForecastAccuracy, type ScenarioMeta } from "../../../shared/types";

/*
 * Reads the outputs of the Python pipeline in ../energy (file names from scenario.json → data):
 *   scenario.json                  household, members, appliances, rooms, tariff, heating, solar, assumptions
 *   data/history.csv               historical hourly profile (generate_data.py)
 *   output/forecast_7d.csv         7-day forecast with presence and bands (forecast.py)
 *   output/forecast_accuracy.json  model choice + backtest accuracy (train_model.py)
 *   output/learning_log.json       online-learning runs (update_model.py)
 *   output/smart_plan.csv          optimised plan per PV size × comfort level (smart_optimizer.py)
 *   output/solar_scenarios.csv     yearly PV simulator (smart_optimizer.py)
 *   data/live_readings.csv         smart-meter readings received via POST /api/readings
 * Files are re-read whenever their modification time changes, so re-running the
 * Python scripts updates the dashboard without restarting the backend.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const ENERGY_DIR = resolve(process.env.ENERGY_DIR || join(HERE, "../../../model-training"));
export const SCENARIO_JSON = process.env.ENERGY_SCENARIO || "scenario.json";
/** File path from scenario.json → data (relative to ENERGY_DIR). */
const dataFile = (key: string): string => loadScenarioRaw().data[key];
export const planFile = () => dataFile("plan_file");

export type Row = Record<string, string>;

function parseCsv(text: string): Row[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

const cache = new Map<string, { mtimeMs: number; rows: Row[] }>();

function load(file: string): Row[] {
  const path = resolve(ENERGY_DIR, file);
  const { mtimeMs } = statSync(path);
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.rows;
  const rows = parseCsv(readFileSync(path, "utf8"));
  cache.set(path, { mtimeMs, rows });
  return rows;
}

const PALETTE = ["#ff7a59", "#38bdf8", "#a78bfa", "#fb923c", "#f43f5e", "#a3e635", "#facc15", "#2dd4bf", "#818cf8", "#f472b6", "#4ade80", "#94a3b8", "#b08968"];

let scenarioCache: { mtimeMs: number; raw: any; meta: ScenarioMeta } | null = null;

/** Raw scenario.json (Python-style keys). */
export function loadScenarioRaw(): any {
  if (!scenarioCache) loadScenario();
  return scenarioCache!.raw;
}

/** Loads scenario.json, converts it for the dashboard and registers it (applyScenario). */
export function loadScenario(): ScenarioMeta {
  const path = resolve(ENERGY_DIR, SCENARIO_JSON);
  const { mtimeMs } = statSync(path);
  if (scenarioCache && scenarioCache.mtimeMs === mtimeMs) return scenarioCache.meta;

  const raw = JSON.parse(readFileSync(path, "utf8"));
  const heating = raw.heating?.enabled ? raw.heating : null;
  const meta: ScenarioMeta = {
    household: raw.household,
    location: raw.location ?? { name: "", latitude: raw.solar.latitude, longitude: 0, timezone: "" },
    members: (raw.members ?? []).map((m: any) => ({ id: m.id, name: m.name, icon: m.icon ?? "🙂", role: m.role ?? "", adult: Boolean(m.adult) })),
    assumptions: raw.assumptions ?? [],
    currency: raw.currency ?? "€",
    currencyCode: raw.currency_code ?? raw.currency ?? "EUR",
    rooms: raw.rooms,
    appliances: raw.appliances.map((a: any, i: number) => ({
      id: a.id,
      name: a.name,
      room: a.room,
      color: a.color ?? PALETTE[i % PALETTE.length],
      flexible: Boolean(a.flexible),
      windowLabel: a.flexible?.label,
      window: a.flexible?.window,
      alwaysOn: Boolean(a.always_on),
      peakTip: a.peak_tip,
    })),
    heatingEnabled: Boolean(heating),
    heatingAppliance: heating?.appliance ?? null,
    comfort: heating ? { dayMin: heating.day_min, dayMax: heating.day_max, nightMin: heating.night_min } : null,
    comfortLevels: heating
      ? (heating.comfort_levels ?? [{ id: "standard", label: "Comfort", day_min: heating.day_min, day_max: heating.day_max, night_min: heating.night_min, night_max: heating.night_max }]).map(
          (l: any) => ({ id: l.id, label: l.label, dayMin: l.day_min, dayMax: l.day_max, nightMin: l.night_min, nightMax: l.night_max }),
        )
      : [],
    defaultComfort: heating?.default_comfort ?? heating?.comfort_levels?.[0]?.id ?? "standard",
    heatLossPerC: heating?.loss_kw_per_c ?? 0,
    thermal: heating
      ? {
          capacityKwhPerC: heating.capacity_kwh_per_c ?? 3,
          maxKw: heating.max_kw ?? 5,
          comfortTemp: heating.comfort_temp ?? 21,
          nightHours: heating.night_hours ?? [23, 0, 1, 2, 3, 4, 5],
        }
      : null,
    co2KgPerKwh: raw.co2_kg_per_kwh ?? 0.3,
    tariffNote: raw.tariff?.note ?? "",
    solar: {
      latitude: raw.solar.latitude,
      yieldKwhPerKwp: raw.solar.yield_kwh_per_kwp,
      options: raw.solar.options_kwp,
      defaultKwp: raw.solar.default_kwp,
      installCostPerKwp: raw.solar.install_cost_per_kwp,
      feedInPrice: raw.solar.feed_in_price,
      annualOpexPct: raw.solar.annual_opex_pct ?? 0,
      simulatorMax: raw.solar.simulator_kwp?.max ?? Math.max(...raw.solar.options_kwp),
      simulatorStep: raw.solar.simulator_kwp?.step ?? 1,
    },
  };
  applyScenario(meta);
  scenarioCache = { mtimeMs, raw, meta };
  return meta;
}

export function historyFile(): string {
  return loadScenarioRaw().data.history_file;
}

/** History rows with the scenario's column names mapped to timestamp / hour / total_consumption_kwh / outdoor_temp_c. */
export function loadHistory(): Row[] {
  const data = loadScenarioRaw().data;
  const rows = load(data.history_file);
  const map = (r: Row): Row => {
    const ts = r[data.timestamp_column] ?? r.timestamp;
    const out: Row = { ...r, timestamp: ts, hour: r.hour ?? String(new Date(ts.replace(" ", "T")).getHours()) };
    if (data.total_column && r[data.total_column] !== undefined) out.total_consumption_kwh = r[data.total_column];
    else if (out.total_consumption_kwh === undefined) {
      out.total_consumption_kwh = String(loadScenarioRaw().appliances.reduce((s: number, a: any) => s + (Number(r[a.id]) || 0), 0));
    }
    if (data.temperature_column && r[data.temperature_column] !== undefined) out.outdoor_temp_c = r[data.temperature_column];
    return out;
  };
  const first = rows[0];
  const needsMap = first && (!("timestamp" in first) || !("hour" in first) || !("total_consumption_kwh" in first) || !("outdoor_temp_c" in first));
  return needsMap ? rows.map(map) : rows;
}

const optional = (file: string): Row[] => (existsSync(resolve(ENERGY_DIR, file)) ? load(file) : []);

/** 7-day forecast; empty until forecast.py has run. */
export function loadHorizon(): Row[] {
  return optional(dataFile("forecast_file"));
}

export function loadPlan(): Row[] {
  return load(planFile());
}

export function loadScenarios(): Row[] {
  return load(dataFile("solar_file"));
}

function loadJson(file: string): any | null {
  const path = resolve(ENERGY_DIR, file);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/** Model choice and backtest accuracy (train_model.py) plus the online-learning log (update_model.py). */
export function loadAccuracy(): ForecastAccuracy | null {
  const a = loadJson(dataFile("accuracy_file"));
  if (!a) return null;
  const log = loadJson(dataFile("accuracy_file").replace(/[^/]+$/, "learning_log.json")) ?? [];
  return {
    model: a.model,
    trainedUntil: a.trained_until,
    backtestWeeks: a.backtest_weeks,
    calibrationFactor: a.calibration_factor,
    beforeCalibration: a.before_calibration,
    afterCalibration: a.after_calibration,
    comparison: a.comparison,
    peak: a.peak ?? null,
    learningLog: log.slice(-10),
  };
}

/** Likely range of each forecast period (forecast.py → forecast_accuracy.json → forecast.periods). */
export function loadPeriodRanges(): Record<string, { forecast_kwh: number; low_kwh: number; high_kwh: number }> {
  return loadJson(dataFile("accuracy_file"))?.forecast?.periods ?? {};
}

/** Smart-meter readings; empty until the first POST /api/readings. */
export function loadReadings(): Row[] {
  return optional(dataFile("readings_file"));
}

export function saveReadings(header: string[], rows: Row[]) {
  const lines = [header.join(","), ...rows.map((r) => header.map((h) => r[h] ?? "").join(","))];
  writeFileSync(resolve(ENERGY_DIR, dataFile("readings_file")), lines.join("\n") + "\n");
}

export function num(row: Row, key: string): number {
  const v = Number(row[key]);
  return Number.isFinite(v) ? v : 0;
}
