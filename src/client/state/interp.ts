// Snapshot interpolation helpers for remote entities.
import type { Interpolate } from "../contracts";
import type { EntityState } from "../../shared/types";

/** Remote entities are drawn this far behind the newest snapshot so there are two to blend between. */
export const INTERP_DELAY_MS = 100;
/** Past the newest snapshot we extrapolate at most this long, then hold. */
export const MAX_EXTRAPOLATE_MS = 100;
/** Jumps longer than this (tiles) are teleports/respawns: snap instead of sliding. */
export const SNAP_DIST = 3;
/** Snapshot history kept per entity. */
export const HISTORY_MS = 1000;

export interface Snapshot {
  at: number; // recv-clock ms
  s: EntityState;
}

/** Lerp position; discrete fields (facing, moving, status, hp...) come from b. */
export const interpolate: Interpolate = (a, b, t) => {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
  if (Math.hypot(b.x - a.x, b.y - a.y) > SNAP_DIST) return { ...b };
  return { ...b, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
};

/** Entity state at time `at` from a time-ordered snapshot buffer (non-empty). */
export function sampleBuffer(buf: readonly Snapshot[], at: number): EntityState {
  const first = buf[0]!;
  if (buf.length === 1 || at <= first.at) return { ...first.s };
  const last = buf[buf.length - 1]!;
  if (at >= last.at) return extrapolate(buf[buf.length - 2]!, last, at);
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1]!.at > at) i--;
  const a = buf[i - 1]!;
  const b = buf[i]!;
  const span = b.at - a.at;
  return interpolate(a.s, b.s, span > 0 ? (at - a.at) / span : 1);
}

function extrapolate(prev: Snapshot, last: Snapshot, at: number): EntityState {
  const out = { ...last.s };
  const span = last.at - prev.at;
  const dx = last.s.x - prev.s.x;
  const dy = last.s.y - prev.s.y;
  if (!last.s.moving || span <= 0 || Math.hypot(dx, dy) > SNAP_DIST) return out;
  const ahead = Math.min(at - last.at, MAX_EXTRAPOLATE_MS);
  out.x += (dx / span) * ahead;
  out.y += (dy / span) * ahead;
  return out;
}
