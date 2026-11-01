// Frame loop on top of the Pixi ticker (structurally typed so this stays Pixi-free for tests).

/** Longest frame step we simulate; after a background tab we resume instead of teleporting. */
export const MAX_FRAME_MS = 100;

export function clampDt(dtMs: number): number {
  if (!Number.isFinite(dtMs) || dtMs < 0) return 0;
  return Math.min(dtMs, MAX_FRAME_MS);
}

export interface TickerLike {
  add(fn: (t: { deltaMS: number }) => void): unknown;
  remove(fn: (t: { deltaMS: number }) => void): unknown;
}

/** Calls frame(dtMs) every rendered frame; errors are logged (throttled) so one bad frame can't kill the ticker. */
export function startLoop(ticker: TickerLike, frame: (dtMs: number) => void, onError?: (err: unknown) => void): () => void {
  let lastErrorAt = -Infinity;
  const fn = (t: { deltaMS: number }) => {
    try {
      frame(clampDt(t.deltaMS));
    } catch (err) {
      const now = Date.now();
      if (now - lastErrorAt > 2000) {
        lastErrorAt = now;
        (onError ?? console.error)(err);
      }
    }
  };
  ticker.add(fn);
  return () => {
    ticker.remove(fn);
  };
}

/** Accumulator for "every N ms" work inside the frame loop (ping display, crop refresh). */
export function every(periodMs: number, fn: () => void): (dtMs: number) => void {
  let acc = 0;
  return (dtMs) => {
    acc += dtMs;
    if (acc >= periodMs) {
      acc %= periodMs;
      fn();
    }
  };
}
