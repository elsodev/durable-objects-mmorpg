// Tiny per-key throttle for Durable Object message handlers (chat, moveTo, NPC talk).
// In-memory is fine here: a DO is single-threaded and owns all sockets of its zone.

export class Throttle {
  private last = new Map<string, number>();
  constructor(private readonly minIntervalMs: number) {}

  /** True (and records `now`) if `key` may act; false if it acted less than minIntervalMs ago. */
  allow(key: string, now: number): boolean {
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < this.minIntervalMs) return false;
    this.last.set(key, now);
    return true;
  }

  /** Forget a key (call on socket close so the map doesn't grow). */
  drop(key: string): void {
    this.last.delete(key);
  }
}
