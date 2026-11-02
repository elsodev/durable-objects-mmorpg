// The village notice board: players pay coins to pin a short note; everyone can like or dislike
// it. One board for the whole village (every village copy and the town hall show the same posts);
// the global SocialRoom stores it. Rules and limits here are shared by server and client. Pure.

/** Coins a notice costs. */
export const NOTICE_COST = 200;
/** Longest notice, in characters (code points). */
export const NOTICE_MAX_LEN = 160;
/** One new notice per player this often. */
export const NOTICE_COOLDOWN_MS = 5 * 60_000;
/** The board keeps the newest this many; pinning one more takes down the oldest. */
export const NOTICE_MAX_POSTS = 50;
/** Notices come down on their own after a week, so the board stays fresh. */
export const NOTICE_TTL_MS = 7 * 24 * 3600_000;
/** Ids are server-made; this bounds what a client may send back. */
export const NOTICE_ID_MAX = 32;

/** Your vote on a notice: like, dislike, or none. */
export type NoticeVote = 1 | -1 | 0;
export type NoticePress = "like" | "dislike";

/** A notice as one viewer sees it. */
export interface NoticeView {
  id: string;
  author: string;
  text: string;
  /** When it was pinned (server ms). */
  at: number;
  likes: number;
  dislikes: number;
  /** This viewer's vote. */
  vote: NoticeVote;
  /** This viewer pinned it (they may take it down, and can't vote on it). */
  mine: boolean;
}

// Invisible format characters (bidi overrides, zero-width joiners) can disguise text; drop them.
const FORMAT = /\p{Cf}/gu;
const CONTROLS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/** One line of plain text: format characters dropped, controls and runs of spaces made one space, capped. Null if empty. */
export function cleanNoticeText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const flat = raw.slice(0, NOTICE_MAX_LEN * 4).replace(FORMAT, "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
  // Cap by code points so an emoji is never cut in half.
  const capped = Array.from(flat).slice(0, NOTICE_MAX_LEN).join("").trim();
  return capped.length > 0 ? capped : null;
}

/** Pressing like or dislike: the same button again takes the vote back; the other one switches. */
export function nextVote(current: NoticeVote, press: NoticePress): NoticeVote {
  const want: NoticeVote = press === "like" ? 1 : -1;
  return current === want ? 0 : want;
}

export function isNoticeId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= NOTICE_ID_MAX && /^[A-Za-z0-9_-]+$/.test(v);
}

export function isNoticePress(v: unknown): v is NoticePress {
  return v === "like" || v === "dislike";
}

/** "just now", "5m ago", "3h ago", "2d ago", "1w ago". A time ahead of `now` (clock skew) reads as just now. */
export function timeAgo(at: number, now: number): string {
  const s = Math.floor((now - at) / 1000);
  if (!(s >= 60)) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

/** "3m" until a player may pin again (rounded up), or null when they may now. */
export function cooldownLeft(nextAt: number | undefined, now: number): string | null {
  if (nextAt === undefined || nextAt <= now) return null;
  const s = Math.ceil((nextAt - now) / 1000);
  return s < 60 ? `${s}s` : `${Math.ceil(s / 60)}m`;
}
