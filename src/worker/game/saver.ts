// Serialises saves for one player: at most one RPC in flight, and the latest snapshot always
// wins, so saves reach HomeRoom in order and a burst of changes costs at most two calls.

export type SaveOutcome = "saved" | "stale" | "error";

export class CoalescingSaver<T> {
  private running: Promise<SaveOutcome> | null = null;
  private pending: (() => T) | null = null;
  private waiters: ((o: SaveOutcome) => void)[] = [];

  constructor(private readonly write: (snapshot: T) => Promise<boolean>) {}

  /**
   * Schedules a save of `snapshot()` (evaluated when the write starts, so it is the latest
   * state). Resolves once a write that includes this request has finished.
   */
  request(snapshot: () => T): Promise<SaveOutcome> {
    this.pending = snapshot;
    const done = new Promise<SaveOutcome>((resolve) => this.waiters.push(resolve));
    if (!this.running) this.running = this.drain();
    return done;
  }

  get busy(): boolean {
    return this.running !== null;
  }

  private async drain(): Promise<SaveOutcome> {
    let outcome: SaveOutcome = "saved";
    while (this.pending) {
      const snap = this.pending();
      const waiters = this.waiters;
      this.pending = null;
      this.waiters = [];
      try {
        outcome = (await this.write(snap)) ? "saved" : "stale";
      } catch {
        outcome = "error";
      }
      for (const w of waiters) w(outcome);
      if (outcome === "stale") {
        // Lease lost: nothing later can succeed either.
        for (const w of this.waiters) w("stale");
        this.waiters = [];
        this.pending = null;
      }
    }
    this.running = null;
    return outcome;
  }
}

export const SAVE_DEBOUNCE_MS = 250;

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as Parameters<typeof clearTimeout>[0]),
};

/**
 * Coalesces bursts of save requests (mining, selling, loot) into one call `delayMs` after the
 * first. Anything that needs the save to land now (zone exit, leave) cancels it and saves directly.
 */
export class SaveDebouncer {
  private handle: unknown = null;

  constructor(
    private readonly fire: () => void,
    private readonly delayMs = SAVE_DEBOUNCE_MS,
    private readonly timers: Timers = realTimers,
  ) {}

  schedule(): void {
    if (this.handle !== null) return;
    this.handle = this.timers.set(() => {
      this.handle = null;
      this.fire();
    }, this.delayMs);
  }

  cancel(): void {
    if (this.handle === null) return;
    this.timers.clear(this.handle);
    this.handle = null;
  }

  get pending(): boolean {
    return this.handle !== null;
  }
}
