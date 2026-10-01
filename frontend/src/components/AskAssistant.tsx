import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { PlanResponse } from "../data/contract";
import { askAssistant } from "../data/apiProvider";
import { SUGGESTED_QUESTIONS, offlineAnswer, type ChatTurn } from "../../../shared/assistant";

/*
 * "Ask EnergyPilot" chat. With the backend it asks Claude (when the server has an
 * ANTHROPIC_API_KEY); in mock / website mode or on errors it answers from the rules.
 */

type Message = ChatTurn & { source?: "claude" | "offline"; note?: string };

/** Minimal markdown: **bold** and line breaks. */
function renderText(text: string): ReactNode {
  return text.split("\n").map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith("**") && part.endsWith("**") ? <b key={j}>{part.slice(2, -2)}</b> : part))}
    </Fragment>
  ));
}

export function AskAssistant({ plan, mock, now }: { plan: PlanResponse; mock: boolean; now: number }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: `Hi! I know ${plan.scenario.household.name}'s forecast, prices, heating plan and solar options. Ask me anything about your energy.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history: ChatTurn[] = messages.slice(1).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setBusy(true);
    try {
      if (mock) throw new Error("offline");
      const r = await askAssistant({ question: q, history, now, pv: plan.pvKwp, comfort: plan.comfortLevel });
      setMessages((m) => [...m, { role: "assistant", content: r.answer, source: r.source, note: r.note }]);
    } catch (error) {
      await new Promise((r) => setTimeout(r, 350)); // a short "thinking" pause feels natural
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: offlineAnswer(plan, q),
          source: "offline",
          note: mock ? "Offline demo — answered from the rules." : "Backend unreachable — answered from the rules.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="max-h-[55vh] min-h-[16rem] space-y-3 overflow-y-auto rounded-lg border border-border bg-surface-raised p-3">
        {messages.map((m, i) => (
          <div key={i} className={`animate-fade-up flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 leading-relaxed shadow-sm ${
                m.role === "user" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border border-border bg-card"
              }`}
            >
              {m.role === "assistant" && <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">🤖 EnergyPilot</div>}
              {renderText(m.content)}
              {m.source && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {m.source === "claude" ? "✨ Answered by Claude" : "📏 Rule-based answer"}
                  {m.note ? ` · ${m.note}` : ""}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2 text-muted-foreground">
              <span className="inline-flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => send(q)}
            disabled={busy}
            className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] transition-all hover:-translate-y-0.5 hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about costs, the best time for appliances, heating, solar…"
          aria-label="Your question"
          className="min-w-0 flex-1 rounded-full border border-border bg-card px-4 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
