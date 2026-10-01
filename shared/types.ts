/*
 * Contract between the backend (which reads the Python energy pipeline
 * outputs) and the React dashboard. Both the API and the mock provider return
 * PlanResponse.
 */

/** Room ids come from model-training/scenario.json → rooms[].id. */
export type RoomId = string;

/** Appliance ids are the kWh column names in the history CSV (scenario.json → appliances[].id). */
export type ApplianceId = string;

export type Room = { id: RoomId; label: string };

/** A household member (scenario.json → members). Presence per hour: 0 away, 1 home awake, 2 home asleep. */
export type Member = { id: string; name: string; icon: string; role: string; adult: boolean };
export type Presence = Record<string, 0 | 1 | 2>;

export type Appliance = {
  id: ApplianceId;
  name: string;
  room: RoomId;
  color: string;
  /** The optimiser may move it inside its window. */
  flexible: boolean;
  windowLabel?: string;
  /** Allowed start hours [start, end), wraps past midnight when start > end. */
  window?: [number, number];
  /** Runs around the clock (fridge, standby, …). */
  alwaysOn?: boolean;
  /** Advice shown in peak hours when this appliance is in use. */
  peakTip?: string;
};

/** Everything scenario-specific the dashboard needs, loaded from model-training/scenario.json. */
export type ScenarioMeta = {
  household: { name: string; title: string; description?: string };
  location: { name: string; latitude: number; longitude: number; timezone: string };
  members: Member[];
  /** Documented assumptions, grouped by topic (scenario.json → assumptions). */
  assumptions: { topic: string; items: string[] }[];
  currency: string;
  /** Plain-text code for places that cannot draw the symbol (PDF), e.g. "EUR", "PLN". */
  currencyCode: string;
  rooms: Room[];
  appliances: Appliance[];
  heatingEnabled: boolean;
  heatingAppliance: ApplianceId | null;
  comfort: { dayMin: number; dayMax: number; nightMin: number } | null;
  /** Comfort bands the optimiser planned for (slider stops). */
  comfortLevels: { id: string; label: string; dayMin: number; dayMax: number; nightMin: number; nightMax: number }[];
  defaultComfort: string;
  /** Extra heating per °C colder, kWh per hour (for the cold-snap what-if). */
  heatLossPerC: number;
  /** Thermal model for the game: kWh to warm the house by 1 °C, max heater power, night hours. */
  thermal: { capacityKwhPerC: number; maxKw: number; comfortTemp: number; nightHours: number[] } | null;
  co2KgPerKwh: number;
  tariffNote: string;
  solar: {
    latitude: number;
    yieldKwhPerKwp: number;
    options: number[];
    defaultKwp: number;
    installCostPerKwp: number;
    feedInPrice: number;
    annualOpexPct: number;
    /** The yearly simulator covers 0 … simulatorMax kWp in simulatorStep steps. */
    simulatorMax: number;
    simulatorStep: number;
  };
};

/** Optimiser decision for one flexible appliance. */
export type Recommendation = {
  applianceId: ApplianceId;
  appliance: string;
  room: RoomId;
  /** Hour this appliance is usually run (from the historical data). */
  from: number;
  /** Hour chosen by the optimiser. */
  to: number;
  /** Allowed operating window [start, end). */
  window: [number, number];
  powerKw: number;
  saving: number;
  reasons: string[];
};

export type HourAction = "run" | "preheat" | "coast" | "avoid" | "solar" | "normal";

/** Everything the dashboard needs for one hour of the forecast day. */
export type HourPlan = {
  hour: number;
  timestamp: string;
  outdoorTemp: number;
  price: number;
  solar: number;
  /** Forecast total demand (calibrated so it does not under-predict), kWh. */
  forecastLoad: number;
  /** Upper band (90 %) of the forecast, kWh. */
  safeForecastLoad: number;
  /** Lower band (10 %) of the forecast, kWh. */
  lowForecastLoad: number;
  /** Known actual value — null for future hours (the live meter fills measuredLoad instead). */
  actualLoad: number | null;
  /** Short peaks: the highest 1-minute power this hour may reach (kW, 90 % level). */
  peakKw: number;
  /** Who is expected at home (planned family calendar). */
  presence: Presence;
  peopleHome: number;
  /** Live smart-meter reading for this hour, when one has been received. */
  measuredLoad: number | null;
  /** XGBoost prediction per appliance, kWh. */
  forecastByAppliance: Record<ApplianceId, number>;
  /** Heating with usual habits (the XGBoost heating forecast) and in the optimised plan, kWh. */
  heatingUsual: number;
  heatingOpt: number;
  /** Indoor temperature at the start of the hour in the optimised plan, °C. */
  indoorTemp: number;
  /** Indoor temperature at the end of the hour, °C. */
  indoorTempEnd: number;
  /** Demand with usual habits: forecast heating, appliances at their usual hour (kWh). */
  usualLoad: number;
  usualGrid: number;
  /** Optimised plan: heating and flexible appliances as scheduled by smart_optimizer.py (kWh). */
  optimisedLoad: number;
  byAppliance: Record<ApplianceId, number>;
  optimisedGrid: number;
  roomLoad: Record<RoomId, number>;
  isPeak: boolean;
  action: HourAction;
  /** Flexible appliances the optimiser scheduled in this hour. */
  scheduled: ApplianceId[];
  /** Short description of what the plan does in this hour. */
  planNote: string;
  /** Why the forecast changes versus the previous hour. */
  explanation: string;
  /** What to do in this hour. */
  advice: string[];
};

