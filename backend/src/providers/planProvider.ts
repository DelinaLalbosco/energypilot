import { buildPlan } from "../domain/plan";
import type { PlanResponse } from "../../../shared/types";

export async function getPlan(nowHour: number, pvKwp: number, comfort?: string): Promise<PlanResponse> {
  // Reads the Python pipeline outputs (model-training/output/*.csv) and re-solves the
  // schedule for the requested PV size.
  return buildPlan(nowHour, pvKwp, comfort);
}
