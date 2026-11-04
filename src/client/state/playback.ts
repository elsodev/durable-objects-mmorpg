// Jitter buffer clock for remote entities. Ticks carry the server time they describe (`at`);
// drawing at a server time a little behind the newest one means there is almost always a later
// snapshot to blend toward, however unevenly the packets arrive. Stamping snapshots with their
// arrival time instead turned every late or bunched packet into a visible hitch.
import { TICK_MS } from "../../shared/types";

/** Samples kept to judge latency and jitter (10 Hz ticks: about the last 6 s). */
export const PLAYBACK_WINDOW = 60;
/** Never draw closer than one tick behind the fastest packets (there'd be nothing to blend to). */
export const MIN_DELAY_MS = TICK_MS;
/** However bad the link, don't draw others further behind than this. */
export const MAX_DELAY_MS = 350;
/** Extra room on top of the measured jitter. */
const MARGIN_MS = 15;
/** The drawn clock may run this much faster or slower than real time while it adjusts. */
const MAX_WARP = 0.1;
/** Further off than this (tab was hidden, clock jumped): jump instead of easing. */
const SNAP_MS = 1000;

export interface Playback {
  /** A snapshot stamped `serverAt` arrived at local time `recvAt`. */
  observe(serverAt: number, recvAt: number): void;
  /** Server time to draw others at, for local time `now` (moves smoothly, never backwards). */
  time(now: number): number;
  /** How far behind the fastest packets others are drawn (ms). */
  delay(): number;
  reset(): void;
}

/** The q-quantile (0..1) of `xs` (non-empty). */
function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

export function createPlayback(): Playback {
  /** recvAt - serverAt per sample: one-way latency plus the (unknown, fixed) clock offset. */
  let lags: number[] = [];
  let base = 0;
  let delay = MIN_DELAY_MS;
  let drawn: { now: number; at: number } | null = null;

  return {
    observe(serverAt, recvAt) {
      if (!Number.isFinite(serverAt) || !Number.isFinite(recvAt)) return;
      lags.push(recvAt - serverAt);
      if (lags.length > PLAYBACK_WINDOW) lags.shift();
      // The fastest recent packet is the route's real latency; the rest is jitter on top.
      base = Math.min(...lags);
      const jitter = lags.length >= 5 ? quantile(lags, 0.95) - base : 0;
      delay = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, TICK_MS + jitter + MARGIN_MS));
    },
    time(now) {
      const target = now - base - delay;
      if (!drawn || Math.abs(target - drawn.at) > SNAP_MS || lags.length === 0) {
        drawn = { now, at: target };
        return target;
      }
      const dt = now - drawn.now;
      if (dt <= 0) return drawn.at;
      const next = drawn.at + dt;
      // Ease toward the target by speeding up or slowing down a little, never by jumping.
      const at = next + Math.max(-MAX_WARP * dt, Math.min(MAX_WARP * dt, target - next));
      drawn = { now, at };
      return at;
    },
    delay: () => delay,
    reset() {
      lags = [];
      base = 0;
      delay = MIN_DELAY_MS;
      drawn = null;
    },
  };
}
