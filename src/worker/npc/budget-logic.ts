// Pure budget rules for AiBudget, kept free of Workers APIs so they can be unit tested.

export const DEFAULT_DAILY_UNITS = 9000;
export const PER_USER_DAILY_REPLIES = 40;
/** A single request can't claim more than this (guards against a bad estimate draining the day). */
export const MAX_UNITS_PER_REQUEST = 200;
/** Days of history kept for usage(); older rows are pruned. */
export const KEEP_DAYS = 7;
const MAX_USER_ID = 128;

export function parseDailyLimit(v: string | undefined): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_UNITS;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(day: unknown): day is string {
  if (typeof day !== "string" || !DAY_RE.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** First day still kept when `day` is today (days before it are pruned). */
export function pruneBefore(day: string, keep = KEEP_DAYS): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (keep - 1));
  return d.toISOString().slice(0, 10);
}

export interface ConsumeCheck {
  /** Units already spent today, all users. */
  globalUnits: number;
  /** AI replies this user already got today. */
  userReplies: number;
  units: number;
  dailyLimit: number;
  perUserMax?: number;
}

/** Returns the cleaned unit count to record, or null when a limit would be exceeded or input is bad. */
export function checkConsume(c: ConsumeCheck): number | null {
  if (!Number.isFinite(c.units) || c.units < 0 || c.units > MAX_UNITS_PER_REQUEST) return null;
  if (c.userReplies + 1 > (c.perUserMax ?? PER_USER_DAILY_REPLIES)) return null;
  if (c.globalUnits + c.units > c.dailyLimit) return null;
  return c.units;
}

export function validUserId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= MAX_USER_ID;
}
