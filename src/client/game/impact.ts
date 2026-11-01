// Holds server results of tool swings until the swing's impact frame (pure, unit-tested).
// The server applies a hoe, can, pickaxe or axe hit the moment the `use` arrives and stamps the
// message with `impactAt` (see ImpactStamp). Applying it on arrival would show the soil or chips
// before the tool comes down, so the session queues it here:
// - your own swing: until your local swing's impact (your prediction lands then too);
// - someone else's: until their impact on the server clock, plus the delay their swing is drawn
//   behind (interpolation, the tick it rides in, half the round trip).
import type { ImpactStamp } from "../../shared/protocol";

/** Never hold a result longer than this (a clock jump must not freeze the farm). */
export const MAX_HOLD_MS = 1000;

export interface DueContext {
  youId: string | null;
  /** performance.now(). */
  nowMs: number;
  /** Server clock now (ms). */
  serverNow: number;
  /** performance.now() time your current swing lands, or null when none is pending. */
  localImpactMs: number | null;
  /** How far behind the server other players' swings are drawn (ms). */
  remoteLagMs: number;
}

/** performance.now() time to apply a stamped message (now for messages that carry no stamp). */
export function impactDueMs(msg: ImpactStamp, c: DueContext): number {
  if (msg.impactAt === undefined || !Number.isFinite(msg.impactAt)) return c.nowMs;
  const wait =
    msg.by !== undefined && msg.by === c.youId
      ? (c.localImpactMs ?? c.nowMs) - c.nowMs
      : msg.impactAt - c.serverNow + c.remoteLagMs;
  return c.nowMs + Math.max(0, Math.min(MAX_HOLD_MS, wait));
}

/** Messages waiting for their impact, applied in arrival order. */
export class ImpactQueue<T> {
  private items: { due: number; item: T }[] = [];

  push(due: number, item: T): void {
    this.items.push({ due, item });
  }

  /**
   * Removes and returns what is due by `nowMs`, in arrival order. An item waits behind an earlier
   * one that isn't due yet when `sameLane` says they touch the same thing (so a later hit on a rock
   * never shows before an earlier one).
   */
  take(nowMs: number, sameLane: (a: T, b: T) => boolean = () => false): T[] {
    if (this.items.length === 0) return [];
    const out: T[] = [];
    const held: { due: number; item: T }[] = [];
    for (const e of this.items) {
      if (e.due <= nowMs && !held.some((h) => sameLane(h.item, e.item))) out.push(e.item);
      else held.push(e);
    }
    this.items = held;
    return out;
  }

  /** Removes and returns everything still waiting (in arrival order). */
  flush(): T[] {
    const out = this.items.map((e) => e.item);
    this.items = [];
    return out;
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }
}