/** One row of the yearly PV simulator (solar_scenarios.csv). */
export type SolarScenario = {
  pvKwp: number;
  annualProductionKwh: number;
  annualDemandKwh: number;
  installCost: number;
  /** Yearly running cost (scenario.json → solar.annual_opex_pct of the investment). */
  annualOpex: number;
  exportKwh: number;
  /** Savings = bill saving + export income − running cost (A: current habits; …WithShift: B). */
  billSaving: number;
  exportIncome: number;
  billSavingWithShift: number;
  exportIncomeWithShift: number;
  demandCoveredPct: number;
  gridReductionKwh: number;
  annualSavings: number;
  paybackYears: number | null;
  demandCoveredPctWithShift: number;
  gridReductionKwhWithShift: number;
  annualSavingsWithShift: number;
  paybackYearsWithShift: number | null;
};

/** One smart-meter reading (POST /api/readings). */
export type MeterReading = {
  timestamp: string;
  totalKwh: number;
  appliances?: Partial<Record<ApplianceId, number>>;
};

export type LiveAlert = { hour: number; measured: number; forecast: number; diff: number; text: string };

/** How the live meter readings compare with the forecast for the plan day. */
export type LiveStatus = {
  readings: number;
  lastTimestamp: string | null;
  matchedHours: number;
  measuredKwh: number;
  forecastKwhSameHours: number;
  deviationPct: number | null;
  alerts: LiveAlert[];
};

/** A personalised, rule-based insight computed from the household's data. */
export type Insight = {
  id: string;
  title: string;
  value: string;
  detail: string;
  tip?: string;
  tone: "saving" | "peak" | "info";
};

/** One hour of the multi-day forecast (xgboost_forecast_7d.csv). */
export type HorizonHour = {
  timestamp: string;
  hour: number;
  forecast: number;
  safeForecast: number;
  lowForecast: number;
  actual: number | null;
  outdoorTemp: number;
  peakKw: number;
  presence: Presence;
  /** XGBoost prediction per appliance, kWh. */
  byAppliance: Record<ApplianceId, number>;
};

export type HorizonDay = {
  date: string;
  label: string;
  forecastKwh: number;
  actualKwh: number | null;
  heatingKwh: number;
  /** Planned day type, e.g. "Marek: night shift · Ania: home office · school day". */
  dayType: string;
  avgTemp: number;
  minTemp: number;
  peakHour: number;
  peakKwh: number;
  /** Why this day is higher/lower than the period average. */
  explanation: string;
};

export type HorizonPeriod = {
  days: number;
  label: string;
  start: string;
  end: string;
  forecastKwh: number;
  safeForecastKwh: number;
  actualKwh: number | null;
  errorPct: number | null;
  mae: number | null;
  /** Likely range for the period total, from the backtest error distribution. */
  lowKwh: number;
  highKwh: number;
  avgTemp: number;
  minTemp: number;
  maxTemp: number;
  /** Top three demand hours in the period. */
  peakHours: { timestamp: string; kwh: number }[];
  daily: HorizonDay[];
  /** Short explanation of the expected increase/decrease over the period. */
  summary: string[];
};

export type Horizon = {
  start: string;
  hours: HorizonHour[];
  periods: HorizonPeriod[];
};

export type AccuracyScores = {
  hourly_mae_kwh: number;
  hourly_mae_pct: number;
  daily_abs_error_pct: number;
  bias_pct: number;
  hours_under_pct: number;
  days_under_pct: number;
  error_1d_pct: number;
  error_3d_pct: number;
  error_7d_pct: number;
};

/** output/forecast_accuracy.json — how the model was chosen and how accurate it is. */
export type ForecastAccuracy = {
  model: string;
  trainedUntil: string;
  backtestWeeks: number;
  calibrationFactor: number;
  beforeCalibration: AccuracyScores;
  afterCalibration: AccuracyScores;
  comparison: Record<string, AccuracyScores>;
  /** Short-peak model check on the last 4 weeks. */
  peak: { coverage_pct: number; mae_kw: number } | null;
  learningLog: { at: string; matched_hours: number; measured_vs_forecast: number | null; k_before: number; k_after: number; days_added: number }[];
};

