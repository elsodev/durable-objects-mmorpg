/** Estimates ping round trips and serverTime - localTime from ping/pong pairs. */
export interface ClockSync {
  /** A pong arrived at local time `now` for a ping sent at `sentAt`. */
  pong(sentAt: number, serverTime: number, now: number): void;
  /** Coarse offset from a welcome frame; only used until the first pong. */
  hint(serverTime: number, now: number): void;
  rtt(): number;
  offset(): number;
  reset(): void;
}

/** Samples kept (pings go out every 2 s, so about the last 16 s). */
export const RTT_WINDOW = 8;
const MAX_RTT_MS = 30_000;

/**
 * Pongs are read on the main thread, so a sample also counts any frame or asset decode that was
 * running when it arrived (a slow software-rendered frame adds 50-150 ms). Those delays only ever
 * ADD time, so the smallest recent round trip is the best estimate of the network, and the offset
 * from that same sample is the least skewed (NTP picks its sample the same way).
 */
export function createClockSync(): ClockSync {
  let samples: { rtt: number; offset: number }[] = [];
  let hinted: number | null = null;
  const best = () => {
    let b = samples[0];
    for (const s of samples) if (b && s.rtt < b.rtt) b = s;
    return b;
  };
  return {
    pong(sentAt, serverTime, now) {
      const rtt = now - sentAt;
      if (!Number.isFinite(rtt) || !Number.isFinite(serverTime) || rtt < 0 || rtt > MAX_RTT_MS) return;
      // Server stamped serverTime roughly half a round trip before we received it.
      samples.push({ rtt, offset: serverTime + rtt / 2 - now });
      if (samples.length > RTT_WINDOW) samples.shift();
    },
    hint(serverTime, now) {
      if (samples.length > 0 || hinted !== null || !Number.isFinite(serverTime)) return;
      hinted = serverTime - now;
    },
    rtt: () => best()?.rtt ?? 0,
    offset: () => best()?.offset ?? hinted ?? 0,
    reset() {
      samples = [];
      hinted = null;
    },
  };
}
