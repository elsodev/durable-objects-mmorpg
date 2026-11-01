// Per-socket message rate limit for both Durable Objects. A token bucket lets normal play
// through (held keys resend every 100 ms, plus pings and clicks); a socket that keeps hitting
// the limit is closed.

export const BUCKET_BURST = 40;
export const BUCKET_PER_SEC = 20;
/** Dropped messages tolerated inside ABUSE_WINDOW_MS before the socket is closed. */
export const ABUSE_DROPS = 100;
export const ABUSE_WINDOW_MS = 10_000;
/** At most one reject per this interval, so a flood doesn't get an equal flood back. */
export const REJECT_EVERY_MS = 1000;
export const CLOSE_ABUSE = 4429;

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly burst: number,
    private readonly perSec: number,
    now: number,
  ) {
    this.tokens = burst;
    this.last = now;
  }

  /** Spends one token if available. */
  take(now: number): boolean {
    const elapsed = Math.max(0, now - this.last);
    this.last = Math.max(this.last, now);
    this.tokens = Math.min(this.burst, this.tokens + (elapsed * this.perSec) / 1000);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** "reject": drop and tell the client; "drop": drop silently; "close": end the socket. */
export type LimitVerdict = "ok" | "reject" | "drop" | "close";

export class SocketLimiter {
  private readonly bucket: TokenBucket;
  private drops = 0;
  private windowStart: number;
  private lastReject = -Infinity;

  constructor(now: number) {
    this.bucket = new TokenBucket(BUCKET_BURST, BUCKET_PER_SEC, now);
    this.windowStart = now;
  }

  check(now: number): LimitVerdict {
    if (this.bucket.take(now)) return "ok";
    if (now - this.windowStart > ABUSE_WINDOW_MS) {
      this.windowStart = now;
      this.drops = 0;
    }
    if (++this.drops >= ABUSE_DROPS) return "close";
    if (now - this.lastReject < REJECT_EVERY_MS) return "drop";
    this.lastReject = now;
    return "reject";
  }
}
