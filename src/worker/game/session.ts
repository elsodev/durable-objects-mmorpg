// Periodic re-validation of the Better Auth session behind a long-lived socket, so a revoked or
// expired session (sign-out, password change, cleanup) can't keep playing.
import type { Env } from "../env";
import { parseDbDate } from "../cron";

export const SESSION_RECHECK_MS = 5 * 60_000;
/** Close code for "session ended": the client treats it like 4401 and asks to sign in. */
export const CLOSE_SESSION_ENDED = 4401;

/** True when a re-check is due. `checkedAt` is the last check (or connect) time. */
export function recheckDue(checkedAt: number, now: number): boolean {
  return now - checkedAt >= SESSION_RECHECK_MS;
}

export type SessionRow = { userId: unknown; expiresAt: unknown } | null;

/** A missing row, another user's row or an expired one is not valid; unreadable dates are (fail open on format, not on absence). */
export function sessionRowValid(row: SessionRow, userId: string, now: number): boolean {
  if (!row || row.userId !== userId) return false;
  const exp = parseDbDate(row.expiresAt);
  return exp === null || exp > now;
}

/** Looks the session up in D1. Network errors resolve true (don't kick players on a D1 blip). */
export async function sessionStillValid(env: Env, sessionId: string, userId: string, now: number): Promise<boolean> {
  try {
    const row = await env.DB.prepare(`SELECT userId, expiresAt FROM "session" WHERE id = ?`)
      .bind(sessionId)
      .first<{ userId: unknown; expiresAt: unknown }>();
    return sessionRowValid(row, userId, now);
  } catch {
    return true;
  }
}
