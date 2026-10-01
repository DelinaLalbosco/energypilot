import plans from "../../../data/sample/energy-plans.json";
import type { PlanResponse } from "./contract";

// Snapshot of the backend output for every PV size and comfort level, keyed "pv|comfort"
// (see backend/scripts/export-sample.ts).
const byKey = plans as unknown as Record<string, PlanResponse>;

export async function mockGetPlan(nowHour: number, pvKwp?: number, comfort?: string): Promise<PlanResponse> {
  const first = Object.values(byKey)[0];
  const pv = pvKwp ?? first.scenario.solar.defaultKwp;
  const level = comfort ?? first.scenario.defaultComfort;
  const plan = structuredClone(
    byKey[`${pv}|${level}`] ?? Object.entries(byKey).find(([k]) => k.startsWith(`${pv}|`))?.[1] ?? first,
  );
  plan.nowHour = nowHour;
  return plan;
}
