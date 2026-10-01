import type { PlanResponse } from "./contract";

const API_BASE = import.meta.env?.VITE_API_BASE_URL || "http://localhost:8787";

export async function realGetPlan(nowHour: number, pvKwp?: number, comfort?: string): Promise<PlanResponse> {
  const url = new URL("/api/plan", API_BASE);
  url.searchParams.set("now", String(nowHour));
  if (pvKwp !== undefined) url.searchParams.set("pv", String(pvKwp));
  if (comfort) url.searchParams.set("comfort", comfort);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Energy API returned ${response.status}`);
  return response.json() as Promise<PlanResponse>;
}

export type AskResponse = { answer: string; source: "claude" | "offline"; note?: string };

/** Asks the backend assistant (Claude when a key is configured, rules otherwise). */
export async function askAssistant(body: {
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  now: number;
  pv: number;
  comfort: string;
}): Promise<AskResponse> {
  const response = await fetch(new URL("/api/ask", API_BASE), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Assistant failed (${response.status})`);
  return result;
}
