import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* Plain-language explanations shown behind a small ⓘ next to technical words. */

export const GLOSSARY = {
  forecast: "A prediction of how much electricity the house will use, made by a model that learned from a year of your past use, the weather forecast and who is expected home.",
  range: "The real value will most likely fall between these two numbers. Past forecasts were this accurate.",
  peak: "The busiest hours — when the house uses the most electricity at once. Avoiding extra appliances then saves money.",
  tariff: "The price per kWh. It changes during the day: €0.18 at night (00–06), €0.28 during the day, €0.40 in the evening peak (17–22).",
  heatAhead: "Heating a little more while electricity is cheap. The house stores the warmth, like a battery.",
  coast: "The heating rests while electricity is expensive. The stored warmth keeps the house comfortable.",
  plan: "The optimiser picks the cheapest times for heating and appliances, while keeping the house at your chosen comfort.",
  comfort: "The indoor temperature range you accept. The optimiser keeps the house inside it. A wider range lets the heat pump heat earlier, while electricity is cheaper, and rest during the evening peak.",
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;

const TIP_WIDTH = 240;

export function Info({ term, label }: { term: GlossaryKey; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  // The tip is drawn on top of the page (portal, fixed position) so no card can clip it,
  // and it is kept inside the screen on every side.
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      const left = Math.min(Math.max(8, r.left + r.width / 2 - TIP_WIDTH / 2), window.innerWidth - TIP_WIDTH - 8);
      const above = r.bottom + 140 > window.innerHeight;
      setPos({ left, top: above ? r.top - 6 : r.bottom + 6, above });
    }
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <span className="inline-flex align-middle normal-case" onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button
        ref={ref}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else show();
        }}
        onBlur={() => setOpen(false)}
        aria-label={`What does ${label ?? term} mean?`}
        aria-expanded={open}
        className="ml-1 inline-grid h-4 w-4 place-items-center rounded-full opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="8" cy="4.8" r="1" fill="currentColor" />
          <rect x="7.2" y="6.8" width="1.6" height="5" rx="0.8" fill="currentColor" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <span
            role="tooltip"
            className="panel animate-fade-up fixed z-[100] px-3 py-2 text-left text-xs font-normal normal-case leading-snug tracking-normal text-foreground shadow-xl"
            style={{
              left: pos.left,
              top: pos.top,
              width: TIP_WIDTH,
              transform: pos.above ? "translateY(-100%)" : undefined,
              animationDuration: "0.25s",
              pointerEvents: "none",
            }}
          >
            {GLOSSARY[term]}
          </span>,
          document.body,
        )}
    </span>
  );
}
