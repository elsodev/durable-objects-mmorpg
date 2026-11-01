// D1 queries for the per-account mute list (migrations/0007_mutes.sql).
import { MAX_MUTES, type MutedEntry } from "../../shared/players";

/** Mutes `mutedId` for `muterId` if the list has room. "added", "already" or "full". */
export async function addMute(db: D1Database, muterId: string, mutedId: string, now: number): Promise<"added" | "already" | "full"> {
  // The cap is checked inside the insert, so two parallel mutes can't both pass it.
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO "player_mute" (muter_id, muted_id, created_at)
       SELECT ?1, ?2, ?3
        WHERE (SELECT COUNT(*) FROM "player_mute" WHERE muter_id = ?1) < ?4`,
    )
    .bind(muterId, mutedId, now, MAX_MUTES)
    .run();
  if ((res.meta?.changes ?? 0) > 0) return "added";
  return (await isMutedBy(db, muterId, mutedId)) ? "already" : "full";
}

export async function removeMute(db: D1Database, muterId: string, mutedId: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM "player_mute" WHERE muter_id = ? AND muted_id = ?`).bind(muterId, mutedId).run();
  return (res.meta?.changes ?? 0) > 0;
}

/** True if `muterId` muted `mutedId`. */
export async function isMutedBy(db: D1Database, muterId: string, mutedId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM "player_mute" WHERE muter_id = ? AND muted_id = ?`)
    .bind(muterId, mutedId)
    .first();
  return !!row;
}

/** Ids `muterId` muted (SocialRoom caches this to drop whispers). */
export async function mutedIds(db: D1Database, muterId: string): Promise<string[]> {
  const res = await db
    .prepare(`SELECT muted_id AS id FROM "player_mute" WHERE muter_id = ? LIMIT ?`)
    .bind(muterId, MAX_MUTES)
    .all<{ id: string }>();
  return (res.results ?? []).map((r) => r.id);
}

/** The mute list with current names, newest first. */
export async function listMutes(db: D1Database, muterId: string): Promise<MutedEntry[]> {
  const res = await db
    .prepare(
      `SELECT u.id AS userId, u.name AS name, m.created_at AS at
         FROM "player_mute" m JOIN "user" u ON u.id = m.muted_id
        WHERE m.muter_id = ? ORDER BY m.created_at DESC LIMIT ?`,
    )
    .bind(muterId, MAX_MUTES)
    .all<MutedEntry>();
  return (res.results ?? []).map((r) => ({ userId: r.userId, name: r.name, at: Number(r.at) }));
}

/** Any user (account or guest) by exact id, for muting someone whose bubble you saw. */
export async function userById(db: D1Database, id: string): Promise<{ id: string; name: string } | null> {
  return (await db.prepare(`SELECT id, name FROM "user" WHERE id = ?`).bind(id).first<{ id: string; name: string }>()) ?? null;
}

/** Any user by name ignoring case (names are unique that way, migrations/0006); at most 2 to detect old duplicates. */
export async function usersByName(db: D1Database, name: string): Promise<{ id: string; name: string }[]> {
  const res = await db
    .prepare(`SELECT id, name FROM "user" WHERE name = ? COLLATE NOCASE ORDER BY createdAt LIMIT 2`)
    .bind(name)
    .all<{ id: string; name: string }>();
  return res.results ?? [];
}
