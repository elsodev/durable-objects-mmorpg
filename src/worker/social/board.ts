// Notice board rules (shared/notices.ts has the limits): who may pin, vote and take down, the
// newest-50 cap and the week-long expiry. In-memory; SocialRoom persists what each call changed
// (one storage key per notice plus the last-post times for the cooldown). No Workers APIs here,
// so the rules are tested directly.
import {
  cleanNoticeText,
  isNoticeId,
  nextVote,
  NOTICE_COOLDOWN_MS,
  NOTICE_MAX_POSTS,
  NOTICE_TTL_MS,
  type NoticePress,
  type NoticeView,
} from "../../shared/notices";

/** Votes kept per notice; past this, new voters are turned away (keeps one stored value small). */
export const MAX_VOTERS = 1000;
const MAX_AUTHOR = 24;

export interface NoticeRecord {
  id: string;
  authorId: string;
  author: string;
  text: string;
  at: number;
  /** userId -> 1 (like) or -1 (dislike). */
  votes: Record<string, 1 | -1>;
  /** The zone's request id, so a retried post isn't pinned twice. */
  req?: string;
}

export type BoardRefusal = { ok: false; reason: string };
export type PostResult = { ok: true; record: NoticeRecord; removed: string[] } | BoardRefusal;
export type VoteResult = { ok: true; record: NoticeRecord } | BoardRefusal;
export type RemoveResult = { ok: true; id: string } | BoardRefusal;

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

/** A stored record, checked field by field (storage could hold an older shape). */
export function sanitizeRecord(raw: unknown): NoticeRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = isNoticeId(o.id) ? o.id : null;
  const authorId = str(o.authorId, 128);
  const author = str(o.author, MAX_AUTHOR);
  const text = cleanNoticeText(o.text);
  if (!id || !authorId || !author || !text || typeof o.at !== "number" || !Number.isFinite(o.at)) return null;
  const votes: Record<string, 1 | -1> = Object.create(null);
  if (o.votes && typeof o.votes === "object") {
    for (const [k, v] of Object.entries(o.votes as Record<string, unknown>).slice(0, MAX_VOTERS)) {
      if ((v === 1 || v === -1) && k !== authorId) votes[k] = v;
    }
  }
  return { id, authorId, author, text, at: o.at, votes, ...(typeof o.req === "string" ? { req: o.req.slice(0, 64) } : {}) };
}

export class NoticeBoard {
  private posts = new Map<string, NoticeRecord>();
  /** userId -> when they last pinned (for the cooldown). */
  private lastPost = new Map<string, number>();

  static from(records: Iterable<unknown>, lastPost: unknown): NoticeBoard {
    const b = new NoticeBoard();
    for (const r of records) {
      const rec = sanitizeRecord(r);
      if (rec) b.posts.set(rec.id, rec);
    }
    if (lastPost && typeof lastPost === "object") {
      for (const [k, v] of Object.entries(lastPost as Record<string, unknown>)) if (typeof v === "number") b.lastPost.set(k, v);
    }
    return b;
  }

  get size(): number {
    return this.posts.size;
  }

  get(id: string): NoticeRecord | undefined {
    return this.posts.get(id);
  }

  /** Takes down notices older than a week. Returns their ids (to delete from storage). */
  prune(now: number): string[] {
    const gone: string[] = [];
    for (const [id, r] of this.posts) {
      if (now - r.at >= NOTICE_TTL_MS) {
        this.posts.delete(id);
        gone.push(id);
      }
    }
    for (const [k, at] of this.lastPost) if (now - at >= NOTICE_COOLDOWN_MS) this.lastPost.delete(k);
    return gone;
  }

  /** When `userId` may pin again, or undefined if now. */
  nextPostAt(userId: string, now: number): number | undefined {
    const last = this.lastPost.get(userId);
    return last !== undefined && now - last < NOTICE_COOLDOWN_MS ? last + NOTICE_COOLDOWN_MS : undefined;
  }

  /** Last-post times still inside the cooldown, for storage. */
  cooldowns(now: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, at] of this.lastPost) if (now - at < NOTICE_COOLDOWN_MS) out[k] = at;
    return out;
  }

  post(authorId: string, author: string, rawText: string, now: number, id: string, req?: string): PostResult {
    if (req) {
      for (const r of this.posts.values()) if (r.req === req && r.authorId === authorId) return { ok: true, record: r, removed: [] };
    }
    const text = cleanNoticeText(rawText);
    if (!text) return { ok: false, reason: "Write something first." };
    if (!isNoticeId(id) || this.posts.has(id)) return { ok: false, reason: "Couldn't pin that. Try again." };
    const next = this.nextPostAt(authorId, now);
    if (next !== undefined) return { ok: false, reason: `You can pin another notice in ${Math.ceil((next - now) / 60_000)}m.` };
    const record: NoticeRecord = {
      id,
      authorId,
      author: author.slice(0, MAX_AUTHOR) || "Someone",
      text,
      at: now,
      votes: Object.create(null),
      ...(req ? { req: req.slice(0, 64) } : {}),
    };
    this.posts.set(id, record);
    this.lastPost.set(authorId, now);
    const removed: string[] = [];
    for (const old of this.newestFirst().slice(NOTICE_MAX_POSTS)) {
      this.posts.delete(old.id);
      removed.push(old.id);
    }
    return { ok: true, record, removed };
  }

  vote(id: string, userId: string, press: NoticePress): VoteResult {
    const r = this.posts.get(id);
    if (!r) return { ok: false, reason: "That notice was taken down." };
    if (r.authorId === userId) return { ok: false, reason: "You can't vote on your own notice." };
    const had = Object.hasOwn(r.votes, userId) ? r.votes[userId]! : 0;
    if (had === 0 && Object.keys(r.votes).length >= MAX_VOTERS) return { ok: false, reason: "This notice has all the votes it can hold." };
    const v = nextVote(had, press);
    if (v === 0) delete r.votes[userId];
    else r.votes[userId] = v;
    return { ok: true, record: r };
  }

  /** The author takes their notice down (no refund). */
  remove(id: string, userId: string): RemoveResult {
    const r = this.posts.get(id);
    if (!r) return { ok: false, reason: "That notice was already taken down." };
    if (r.authorId !== userId) return { ok: false, reason: "Only whoever pinned it can take it down." };
    this.posts.delete(id);
    return { ok: true, id };
  }

  newestFirst(): NoticeRecord[] {
    return [...this.posts.values()].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  }

  /** The board as `viewerId` sees it, newest first, without notices from people they muted. */
  view(viewerId: string, muted: ReadonlySet<string> = new Set()): NoticeView[] {
    return this.newestFirst()
      .filter((r) => r.authorId === viewerId || !muted.has(r.authorId))
      .map((r) => viewOf(r, viewerId));
  }
}

export function tally(r: NoticeRecord): { likes: number; dislikes: number } {
  let likes = 0;
  let dislikes = 0;
  for (const v of Object.values(r.votes)) {
    if (v === 1) likes++;
    else dislikes++;
  }
  return { likes, dislikes };
}

export function viewOf(r: NoticeRecord, viewerId: string): NoticeView {
  const vote = Object.hasOwn(r.votes, viewerId) ? r.votes[viewerId]! : 0;
  return { id: r.id, author: r.author, text: r.text, at: r.at, ...tally(r), vote, mine: r.authorId === viewerId };
}
