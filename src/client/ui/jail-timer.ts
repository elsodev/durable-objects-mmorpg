// Jail countdown (#jail-timer): a small iron-barred plate under the status panel while you serve
// jail time ("Released in 4:32"), from the server's { t: "jail" } message. Ticks once a second and
// hides itself when the time is up; the server lets you out of the cell on its own clock.
import { jailTimerText, localUntil } from "./jail-timer-logic";
import "./styles/jail.css";

export interface JailTimer {
  /** Sentence end in server ms (null: free) and the server's clock when it was sent. */
  set(until: number | null, serverTime: number): void;
  destroy(): void;
}

export function createJailTimer(root: HTMLElement, opts: { place(): { x: number; y: number } | null; now?(): number }): JailTimer {
  const now = (): number => (opts.now ? opts.now() : Date.now());
  const el = document.createElement("div");
  el.id = "jail-timer";
  el.className = "jail-timer";
  el.setAttribute("role", "status");
  el.hidden = true;
  const bars = document.createElement("span");
  bars.className = "jail-timer-bars";
  bars.setAttribute("aria-hidden", "true");
  const title = document.createElement("span");
  title.className = "jail-timer-title";
  title.textContent = "In jail";
  const left = document.createElement("span");
  left.className = "jail-timer-left";
  el.appendChild(bars);
  el.appendChild(title);
  el.appendChild(left);
  root.appendChild(el);

  let until: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  function render(): void {
    // Gone with an old HUD (sign-out rebuilds it), or free: stop ticking.
    const text = el.isConnected ? jailTimerText(until, now()) : null;
    if (!text) {
      el.hidden = true;
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    // Under the status panel, clear of the notices that stack at the top centre.
    const at = opts.place();
    el.style.left = at === null ? "" : `${Math.round(at.x)}px`;
    el.style.top = at === null ? "" : `${Math.round(at.y)}px`;
    left.textContent = text;
    el.hidden = false;
  }

  return {
    set(u, serverTime) {
      until = localUntil(u, serverTime, now());
      render();
      if (until !== null && !timer) timer = setInterval(render, 1000);
    },
    destroy() {
      if (timer) clearInterval(timer);
      el.remove();
    },
  };
}
