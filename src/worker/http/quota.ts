// Per-user upload quota (files and bytes stored) and rate limit, tracked in D1 (migrations/0004).
import type { Env } from "../env";

export const UPLOAD_MAX_FILES = 20;
export const UPLOAD_MAX_BYTES_TOTAL = 10 * 1024 * 1024;
export const UPLOAD_RATE_MAX = 10;
export const UPLOAD_RATE_WINDOW_MS = 60 * 60_000;

export interface UploadStats {
  count: number;
  bytes: number;
  recent: number;
}

export type QuotaVerdict = { ok: true } | { ok: false; status: 413 | 429; error: string };

export function checkQuota(s: UploadStats, size: number): QuotaVerdict {
  if (s.recent >= UPLOAD_RATE_MAX) return { ok: false, status: 429, error: "too many uploads, try again later" };
  if (s.count >= UPLOAD_MAX_FILES) return { ok: false, status: 413, error: `upload limit reached (${UPLOAD_MAX_FILES} files)` };
  if (s.bytes + size > UPLOAD_MAX_BYTES_TOTAL) return { ok: false, status: 413, error: "upload storage full (10 MB)" };
  return { ok: true };
}

export async function uploadStats(env: Env, userId: string, now: number): Promise<UploadStats> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes,
            COALESCE(SUM(CASE WHEN createdAt > ? THEN 1 ELSE 0 END), 0) AS recent
       FROM "upload" WHERE userId = ?`,
  )
    .bind(now - UPLOAD_RATE_WINDOW_MS, userId)
    .first<UploadStats>();
  return { count: Number(row?.count ?? 0), bytes: Number(row?.bytes ?? 0), recent: Number(row?.recent ?? 0) };
}

/**
 * Records the upload only if the user is still under every limit, in one statement, so two
 * parallel uploads can't both slip past a check made before either was recorded.
 */
export async function reserveUpload(env: Env, userId: string, key: string, size: number, now: number): Promise<boolean> {
  const res = await env.DB.prepare(
    `INSERT INTO "upload" (key, userId, bytes, createdAt)
     SELECT ?1, ?2, ?3, ?4
      WHERE (SELECT COUNT(*) FROM "upload" WHERE userId = ?2) < ?5
        AND (SELECT COALESCE(SUM(bytes), 0) FROM "upload" WHERE userId = ?2) + ?3 <= ?6
        AND (SELECT COUNT(*) FROM "upload" WHERE userId = ?2 AND createdAt > ?7) < ?8`,
  )
    .bind(key, userId, size, now, UPLOAD_MAX_FILES, UPLOAD_MAX_BYTES_TOTAL, now - UPLOAD_RATE_WINDOW_MS, UPLOAD_RATE_MAX)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function releaseUpload(env: Env, key: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM "upload" WHERE key = ?`).bind(key).run();
}

/** Deletes every upload of a user from R2 and D1 (guest cleanup, account deletion). */
export async function deleteUserUploads(env: Env, userId: string): Promise<number> {
  const prefix = `uploads/${userId}/`;
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor, limit: 1000 });
    const keys = page.objects.map((o) => o.key);
    if (keys.length > 0) {
      await env.FILES.delete(keys);
      deleted += keys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await env.DB.prepare(`DELETE FROM "upload" WHERE userId = ?`).bind(userId).run();
  return deleted;
}
