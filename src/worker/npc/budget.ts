// AiBudget Durable Object: one global instance limiting NPC AI spend.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { checkConsume, isDay, parseDailyLimit, pruneBefore, utcDay, validUserId } from "./budget-logic";

export interface ConsumeRequest {
  userId: string;
  /** Estimated cost units (Workers AI neurons; Jev calls count as a fixed estimate). */
  units: number;
  /** UTC day "YYYY-MM-DD". */
  day: string;
}

export class AiBudget extends DurableObject<Env> {
  private sql: SqlStorage;
  private lastPrunedFor = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS day_total (day TEXT PRIMARY KEY, units REAL NOT NULL DEFAULT 0);
       CREATE TABLE IF NOT EXISTS user_day (day TEXT NOT NULL, user_id TEXT NOT NULL, replies INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (day, user_id));`,
    );
  }

  /**
   * Atomically checks and records: global daily units <= AI_DAILY_NEURONS and per-user daily AI replies <= 40.
   * Returns false (nothing recorded) if either limit would be exceeded.
   */
  async tryConsume(req: ConsumeRequest): Promise<boolean> {
    if (!req || !validUserId(req.userId) || !isDay(req.day)) return false;
    const { userId, day } = req;
    // Synchronous SQL inside one transaction: no other request can interleave between check and write.
    return this.ctx.storage.transactionSync(() => {
      this.prune(day);
      const globalUnits = this.one<{ units: number }>("SELECT units FROM day_total WHERE day = ?", day)?.units ?? 0;
      const userReplies =
        this.one<{ replies: number }>("SELECT replies FROM user_day WHERE day = ? AND user_id = ?", day, userId)?.replies ?? 0;
      const units = checkConsume({ globalUnits, userReplies, units: req.units, dailyLimit: parseDailyLimit(this.env.AI_DAILY_NEURONS) });
      if (units === null) return false;
      this.sql.exec(
        "INSERT INTO day_total (day, units) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET units = units + excluded.units",
        day,
        units,
      );
      this.sql.exec(
        "INSERT INTO user_day (day, user_id, replies) VALUES (?, ?, 1) ON CONFLICT(day, user_id) DO UPDATE SET replies = replies + 1",
        day,
        userId,
      );
      return true;
    });
  }

  async usage(day: string): Promise<{ units: number; users: number }> {
    if (!isDay(day)) return { units: 0, users: 0 };
    const units = this.one<{ units: number }>("SELECT units FROM day_total WHERE day = ?", day)?.units ?? 0;
    const users = this.one<{ n: number }>("SELECT COUNT(*) AS n FROM user_day WHERE day = ?", day)?.n ?? 0;
    return { units, users };
  }

  /** Drops days older than the keep window, once per new day seen. */
  private prune(day: string): void {
    // Never prune relative to a future day, so a bad caller clock can't wipe today's counters.
    const today = utcDay(Date.now());
    const anchor = day < today ? day : today;
    if (this.lastPrunedFor === anchor) return;
    const cutoff = pruneBefore(anchor);
    this.sql.exec("DELETE FROM day_total WHERE day < ?", cutoff);
    this.sql.exec("DELETE FROM user_day WHERE day < ?", cutoff);
    this.lastPrunedFor = anchor;
  }

  private one<T extends Record<string, SqlStorageValue>>(query: string, ...args: SqlStorageValue[]): T | undefined {
    const rows = this.sql.exec<T>(query, ...args).toArray();
    return rows[0];
  }
}
