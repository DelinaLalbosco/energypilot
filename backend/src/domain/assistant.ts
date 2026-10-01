import Anthropic from "@anthropic-ai/sdk";
import { offlineAnswer, planContext, type ChatTurn } from "../../../shared/assistant";
import { SCENARIO, type PlanResponse } from "../../../shared/types";

/*
 * "Ask EnergyPilot": answers questions about the household's energy plan with Claude.
 * Without ANTHROPIC_API_KEY (or if the API fails) it answers with the rule-based
 * offlineAnswer() from the same data, so the button always works.
 */

export type AskResult = { answer: string; source: "claude" | "offline"; note?: string };

const MODEL = process.env.ASSISTANT_MODEL || "claude-opus-5";
let client: Anthropic | null = null;

function systemPrompt(plan: PlanResponse): string {
  return `You are EnergyPilot, a friendly home-energy assistant inside a dashboard for ${SCENARIO.household.name}.
Answer questions about their electricity use, costs, the forecast, the optimised plan, heating comfort and solar panels.
Use only the facts in the household data below; if something is not in the data, say so and suggest what they could check.
Write for non-experts: short answers (2-5 sentences or a short list), concrete hours and ${SCENARIO.currency} amounts, no jargon.
Use **bold** for the key number or hour. Never give financial investment advice beyond the payback figures in the data.

<household_data>
${planContext(plan)}
</household_data>`;
}

export async function ask(plan: PlanResponse, question: string, history: ChatTurn[]): Promise<AskResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { answer: offlineAnswer(plan, question), source: "offline", note: "No ANTHROPIC_API_KEY set on the server — answered from the rules." };
  }
  client ??= new Anthropic();

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: systemPrompt(plan), cache_control: { type: "ephemeral" } }],
      messages: [...history.slice(-10).map((t) => ({ role: t.role, content: t.content })), { role: "user", content: question }],
    });

    if (response.stop_reason === "refusal") {
      return { answer: "Sorry, I can't help with that one. Try asking about your energy use, costs, heating or solar.", source: "claude" };
    }
    const answer = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return { answer: answer || offlineAnswer(plan, question), source: answer ? "claude" : "offline" };
  } catch (error) {
    let note = "Claude is unavailable — answered from the rules.";
    if (error instanceof Anthropic.AuthenticationError) note = "The API key was rejected — answered from the rules.";
    else if (error instanceof Anthropic.RateLimitError) note = "Claude is busy (rate limit) — answered from the rules.";
    else if (error instanceof Anthropic.APIError) note = `Claude API error ${error.status ?? ""} — answered from the rules.`;
    console.error("assistant:", error);
    return { answer: offlineAnswer(plan, question), source: "offline", note };
  }
}
