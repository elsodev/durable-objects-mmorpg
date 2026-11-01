/** Exponential backoff with jitter: base * 2^attempt capped at max, scaled into [0.5, 1) of that. */
export interface BackoffOpts {
  baseMs?: number;
  maxMs?: number;
}

export function backoffDelay(attempt: number, rand: () => number, opts: BackoffOpts = {}): number {
  const base = opts.baseMs ?? 500;
  const max = opts.maxMs ?? 10_000;
  const ceiling = Math.min(max, base * 2 ** Math.max(0, Math.min(attempt, 30)));
  return Math.round(ceiling * (0.5 + 0.5 * rand()));
}
