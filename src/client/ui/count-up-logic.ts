// Pure timing for the day-end "coins earned" count-up: fast at first, settling on the total.

/** How long the count takes: quick for small totals, never long enough to feel like a wait. */
export function countUpMs(target: number): number {
  const n = Math.abs(Math.round(target));
  if (n === 0) return 0;
  return Math.min(1400, 450 + n * 3);
}

/** The whole-coin value to show `elapsedMs` into a count towards `target` (ease-out cubic). */
export function countUpValue(target: number, elapsedMs: number, durationMs: number): number {
  const goal = Math.round(target);
  if (durationMs <= 0 || elapsedMs >= durationMs) return goal;
  const t = Math.max(0, elapsedMs) / durationMs;
  const eased = 1 - (1 - t) ** 3;
  return Math.trunc(goal * eased);
}
