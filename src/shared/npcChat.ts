// Conversation hearts: what a reply typed to a villager in the conversation window is worth.
// The server judges each reply good, neutral or bad (a typed verdict, never free text) and these
// pure rules turn the verdict into friendship points. Gains are slow and capped so sending kind
// lines on repeat can't farm hearts; losses are capped too, so one bad mood can't wipe a bond.
import type { Bond, ChatDay } from "./hearts";
import { maxPoints, rollBond } from "./hearts";
import { worldDay } from "./calendar";

export type ChatVerdict = "good" | "neutral" | "bad";
export const CHAT_VERDICTS: readonly ChatVerdict[] = ["good", "neutral", "bad"];

/** Points for a reply the villager liked, and for one that upset them. */
export const CHAT_GOOD_PTS = 6;
export const CHAT_BAD_PTS = -10;
/** Most points replies to one villager can add, and take away, per world day. */
export const CHAT_DAILY_GAIN_CAP = 30;
export const CHAT_DAILY_LOSS_CAP = 30;
/** A liked reply this soon after the last one that counted adds nothing. */
export const CHAT_GAIN_COOLDOWN_MS = 20_000;
/** Tiles you can stand from a villager and keep the conversation going (the window closes beyond). */
export const CONVO_RANGE = 5;

export function isVerdict(v: unknown): v is ChatVerdict {
  return typeof v === "string" && (CHAT_VERDICTS as readonly string[]).includes(v);
}

export function verdictPoints(v: ChatVerdict): number {
  return v === "good" ? CHAT_GOOD_PTS : v === "bad" ? CHAT_BAD_PTS : 0;
}

function today(b: Bond, now: number): ChatDay {
  const day = worldDay(now);
  if (!b.chat || b.chat.day !== day) b.chat = { day, gain: 0, loss: 0, last: b.chat?.last ?? 0 };
  return b.chat;
}

/** Points a liked reply could still add today (ignores the cooldown). */
export function chatGainLeft(b: Bond, now: number): number {
  const c = b.chat;
  return Math.max(0, CHAT_DAILY_GAIN_CAP - (c && c.day === worldDay(now) ? c.gain : 0));
}

/**
 * Applies one judged reply. Any reply counts as talking that day (no decay); a good one adds
 * CHAT_GOOD_PTS when off cooldown and under the daily cap, a bad one takes CHAT_BAD_PTS until the
 * daily loss cap. Returns the points actually moved (bonds stay within 0..max). Mutates `b`.
 */
export function chatGain(npcId: string, b: Bond, verdict: ChatVerdict, now: number): number {
  rollBond(npcId, b, now);
  b.talked = true;
  const c = today(b, now);
  let want = 0;
  if (verdict === "good") {
    if (now - c.last < CHAT_GAIN_COOLDOWN_MS) return 0;
    want = Math.min(CHAT_GOOD_PTS, CHAT_DAILY_GAIN_CAP - c.gain);
    if (want <= 0) return 0;
  } else if (verdict === "bad") {
    want = -Math.min(-CHAT_BAD_PTS, CHAT_DAILY_LOSS_CAP - c.loss);
    if (want >= 0) return 0;
  } else return 0;
  const before = b.pts;
  b.pts = Math.max(0, Math.min(maxPoints(npcId), b.pts + want));
  const moved = b.pts - before;
  if (moved > 0) {
    c.gain += moved;
    c.last = now;
  } else if (moved < 0) c.loss -= moved;
  return moved;
}
