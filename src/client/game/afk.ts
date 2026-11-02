// Browser side of the AFK check (rules in afk-logic.ts): listens for any input and for the tab
// being hidden, and calls onAway once when the player counts as away. One timeout at a time,
// aimed at the next deadline, so an active player costs a timestamp write per event and nothing more.
import { createAfkTracker, DEFAULT_AFK_TIMES, type AfkTimes } from "./afk-logic";

export interface AfkWatch {
  /** Begin watching (the game is on screen). Calling it again is a no-op. */
  start(): void;
  /** The player came back: count afresh from now. */
  resume(): void;
  setTimes(times: AfkTimes): void;
  destroy(): void;
}

export interface AfkWatchOpts {
  onAway(): void;
  /** While true (character creator, account form) the player is never sent away. */
  blocked?(): boolean;
}

const INPUT_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"] as const;

export function createAfkWatch(opts: AfkWatchOpts): AfkWatch {
  const hidden = () => document.visibilityState === "hidden";
  const tracker = createAfkTracker(Date.now(), hidden(), DEFAULT_AFK_TIMES);
  let running = false;
  let away = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const check = () => {
    timer = null;
    if (!running || away) return;
    const now = Date.now();
    if (tracker.away(now)) {
      if (opts.blocked?.()) {
        // Busy somewhere that must not be interrupted: treat it as activity and look again later.
        tracker.reset(now, hidden());
      } else {
        away = true;
        opts.onAway();
        return;
      }
    }
    // +50 ms so a timer that fires a hair early doesn't spin.
    timer = setTimeout(check, tracker.msLeft(now) + 50);
  };

  const onInput = () => {
    if (running && !away) tracker.input(Date.now());
  };
  const onVisibility = () => {
    if (!running || away) return;
    tracker.visibility(hidden(), Date.now());
    clear();
    check();
  };

  return {
    start() {
      if (running) return;
      running = true;
      tracker.reset(Date.now(), hidden());
      for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { capture: true, passive: true });
      document.addEventListener("visibilitychange", onVisibility);
      check();
    },
    resume() {
      away = false;
      tracker.reset(Date.now(), hidden());
      clear();
      if (running) check();
    },
    setTimes(times) {
      tracker.setTimes(times);
      clear();
      if (running && !away) check();
    },
    destroy() {
      running = false;
      clear();
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
