// Pure state for the notice board panel (no DOM), tested in test/fe-notice-board.test.ts.
import { cooldownLeft, NOTICE_COST, NOTICE_MAX_LEN, type NoticeView } from "../../shared/notices";

/** Live vote counts pushed from elsewhere: patch that one notice, keeping your own vote. */
export function applyVoteCounts(posts: readonly NoticeView[], id: string, likes: number, dislikes: number): NoticeView[] {
  return posts.map((p) => (p.id === id ? { ...p, likes, dislikes } : p));
}

/** A `{ t: "noticeVotes" }` social payload, checked (it is still untrusted data). */
export function readVoteCounts(p: Record<string, unknown>): { id: string; likes: number; dislikes: number } | null {
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
  return typeof p.id === "string" && ok(p.likes) && ok(p.dislikes) ? { id: p.id, likes: p.likes, dislikes: p.dislikes } : null;
}

/** A posts list from the server, keeping only well-formed entries. */
export function readPosts(raw: unknown): NoticeView[] {
  if (!Array.isArray(raw)) return [];
  const out: NoticeView[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.author !== "string" || typeof o.text !== "string" || typeof o.at !== "number") continue;
    const n = (v: unknown) => (typeof v === "number" && v >= 0 ? Math.floor(v) : 0);
    const vote = o.vote === 1 || o.vote === -1 ? o.vote : 0;
    out.push({ id: o.id, author: o.author, text: o.text, at: o.at, likes: n(o.likes), dislikes: n(o.dislikes), vote, mine: o.mine === true });
  }
  return out;
}

export interface ComposeState {
  /** The Pin button works. */
  canPin: boolean;
  /** Line under the box: why not, or what it costs. */
  hint: string;
  /** "123 left". */
  left: string;
}

/** What the compose box shows for this text, purse and cooldown. */
export function composeState(text: string, coins: number, nextPostAt: number | undefined, now: number, guest: boolean): ComposeState {
  const used = Array.from(text.trim()).length;
  const left = `${Math.max(0, NOTICE_MAX_LEN - used)} left`;
  if (guest) return { canPin: false, hint: "Create an account to pin notices.", left };
  const wait = cooldownLeft(nextPostAt, now);
  if (wait) return { canPin: false, hint: `You can pin another notice in ${wait}.`, left };
  if (coins < NOTICE_COST) return { canPin: false, hint: `You need ${NOTICE_COST} coins (you have ${coins}).`, left };
  if (used === 0) return { canPin: false, hint: `Pinning costs ${NOTICE_COST} coins.`, left };
  return { canPin: true, hint: `Pinning costs ${NOTICE_COST} coins.`, left };
}
