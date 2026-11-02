// When does a player count as away (AFK)? Pure: the caller passes `now` and the tab's visibility,
// so tests drive it without a DOM or real timers. game/afk.ts wires it to the browser.

/** No keyboard, mouse, wheel or touch input for this long while the tab is showing. */
export const AFK_IDLE_MS = 3 * 60_000;
/**
 * The tab has been hidden this long. Long enough that a quick alt-tab to answer a message or
 * check a guide keeps you connected, short enough that a forgotten background tab stops talking
 * to the server within half a minute. Background timers still fire at this range (browsers only
 * clamp them to about once a second until a tab has been hidden for five minutes).
 */
export const AFK_HIDDEN_MS = 30_000;

export interface AfkTimes {
  idleMs: number;
  hiddenMs: number;
}

export const DEFAULT_AFK_TIMES: AfkTimes = { idleMs: AFK_IDLE_MS, hiddenMs: AFK_HIDDEN_MS };

export interface AfkTracker {
  /** The player pressed, moved, scrolled or touched something. */
  input(now: number): void;
  /** The tab was hidden or shown. Coming back to the tab counts as input. */
  visibility(hidden: boolean, now: number): void;
  /** Away at `now`? */
  away(now: number): boolean;
  /** Milliseconds from `now` until the player would count as away (0 when already away). */
  msLeft(now: number): number;
  /** Start counting afresh (after resuming), with the tab's current visibility. */
  reset(now: number, hidden: boolean): void;
  setTimes(times: AfkTimes): void;
}

export function createAfkTracker(now: number, hidden: boolean, times: AfkTimes = DEFAULT_AFK_TIMES): AfkTracker {
  let t = { ...times };
  let lastInput = now;
  let hiddenSince: number | null = hidden ? now : null;

  const deadline = (): number => {
    const idle = lastInput + t.idleMs;
    return hiddenSince === null ? idle : Math.min(idle, hiddenSince + t.hiddenMs);
  };

  return {
    input(at) {
      if (at > lastInput) lastInput = at;
    },
    visibility(h, at) {
      if (h) {
        if (hiddenSince === null) hiddenSince = at;
        return;
      }
      hiddenSince = null;
      if (at > lastInput) lastInput = at;
    },
    away: (at) => at >= deadline(),
    msLeft: (at) => Math.max(0, deadline() - at),
    reset(at, h) {
      lastInput = at;
      hiddenSince = h ? at : null;
    },
    setTimes(next) {
      t = { ...next };
    },
  };
}

/**
 * Dev servers only (welcome.devTools): `?afk=<idle s>` or `?afk=<idle s>,<hidden s>` in the page
 * URL shortens the timers so a playtest doesn't wait three minutes. Production ignores it.
 */
export function afkTimesFromQuery(search: string, devTools: boolean): AfkTimes | null {
  if (!devTools) return null;
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get("afk");
  } catch {
    return null;
  }
  if (!raw) return null;
  const [idle, hidden] = raw.split(",").map((s) => Number(s.trim()));
  if (idle === undefined || !Number.isFinite(idle) || idle <= 0) return null;
  const sec = (s: number) => Math.round(Math.min(Math.max(s, 1), 3600) * 1000);
  const idleMs = sec(idle);
  const hiddenMs = hidden !== undefined && Number.isFinite(hidden) && hidden > 0 ? sec(hidden) : Math.min(AFK_HIDDEN_MS, idleMs);
  return { idleMs, hiddenMs };
}
