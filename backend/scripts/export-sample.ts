import { writeFileSync } from "node:fs";

process.env.AUTO_REFRESH = "0"; // a snapshot must not start a pipeline run
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan } from "../src/domain/plan";
import { loadScenario } from "../src/providers/energyData";

// Snapshots the live plan for every PV option so the frontend mock mode shows real pipeline data.
const out = join(dirname(fileURLToPath(import.meta.url)), "../../data/sample/energy-plans.json");
// Keyed "pv|comfort" (e.g. "3|standard") for every PV size and comfort level.
const meta = loadScenario();
const comforts = meta.comfortLevels.length ? meta.comfortLevels.map((l) => l.id) : [undefined];
const plans: Record<string, unknown> = {};
for (const pv of meta.solar.options) {
  for (const c of comforts) {
    const plan = buildPlan(18, pv, c);
    plans[`${pv}|${plan.comfortLevel}`] = plan;
  }
}
writeFileSync(out, JSON.stringify(plans, null, 2) + "\n");
console.log(`Wrote ${out}`);
