// Storage normalisation for the home simulation (clock, vitals).
import { newClock, type HomeClock } from "../../shared/engine";

const MAX_DAY = 1_000_000;

/** A stored clock, or a fresh day 1 starting now. A start in the future is pulled back to now. */
export function sanitizeClock(v: unknown, now: number): HomeClock {
  const c = v as HomeClock | null | undefined;
  if (!c || typeof c !== "object") return newClock(now);
  const day = Number.isInteger(c.day) && c.day >= 1 && c.day <= MAX_DAY ? c.day : 1;
  const startAt = typeof c.startAt === "number" && Number.isFinite(c.startAt) ? Math.min(c.startAt, now) : now;
  return { day, startAt };
}
