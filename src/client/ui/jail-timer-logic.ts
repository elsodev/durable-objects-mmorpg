// Pure view model for the jail countdown plate (ui/jail-timer.ts), tested in test/fe-jail.test.ts.
import { formatJailLeft, jailLeftMs } from "../../shared/jail";

/** The plate's text for a sentence ending at `until` (server ms), or null once free. */
export function jailTimerText(until: number | null, serverNow: number): string | null {
  const left = jailLeftMs(until, serverNow);
  return left > 0 ? `Released in ${formatJailLeft(left)}` : null;
}

/** Converts the server's `until` into this browser's clock (server time = local + offset). */
export function localUntil(until: number | null, serverTime: number, localNow: number): number | null {
  return until === null ? null : until - (serverTime - localNow);
}
