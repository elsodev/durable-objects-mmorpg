// Daily cleanup: delete guest (anonymous) users idle for more than 30 days, wipe their HomeRoom
// delete their uploads and every NPC's memory of them.
import type { Env } from "./env";
import { deleteUserUploads } from "./http/quota";

export const GUEST_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH = 200;

/** Better Auth on D1 stores dates as ISO strings or epoch numbers depending on the path; accept both. */
export function parseDbDate(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v) {
    const n = Number(v);
    if (Number.isFinite(n)) return parseDbDate(n);
    const t = Date.parse(v.includes("T") || v.endsWith("Z") ? v : v.replace(" ", "T") + "Z");
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Most recent activity (user update or any session update); unknown dates count as active (fail safe). */
export function isIdleGuest(times: unknown[], now: number): boolean {
  let last = 0;
  for (const t of times) {
    const ms = parseDbDate(t);
    if (ms === null) return false;
    last = Math.max(last, ms);
  }
  return now - last > GUEST_IDLE_MS;
}

interface GuestRow {
  id: string;
  updatedAt: unknown;
  lastSession: unknown;
}

export async function cleanupGuests(env: Env, now: number): Promise<number> {
  let deleted = 0;
  let cursor = "";
  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT u.id AS id, u.updatedAt AS updatedAt, MAX(s.updatedAt) AS lastSession
         FROM "user" u LEFT JOIN "session" s ON s.userId = u.id
        WHERE u.isAnonymous = 1 AND u.id > ?
        GROUP BY u.id ORDER BY u.id LIMIT ?`,
    )
      .bind(cursor, BATCH)
      .all<GuestRow>();
    if (results.length === 0) break;
    cursor = results[results.length - 1]!.id;

    for (const row of results) {
      const times = row.lastSession == null ? [row.updatedAt] : [row.updatedAt, row.lastSession];
      if (!isIdleGuest(times, now)) continue;
      try {
        await env.HOME.get(env.HOME.idFromName(row.id)).wipe(row.id);
        await deleteUserUploads(env, row.id);
        // Lazy: the agents SDK imports cloudflare:workers, which plain unit tests of this module cannot load.
        await (await import("./npc/think/client")).forgetNpcMemory(env, row.id);
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM "session" WHERE userId = ?`).bind(row.id),
          env.DB.prepare(`DELETE FROM "account" WHERE userId = ?`).bind(row.id),
          env.DB.prepare(`DELETE FROM "user" WHERE id = ? AND isAnonymous = 1`).bind(row.id),
        ]);
        deleted++;
      } catch (err) {
        console.error("guest cleanup failed", row.id, err);
      }
    }
    if (results.length < BATCH) break;
  }
  return deleted;
}
