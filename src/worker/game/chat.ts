// Per-player chat guard: rate limit plus a mute for repeating yourself, including alternating
// between two lines. Guards live per userId at zone level so reconnecting doesn't lift a mute.
import { CHAT_MIN_INTERVAL_MS } from "../env";

/** How many recent lines are compared. */
export const REPEAT_LIMIT = 5;
/** A full history with this many distinct lines or fewer counts as spam ("a b a b a"). */
export const MAX_DISTINCT_IN_HISTORY = 2;
export const MUTE_MS = 60_000;
/** Idle guards (not muted, no recent line) are forgotten after this long. */
export const GUARD_TTL_MS = 10 * 60_000;

export type ChatVerdict = "ok" | "tooFast" | "muted";

export class ChatGuard {
  private lastAt = -Infinity;
  private history: string[] = [];
  private mutedUntil = 0;

  check(text: string, now: number): ChatVerdict {
    if (now < this.mutedUntil) return "muted";
    if (now - this.lastAt < CHAT_MIN_INTERVAL_MS) return "tooFast";
    this.lastAt = now;
    this.history.push(text.trim().toLowerCase());
    if (this.history.length > REPEAT_LIMIT) this.history.shift();
    if (this.history.length === REPEAT_LIMIT && new Set(this.history).size <= MAX_DISTINCT_IN_HISTORY) {
      this.mutedUntil = now + MUTE_MS;
      this.history = [];
      return "muted";
    }
    return "ok";
  }

  /** Restores a mute persisted across a Durable Object restart. */
  muteUntil(until: number): void {
    this.mutedUntil = Math.max(this.mutedUntil, until);
  }

  mutedFor(now: number): number {
    return Math.max(0, this.mutedUntil - now);
  }

  /** True once nothing about this guard matters any more. */
  expired(now: number): boolean {
    return now >= this.mutedUntil && now - this.lastAt > GUARD_TTL_MS;
  }
}

/** One ChatGuard per userId, pruned lazily. */
export class ChatGuards {
  private guards = new Map<string, ChatGuard>();
  private lastPrune = 0;

  get(userId: string, now: number): ChatGuard {
    if (now - this.lastPrune > GUARD_TTL_MS) this.prune(now);
    let g = this.guards.get(userId);
    if (!g) {
      g = new ChatGuard();
      this.guards.set(userId, g);
    }
    return g;
  }

  get size(): number {
    return this.guards.size;
  }

  prune(now: number): void {
    this.lastPrune = now;
    for (const [k, g] of this.guards) if (g.expired(now)) this.guards.delete(k);
  }
}
