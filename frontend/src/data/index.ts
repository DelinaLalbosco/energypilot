import { mockGetPlan } from "./mockProvider";
import { realGetPlan } from "./apiProvider";
import type { PlanResponse } from "./contract";

const useMock = import.meta.env.VITE_USE_MOCK === "true";

/** pvKwp omitted → the scenario's default PV size. */
export async function getPlan(nowHour = 18, pvKwp?: number, comfort?: string): Promise<PlanResponse> {
  if (useMock) return mockGetPlan(nowHour, pvKwp, comfort);
  try {
    return await realGetPlan(nowHour, pvKwp, comfort);
  } catch (error) {
    console.warn("Real API failed; falling back to mock provider.", error);
    return mockGetPlan(nowHour, pvKwp, comfort);
  }
}

export type { PlanResponse } from "./contract";
