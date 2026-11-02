// D1 access for feedback (migrations/0008_feedback.sql). The per-player rate limit is counted in
// the same INSERT, so parallel submissions can't both slip under it.
import {
  FEEDBACK_PAGE_SIZE,
  FEEDBACK_RATE_DAY,
  FEEDBACK_RATE_HOUR,
  encodeCursor,
  isFeedbackCategory,
  isFeedbackStatus,
  type CleanClientInfo,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackPage,
  type FeedbackStatus,
} from "../../shared/feedback";
import type { ScreenshotType } from "./image";

export const HOUR_MS = 60 * 60_000;
export const DAY_MS = 24 * HOUR_MS;

export interface NewFeedback {
  id: string;
  userId: string;
  userName: string;
  guest: boolean;
  category: FeedbackCategory;
  message: string;
  screenshotKey: string | null;
  screenshotType: ScreenshotType | null;
  info: CleanClientInfo;
  createdAt: number;
}

export interface RateCounts {
  hour: number;
  day: number;
}

export async function recentCounts(db: D1Database, userId: string, now: number): Promise<RateCounts> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN created_at > ?2 THEN 1 ELSE 0 END), 0) AS hour, COUNT(*) AS day
         FROM "feedback" WHERE user_id = ?1 AND created_at > ?3`,
    )
    .bind(userId, now - HOUR_MS, now - DAY_MS)
    .first<RateCounts>();
  return { hour: Number(row?.hour ?? 0), day: Number(row?.day ?? 0) };
}

export function underLimit(c: RateCounts): boolean {
  return c.hour < FEEDBACK_RATE_HOUR && c.day < FEEDBACK_RATE_DAY;
}

/** Records the report unless the player is at either limit. False = rate limited. */
export async function insertFeedback(db: D1Database, f: NewFeedback): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO "feedback" (id, user_id, user_name, is_guest, category, message, screenshot_key, screenshot_type,
                               zone, pos_x, pos_y, viewport, renderer, user_agent, created_at, status)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'new'
        WHERE (SELECT COUNT(*) FROM "feedback" WHERE user_id = ?2 AND created_at > ?15 - ?16) < ?17
          AND (SELECT COUNT(*) FROM "feedback" WHERE user_id = ?2 AND created_at > ?15 - ?18) < ?19`,
    )
    .bind(
      f.id,
      f.userId,
      f.userName,
      f.guest ? 1 : 0,
      f.category,
      f.message,
      f.screenshotKey,
      f.screenshotType,
      f.info.zone,
      f.info.x,
      f.info.y,
      f.info.viewport,
      f.info.renderer,
      f.info.userAgent,
      f.createdAt,
      HOUR_MS,
      FEEDBACK_RATE_HOUR,
      DAY_MS,
      FEEDBACK_RATE_DAY,
    )
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** The R2 write failed after the row went in: keep the words, drop the missing picture. */
export async function clearScreenshot(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE "feedback" SET screenshot_key = NULL, screenshot_type = NULL WHERE id = ?`).bind(id).run();
}

interface Row {
  id: string;
  user_id: string;
  user_name: string;
  is_guest: number;
  category: string;
  message: string;
  screenshot_key: string | null;
  zone: string | null;
  pos_x: number | null;
  pos_y: number | null;
  viewport: string | null;
  renderer: string | null;
  user_agent: string | null;
  created_at: number;
  status: string;
}

function toItem(r: Row): FeedbackItem {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    guest: r.is_guest === 1,
    category: isFeedbackCategory(r.category) ? r.category : "other",
    message: r.message,
    hasScreenshot: !!r.screenshot_key,
    zone: r.zone,
    x: r.pos_x,
    y: r.pos_y,
    viewport: r.viewport,
    renderer: r.renderer,
    userAgent: r.user_agent,
    createdAt: Number(r.created_at),
    status: isFeedbackStatus(r.status) ? r.status : "new",
  };
}

const COLUMNS = `id, user_id, user_name, is_guest, category, message, screenshot_key, zone, pos_x, pos_y, viewport, renderer,
                 user_agent, created_at, status`;

/** Newest first, `FEEDBACK_PAGE_SIZE` at a time, older than the cursor; optionally one status only. */
export async function listFeedback(
  db: D1Database,
  opts: { before?: { createdAt: number; id: string } | null; status?: FeedbackStatus | null; limit?: number } = {},
): Promise<FeedbackPage> {
  const limit = Math.min(Math.max(1, opts.limit ?? FEEDBACK_PAGE_SIZE), 50);
  const b = opts.before ?? null;
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM "feedback"
        WHERE (?1 IS NULL OR status = ?1)
          AND (?2 IS NULL OR created_at < ?2 OR (created_at = ?2 AND id < ?3))
        ORDER BY created_at DESC, id DESC
        LIMIT ?4`,
    )
    .bind(opts.status ?? null, b ? b.createdAt : null, b ? b.id : "", limit + 1)
    .all<Row>();
  const rows = results ?? [];
  const page = rows.slice(0, limit).map(toItem);
  const last = page[page.length - 1];
  return { items: page, next: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

export async function screenshotOf(db: D1Database, id: string): Promise<{ key: string; type: ScreenshotType } | null> {
  const row = await db
    .prepare(`SELECT screenshot_key AS key, screenshot_type AS type FROM "feedback" WHERE id = ?`)
    .bind(id)
    .first<{ key: string | null; type: string | null }>();
  if (!row?.key || !row.key.startsWith("feedback/")) return null;
  const type = row.type === "image/png" || row.type === "image/jpeg" || row.type === "image/webp" ? row.type : null;
  return type ? { key: row.key, type } : null;
}

export async function setStatus(db: D1Database, id: string, status: FeedbackStatus, by: string, now: number): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE "feedback" SET status = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?1`)
    .bind(id, status, now, by)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}
