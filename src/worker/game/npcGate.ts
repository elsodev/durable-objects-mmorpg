// Local AI spend limits for NPC conversations, checked BEFORE the global AiBudget DO:
// - one conversation in flight per NPC (extra chats are ignored),
// - at most one AI reply per player per NPC every 10 s (otherwise scripted),
// - the same text to the same NPC within 10 min reuses the cached reply (no AI call).
import type { Intent } from "../npc/brain";

export const AI_REPLY_INTERVAL_MS = 10_000;
export const REPLY_CACHE_MS = 10 * 60 * 1000;
const MAX_CACHE = 200;

/** Estimated Workers AI neurons per spoken line, plus a fixed estimate for a Jev decision. */
export const SPEAK_UNITS = 30;
export const JEV_UNITS = 5;
/**
 * Estimated neurons for one NpcAgent turn (one step, tools + words): about 1,500 prompt tokens
 * (soul + player memory + recent lines) and 90 output tokens on NPC_AGENT_MODEL, rounded up.
 */
export const AGENT_UNITS = 50;

export interface CachedReply {
  line: string;
  intent: Intent;
  at: number;
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// One definition of "the UTC day" shared with the AiBudget DO, so both sides bucket spend identically.
export { utcDay } from "../npc/budget-logic";

/** Players waiting for a busy NPC; at most this many per NPC, one entry per player. */
export const TALK_QUEUE_MAX = 2;
/** A queued line older than this is dropped (the player has probably walked off). */
export const TALK_QUEUE_TTL_MS = 15_000;

export interface QueuedTalk<S extends { userId: string }> {
  speaker: S;
  text: string;
  at: number;
  /** A reply from the conversation window: judged for hearts when it is answered. */
  judge?: boolean;
}

/**
 * Per-NPC waiting line so one player can't monopolise an NPC by re-talking the moment it frees
 * up: whoever was waiting goes first, and the player just served goes last.
 */
export class TalkQueue<S extends { userId: string }> {
  private queues = new Map<string, QueuedTalk<S>[]>();

  /** Queues (or refreshes) a player's line; false if the line is full. */
  offer(npcId: string, item: QueuedTalk<S>): boolean {
    const q = this.queues.get(npcId) ?? [];
    const mine = q.findIndex((e) => e.speaker.userId === item.speaker.userId);
    if (mine >= 0) {
      q[mine] = item;
      return true;
    }
    if (q.length >= TALK_QUEUE_MAX) return false;
    q.push(item);
    this.queues.set(npcId, q);
    return true;
  }

  /** Next fresh entry, preferring anyone other than `lastUserId`. */
  next(npcId: string, lastUserId: string | null, now: number): QueuedTalk<S> | null {
    const q = (this.queues.get(npcId) ?? []).filter((e) => now - e.at <= TALK_QUEUE_TTL_MS);
    let i = q.findIndex((e) => e.speaker.userId !== lastUserId);
    if (i < 0) i = q.length > 0 ? 0 : -1;
    const item = i >= 0 ? q.splice(i, 1)[0] : null;
    if (q.length > 0) this.queues.set(npcId, q);
    else this.queues.delete(npcId);
    return item;
  }

  size(npcId: string): number {
    return this.queues.get(npcId)?.length ?? 0;
  }
}

/** Daily gift markers (`gift:<npc>:<userId>` = UTC day) older than this many days are pruned. */
export const GIFT_KEEP_DAYS = 2;

/** Keys from a gift-marker listing whose day is older than GIFT_KEEP_DAYS before `now`. */
export function staleGiftKeys(entries: Iterable<[string, unknown]>, now: number): string[] {
  const cutoff = new Date(now - GIFT_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const out: string[] = [];
  for (const [k, v] of entries) if (typeof v !== "string" || v < cutoff) out.push(k);
  return out;
}

export class NpcGate {
  private inflight = new Set<string>();
  private lastAi = new Map<string, number>();
  private cache = new Map<string, CachedReply>();

  /** Claims the NPC for one conversation; false if it is already busy. */
  begin(npcId: string): boolean {
    if (this.inflight.has(npcId)) return false;
    this.inflight.add(npcId);
    return true;
  }

  end(npcId: string): void {
    this.inflight.delete(npcId);
  }

  busy(npcId: string): boolean {
    return this.inflight.has(npcId);
  }

  /** True (and records) if this player may get an AI-written reply from this NPC now. */
  allowAi(userId: string, npcId: string, now: number): boolean {
    const key = `${userId}\u0000${npcId}`;
    const prev = this.lastAi.get(key);
    if (prev !== undefined && now - prev < AI_REPLY_INTERVAL_MS) return false;
    this.lastAi.set(key, now);
    if (this.lastAi.size > 5000) this.prune(now);
    return true;
  }

  cached(npcId: string, text: string, now: number): CachedReply | null {
    const key = `${npcId}\u0000${normalizeText(text)}`;
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (now - hit.at > REPLY_CACHE_MS) {
      this.cache.delete(key);
      return null;
    }
    return hit;
  }

  remember(npcId: string, text: string, reply: CachedReply): void {
    const key = `${npcId}\u0000${normalizeText(text)}`;
    this.cache.delete(key);
    this.cache.set(key, reply);
    // Map keeps insertion order: drop the oldest entries.
    while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
  }

  private prune(now: number): void {
    for (const [k, at] of this.lastAi) if (now - at >= AI_REPLY_INTERVAL_MS) this.lastAi.delete(k);
  }
}
