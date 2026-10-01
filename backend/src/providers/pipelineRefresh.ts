import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ENERGY_DIR } from "./energyData";

/*
 * Keeps the forecast current. The Python pipeline forecasts from "today"; when the
 * forecast in model-training/output/ starts on an earlier day (e.g. the demo is the day after
 * the last run), the backend starts
 *     model-training/.venv/bin/python run_pipeline.py --quick
 * in the background: new weather (history + forecast), history up to yesterday, the
 * chosen model re-trained on all data, forecast from today, new plan (≈ 30 s).
 * The dashboard keeps showing the old forecast meanwhile and switches when the files change.
 *
 * Set AUTO_REFRESH=0 to switch this off, ENERGY_PYTHON to use another Python.
 */

const RETRY_MS = 30 * 60 * 1000;
let running = false;
let lastRun: Date | null = null;
let lastMessage = "";

/** Local date YYYY-MM-DD (the pipeline also uses the local date). */
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function python(): string {
  if (process.env.ENERGY_PYTHON) return process.env.ENERGY_PYTHON;
  const venv = join(ENERGY_DIR, ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}

function start(forecastStart: string) {
  running = true;
  lastRun = new Date();
  lastMessage = `Updating the forecast from ${forecastStart.slice(0, 10)} to today…`;
  console.log(`[refresh] ${lastMessage}`);
  const child = spawn(python(), ["run_pipeline.py", "--quick"], { cwd: ENERGY_DIR, stdio: ["ignore", "pipe", "pipe"] });
  let tail = "";
  const keep = (b: Buffer) => (tail = (tail + b.toString()).slice(-2000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.on("error", (e) => {
    running = false;
    lastMessage = `Could not start the pipeline (${e.message}). Run model-training/run_pipeline.py by hand.`;
    console.error(`[refresh] ${lastMessage}`);
  });
  child.on("close", (code) => {
    running = false;
    lastMessage = code === 0 ? "Forecast updated." : `Pipeline stopped with code ${code} — see the backend log.`;
    console.log(`[refresh] ${lastMessage}${code === 0 ? "" : `\n${tail}`}`);
  });
}

/** Freshness of the current forecast; starts a background refresh when it is not for today. */
export function freshness(forecastStart: string) {
  const today = localDate();
  const stale = Boolean(forecastStart) && forecastStart.slice(0, 10) < today;
  const tooSoon = lastRun !== null && Date.now() - lastRun.getTime() < RETRY_MS;
  if (stale && !running && !tooSoon && process.env.AUTO_REFRESH !== "0") start(forecastStart);
  const message = running
    ? lastMessage
    : stale
      ? lastRun
        ? `${lastMessage} Still showing the forecast from ${forecastStart.slice(0, 10)} (no internet?). Next try in 30 min.`
        : `Forecast is from ${forecastStart.slice(0, 10)}.`
      : `Forecast for today (${today}).`;
  return { forecastStart, today, stale, refreshing: running, lastRun: lastRun?.toISOString() ?? null, message };
}
