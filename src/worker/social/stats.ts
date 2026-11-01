// Server-wide "today" counters (UTC day), fed by other Durable Objects through SocialRoom.recordStat.
// Pure: SocialRoom persists `toJSON()` and restores with `DailyStats.from()`.

export const STAT_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const MAX_STAT_STEP = 10_000;
export const MAX_STAT_KEYS = 32;

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export interface DailyStatsData {
  day: string;
  counts: Record<string, number>;
}

export class DailyStats {
  private day: string;
  private counts: Record<string, number>;

  private constructor(data: DailyStatsData) {
    this.day = data.day;
    this.counts = data.counts;
  }

  static from(raw: unknown, now: number): DailyStats {
    const o = raw && typeof raw === "object" ? (raw as Partial<DailyStatsData>) : {};
    const counts: Record<string, number> = {};
    if (o.counts && typeof o.counts === "object") {
      for (const [k, v] of Object.entries(o.counts)) {
        if (STAT_KEY_RE.test(k) && typeof v === "number" && Number.isFinite(v) && v >= 0) counts[k] = Math.floor(v);
      }
    }
    const day = typeof o.day === "string" ? o.day : utcDay(now);
    return new DailyStats({ day, counts });
  }

  /** Adds `n` to `key` for today. Returns false (ignored) for bad keys or amounts. */
  record(key: unknown, n: unknown, now: number): boolean {
    if (typeof key !== "string" || !STAT_KEY_RE.test(key)) return false;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_STAT_STEP) return false;
    this.roll(now);
    if (!Object.hasOwn(this.counts, key) && Object.keys(this.counts).length >= MAX_STAT_KEYS) return false;
    this.counts[key] = (this.counts[key] ?? 0) + n;
    return true;
  }

  snapshot(now: number): DailyStatsData {
    this.roll(now);
    return { day: this.day, counts: { ...this.counts } };
  }

  toJSON(): DailyStatsData {
    return { day: this.day, counts: { ...this.counts } };
  }

  private roll(now: number): void {
    const d = utcDay(now);
    if (d !== this.day) {
      this.day = d;
      this.counts = {};
    }
  }
}
