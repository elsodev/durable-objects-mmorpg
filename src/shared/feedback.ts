// Player feedback (the HUD's bug button): what a report may hold, how its text is cleaned, and
// the shapes the admin review list exchanges. Shared by the Worker (which re-checks everything)
// and the client form (which only mirrors the limits for a friendly counter).

export const FEEDBACK_PATH = "/api/feedback";

export const FEEDBACK_CATEGORIES = ["bug", "idea", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_STATUSES = ["new", "seen", "resolved"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Code points, after cleaning. */
export const FEEDBACK_MESSAGE_MAX = 1000;
export const FEEDBACK_MESSAGE_MIN = 3;

/** Screenshot limits: the client downscales to fit; the Worker refuses anything past them. */
export const SCREENSHOT_MAX_BYTES = 1536 * 1024;
export const SCREENSHOT_MAX_SIDE = 1600;
/** The Worker allows a little slack over what the client aims for (rounding, odd DPRs). */
export const SCREENSHOT_SERVER_MAX_SIDE = 2048;
/** The whole multipart body: screenshot plus a few small text fields. */
export const FEEDBACK_MAX_BODY_BYTES = SCREENSHOT_MAX_BYTES + 32 * 1024;

/** Per player: a handful an hour, a few dozen a day. */
export const FEEDBACK_RATE_HOUR = 5;
export const FEEDBACK_RATE_DAY = 20;

export const FEEDBACK_PAGE_SIZE = 20;

const UA_MAX = 256;
const RENDERER_MAX = 16;

export function isFeedbackCategory(v: unknown): v is FeedbackCategory {
  return typeof v === "string" && (FEEDBACK_CATEGORIES as readonly string[]).includes(v);
}

export function isFeedbackStatus(v: unknown): v is FeedbackStatus {
  return typeof v === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(v);
}

/** Code points, so an emoji counts once (the client counter and the Worker agree). */
export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/**
 * Untrusted text -> plain text that is safe to store and show with textContent: control and
 * format characters go (bidi overrides, zero-width joiners, NUL), except newlines and tabs; runs
 * of blank lines shrink to one; trimmed and capped. Null when nothing meaningful is left.
 */
export function cleanFeedbackMessage(raw: unknown, max = FEEDBACK_MESSAGE_MAX): string | null {
  if (typeof raw !== "string") return null;
  // A cheap bound before any regex work on a huge string.
  const bounded = raw.length > max * 4 ? raw.slice(0, max * 4) : raw;
  const cleaned = bounded
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u2028\u2029]/gu, (c) => (c === "\n" ? "\n" : ""))
    .replace(/[  ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const capped = Array.from(cleaned).slice(0, max).join("").trim();
  return codePointLength(capped) >= FEEDBACK_MESSAGE_MIN ? capped : null;
}

/** A single line of untrusted text (user agent, renderer name): printable, trimmed and capped. */
export function cleanLine(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .slice(0, max * 4)
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u2028\u2029]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const capped = Array.from(s).slice(0, max).join("").trim();
  return capped || null;
}

/** What the client reports about where it was. Display only: never used to act on the game. */
export interface FeedbackClientInfo {
  zone?: string;
  x?: number;
  y?: number;
  viewport?: string;
  renderer?: string;
  userAgent?: string;
}

export interface CleanClientInfo {
  zone: string | null;
  x: number | null;
  y: number | null;
  viewport: string | null;
  renderer: string | null;
  userAgent: string | null;
}

function smallInt(v: unknown, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max ? Math.round(v) : null;
}

/** Every field validated to a tight shape or dropped; the JSON itself is size-capped by the caller. */
export function cleanClientInfo(raw: unknown): CleanClientInfo {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const zone = typeof o.zone === "string" && /^[a-z0-9_]{1,32}$/.test(o.zone) ? o.zone : null;
  const viewport = typeof o.viewport === "string" && /^\d{1,5}x\d{1,5}(@\d(\.\d{1,2})?)?$/.test(o.viewport) ? o.viewport : null;
  return {
    zone,
    x: smallInt(o.x, 100_000),
    y: smallInt(o.y, 100_000),
    viewport,
    renderer: cleanLine(o.renderer, RENDERER_MAX),
    userAgent: cleanLine(o.userAgent, UA_MAX),
  };
}

/** One report in the admin list. Every string is plain text: render with textContent only. */
export interface FeedbackItem {
  id: string;
  userId: string;
  userName: string;
  guest: boolean;
  category: FeedbackCategory;
  message: string;
  hasScreenshot: boolean;
  zone: string | null;
  x: number | null;
  y: number | null;
  viewport: string | null;
  renderer: string | null;
  userAgent: string | null;
  createdAt: number;
  status: FeedbackStatus;
}

export interface FeedbackPage {
  items: FeedbackItem[];
  /** Pass back as ?before= for the next (older) page; null on the last page. */
  next: string | null;
}

export interface FeedbackSubmitted {
  id: string;
}

/** "/api/feedback/<id>/screenshot": admins only. */
export function screenshotUrl(id: string): string {
  return `${FEEDBACK_PATH}/${encodeURIComponent(id)}/screenshot`;
}

/** Feedback ids are server-made UUIDs. */
export function isFeedbackId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
}

/** Keyset cursor "createdAt.id" for newest-first paging. */
export function encodeCursor(createdAt: number, id: string): string {
  return `${createdAt}.${id}`;
}

export function parseCursor(raw: string | null): { createdAt: number; id: string } | null {
  if (!raw || raw.length > 64) return null;
  const m = /^(\d{1,15})\.([0-9a-f-]{36})$/.exec(raw);
  if (!m || !isFeedbackId(m[2])) return null;
  return { createdAt: Number(m[1]), id: m[2]! };
}
