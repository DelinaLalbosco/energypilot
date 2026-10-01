/*
 * Slow click feedback for every button:
 *   - a soft ripple spreads from the click point and fades (clipped to the button's shape)
 *   - the button gently presses in and springs back
 * The ripple lives in a fixed overlay, so buttons keep their own layout and positioning.
 * Disabled when the user prefers reduced motion.
 */

const RIPPLE_MS = 800;
const PRESS_MS = 500;

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function ripple(button: HTMLElement, x: number, y: number) {
  const rect = button.getBoundingClientRect();
  const style = getComputedStyle(button);

  // Overlay with the button's size and corner radius, so the ripple stays inside the button.
  const clip = document.createElement("span");
  clip.className = "click-ripple-clip";
  Object.assign(clip.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: style.borderRadius,
  });

  const size = Math.hypot(rect.width, rect.height) * 2;
  const dot = document.createElement("span");
  dot.className = "click-ripple";
  Object.assign(dot.style, {
    width: `${size}px`,
    height: `${size}px`,
    left: `${x - rect.left - size / 2}px`,
    top: `${y - rect.top - size / 2}px`,
    background: `color-mix(in oklch, ${style.color} 35%, transparent)`,
    animationDuration: `${RIPPLE_MS}ms`,
  });

  clip.appendChild(dot);
  document.body.appendChild(clip);
  window.setTimeout(() => clip.remove(), RIPPLE_MS + 50);
}

function press(button: HTMLElement) {
  button.classList.remove("click-press");
  // Restart the animation if the button is clicked again quickly.
  void button.offsetWidth;
  button.classList.add("click-press");
  window.setTimeout(() => button.classList.remove("click-press"), PRESS_MS + 50);
}

export function installClickEffects() {
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || reducedMotion()) return;
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLElement>("button, [role='button']");
      if (!button || (button as HTMLButtonElement).disabled) return;
      ripple(button, event.clientX, event.clientY);
      press(button);
    },
    { passive: true },
  );
}
