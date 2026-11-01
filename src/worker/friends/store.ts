// D1 queries for friends (migrations/0005_friends.sql). Limits are re-checked inside the writing
// statement itself, so two parallel requests can't both slip past a check made before either wrote.
import { FRIEND_REQ_RATE_MAX, FRIEND_REQ_RATE_WINDOW_MS, MAX_FRIENDS, MAX_PENDING_OUT } from "../../shared/friends";

export interface UserRow {
  id: string;
  name: string;
}

/** Friendship rows store the smaller id first. */
export function pair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/** Accounts (not guests) whose name matches case-insensitively; at most 2, to detect ambiguity. */
export async function findUsersByName(db: D1Database, name: string): Promise<UserRow[]> {
  const res = await db
    .prepare(
      `SELECT id, name FROM "user"
        WHERE name = ?1 COLLATE NOCASE AND COALESCE(isAnonymous, 0) = 0
        ORDER BY createdAt LIMIT 2`,
    )
    .bind(name)
    .all<UserRow>();
  return res.results ?? [];
}

export async function areFriends(db: D1Database, x: string, y: string): Promise<boolean> {
  const [a, b] = pair(x, y);
  const row = await db.prepare(`SELECT 1 AS ok FROM "friendship" WHERE a_id = ? AND b_id = ?`).bind(a, b).first();
  return !!row;
}

export async function hasRequest(db: D1Database, from: string, to: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM "friend_request" WHERE from_id = ? AND to_id = ?`)
    .bind(from, to)
    .first();
  return !!row;
}

export async function friendCount(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM "friendship" WHERE a_id = ?1 OR b_id = ?1`)
    .bind(userId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function pendingOutCount(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM "friend_request" WHERE from_id = ?`)
    .bind(userId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** Inserts the request if the sender has fewer than MAX_PENDING_OUT pending; false if not inserted. */
export async function insertRequest(db: D1Database, from: string, to: string, now: number): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO "friend_request" (from_id, to_id, created_at)
       SELECT ?1, ?2, ?3
        WHERE (SELECT COUNT(*) FROM "friend_request" WHERE from_id = ?1) < ?4`,
    )
    .bind(from, to, now, MAX_PENDING_OUT)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Turns `from`'s pending request to `to` into a friendship, if both are under MAX_FRIENDS.
 * One D1 batch (a transaction): the requests in both directions are deleted only if the pair exists.
 * True if this call created the friendship.
 */
export async function acceptRequest(db: D1Database, from: string, to: string, now: number): Promise<boolean> {
  const [a, b] = pair(from, to);
  const [ins] = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO "friendship" (a_id, b_id, created_at)
         SELECT ?1, ?2, ?3
          WHERE EXISTS (SELECT 1 FROM "friend_request" WHERE from_id = ?4 AND to_id = ?5)
            AND (SELECT COUNT(*) FROM "friendship" WHERE a_id = ?1 OR b_id = ?1) < ?6
            AND (SELECT COUNT(*) FROM "friendship" WHERE a_id = ?2 OR b_id = ?2) < ?6`,
      )
      .bind(a, b, now, from, to, MAX_FRIENDS),
    db
      .prepare(
        `DELETE FROM "friend_request"
          WHERE ((from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1))
            AND EXISTS (SELECT 1 FROM "friendship" WHERE a_id = ?3 AND b_id = ?4)`,
      )
      .bind(from, to, a, b),
  ]);
  return (ins?.meta?.changes ?? 0) > 0;
}

export async function deleteRequest(db: D1Database, from: string, to: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM "friend_request" WHERE from_id = ? AND to_id = ?`).bind(from, to).run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Removes the friendship and any pending request between the two; true if anything was removed. */
export async function removeFriend(db: D1Database, x: string, y: string): Promise<boolean> {
  const [a, b] = pair(x, y);
  const [f, r] = await db.batch([
    db.prepare(`DELETE FROM "friendship" WHERE a_id = ? AND b_id = ?`).bind(a, b),
    db
      .prepare(`DELETE FROM "friend_request" WHERE (from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)`)
      .bind(x, y),
  ]);
  return (f?.meta?.changes ?? 0) + (r?.meta?.changes ?? 0) > 0;
}

export interface FriendRow extends UserRow {
  since: number;
}
export interface RequestRow extends UserRow {
  at: number;
}

export async function listFriends(db: D1Database, userId: string): Promise<FriendRow[]> {
  const res = await db
    .prepare(
      `SELECT u.id AS id, u.name AS name, f.created_at AS since
         FROM "friendship" f
         JOIN "user" u ON u.id = CASE WHEN f.a_id = ?1 THEN f.b_id ELSE f.a_id END
        WHERE f.a_id = ?1 OR f.b_id = ?1
        LIMIT ?2`,
    )
    .bind(userId, MAX_FRIENDS)
    .all<FriendRow>();
  return res.results ?? [];
}

export async function listIncoming(db: D1Database, userId: string): Promise<RequestRow[]> {
  const res = await db
    .prepare(
      `SELECT u.id AS id, u.name AS name, r.created_at AS at
         FROM "friend_request" r JOIN "user" u ON u.id = r.from_id
        WHERE r.to_id = ? ORDER BY r.created_at DESC LIMIT 100`,
    )
    .bind(userId)
    .all<RequestRow>();
  return res.results ?? [];
}

export async function listOutgoing(db: D1Database, userId: string): Promise<RequestRow[]> {
  const res = await db
    .prepare(
      `SELECT u.id AS id, u.name AS name, r.created_at AS at
         FROM "friend_request" r JOIN "user" u ON u.id = r.to_id
        WHERE r.from_id = ? ORDER BY r.created_at DESC LIMIT ?`,
    )
    .bind(userId, MAX_PENDING_OUT)
    .all<RequestRow>();
  return res.results ?? [];
}

/**
 * Fixed-window counter in the shared "rateLimit" table (migrations/0002), under a key Better Auth
 * never uses. Takes one unit and returns true, or returns false (without counting) when the user
 * already used FRIEND_REQ_RATE_MAX in the current window. `lastRequest` holds the window start.
 */
export async function takeRequestQuota(db: D1Database, userId: string, now: number): Promise<boolean> {
  const key = `friends:request:${userId}`;
  const row = await db
    .prepare(
      `INSERT INTO "rateLimit" (id, key, count, lastRequest) VALUES (?5, ?1, 1, ?2)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN "rateLimit".lastRequest <= ?2 - ?3 THEN 1 ELSE "rateLimit".count + 1 END,
         lastRequest = CASE WHEN "rateLimit".lastRequest <= ?2 - ?3 THEN ?2 ELSE "rateLimit".lastRequest END
        WHERE "rateLimit".lastRequest <= ?2 - ?3 OR "rateLimit".count < ?4
       RETURNING count`,
    )
    .bind(key, now, FRIEND_REQ_RATE_WINDOW_MS, FRIEND_REQ_RATE_MAX, crypto.randomUUID())
    .first<{ count: number }>();
  return !!row;
}

/** Just the friend ids (SocialRoom uses this to push presence changes to friends). */
export async function friendIds(db: D1Database, userId: string): Promise<string[]> {
  const res = await db
    .prepare(
      `SELECT CASE WHEN a_id = ?1 THEN b_id ELSE a_id END AS id
         FROM "friendship" WHERE a_id = ?1 OR b_id = ?1 LIMIT ?2`,
    )
    .bind(userId, MAX_FRIENDS)
    .all<{ id: string }>();
  return (res.results ?? []).map((r) => r.id);
}