export type HeatingPlan = {
  preheatHours: number[];
  coastHours: number[];
  minTemp: number;
  maxTemp: number;
  usualKwh: number;
  optimisedKwh: number;
  saving: number;
};

export type ComfortOption = {
  id: string;
  label: string;
  band: string;
  cost: number;
  saving: number;
  savingPct: number;
};

export type PlanResponse = {
  scenario: ScenarioMeta;
  nowHour: number;
  pvKwp: number;
  comfortLevel: string;
  comfortOptions: ComfortOption[];
  forecastDate: string;
  source: {
    planFile: string;
    historyFile: string;
    generatedAt: string;
    safetyMarginKwh: number;
    /** Is the forecast for today? The backend re-runs the pipeline by itself when it is not. */
    freshness: { forecastStart: string; today: string; stale: boolean; refreshing: boolean; lastRun: string | null; message: string };
  };
  hours: HourPlan[];
  recommendations: Recommendation[];
  heating: HeatingPlan;
  solarScenarios: SolarScenario[];
  live: LiveStatus;
  insights: Insight[];
  /** Multi-day forecast (24 h / 3 days / 7 days); null when forecast.py has not produced it yet. */
  horizon: Horizon | null;
  /** Model choice and backtest accuracy (train_model.py); null before the first training. */
  accuracy: ForecastAccuracy | null;
  peakHours: number[];
  totals: {
    forecastKwh: number;
    safeForecastKwh: number;
    actualKwh: number | null;
    /** Mean absolute error against known actual values (null for a future day). */
    forecastMae: number | null;
    optimisedKwh: number;
    optimisedGridKwh: number;
    solarKwh: number;
    /** Cost with the flexible appliances at their usual hour. */
    usualCost: number;
    optimisedCost: number;
    /** Cost of the optimised day without any PV — shows what the solar installation saves. */
    noSolarCost: number;
    usualPeakGrid: number;
    optimisedPeakGrid: number;
    historicalDailyAvgKwh: number;
  };
};

/* --------------------------------------------------------------------------
 * Scenario registry. Filled from ScenarioMeta by applyScenario(): the backend
 * calls it when it loads scenario.json, the frontend when a plan arrives. The
 * arrays are mutated in place so existing imports stay valid.
 * ------------------------------------------------------------------------ */

export const SCENARIO: ScenarioMeta = {
  household: { name: "", title: "" },
  location: { name: "", latitude: 0, longitude: 0, timezone: "" },
  members: [],
  assumptions: [],
  currency: "€",
  currencyCode: "EUR",
  rooms: [],
  appliances: [],
  heatingEnabled: false,
  heatingAppliance: null,
  comfort: null,
  comfortLevels: [],
  defaultComfort: "standard",
  heatLossPerC: 0,
  thermal: null,
  co2KgPerKwh: 0.3,
  tariffNote: "",
  solar: { latitude: 0, yieldKwhPerKwp: 0, options: [0], defaultKwp: 0, installCostPerKwp: 0, feedInPrice: 0, annualOpexPct: 0, simulatorMax: 10, simulatorStep: 1 },
};
export const ROOMS: Room[] = [];
export const APPLIANCES: Appliance[] = [];
export const APPLIANCE_IDS: ApplianceId[] = [];
export const APPLIANCE_COLORS: Record<ApplianceId, string> = {};
export const PV_OPTIONS: number[] = [];

const replace = <T,>(target: T[], items: T[]) => target.splice(0, target.length, ...items);

export function applyScenario(meta: ScenarioMeta) {
  Object.assign(SCENARIO, meta);
  replace(ROOMS, meta.rooms);
  replace(APPLIANCES, meta.appliances);
  replace(APPLIANCE_IDS, meta.appliances.map((a) => a.id));
  replace(PV_OPTIONS, meta.solar.options);
  for (const k of Object.keys(APPLIANCE_COLORS)) delete APPLIANCE_COLORS[k];
  for (const a of meta.appliances) APPLIANCE_COLORS[a.id] = a.color;
}

export const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function at(arr: number[], hour: number) {
  return arr[((hour % 24) + 24) % 24] ?? 0;
}
export function hh(h: number) {
  return `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;
}
export function applianceName(id: ApplianceId) {
  return APPLIANCES.find((a) => a.id === id)?.name ?? id;
}
/** Money in the scenario currency, e.g. €1.23. */
export function money(v: number, digits = 2) {
  return `${SCENARIO.currency}${v.toFixed(digits)}`;
}
