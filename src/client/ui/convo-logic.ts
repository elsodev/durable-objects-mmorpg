// Pure rules for the conversation window (ui/convo.ts): what to keep, when to send, when to close.
import { CONVO_RANGE } from "../../shared/npcChat";
import { MAX_CHAT_LEN } from "../../shared/validate";

/** Lines kept in the window's log; older ones scroll away for good. */
export const MAX_CONVO_LINES = 40;
/** The server refuses chat closer together than a second; wait a touch longer. */
export const SEND_GAP_MS = 1100;
/** "…" waits this long for an answer before giving up. */
export const ANSWER_WAIT_MS = 12_000;

export type ConvoWho = "npc" | "you" | "note";

export interface ConvoLine {
  who: ConvoWho;
  text: string;
  /** A note about gifts handed over (shown as item chips after the text). */
  gifts?: readonly string[];
}

/** One line, clipped to what the server would ever send. */
export function clipLine(text: string, max = MAX_CHAT_LEN): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Appends a line, keeping at most MAX_CONVO_LINES. Returns a new array. */
export function pushLine(lines: readonly ConvoLine[], line: ConvoLine): ConvoLine[] {
  const next = [...lines, { who: line.who, text: clipLine(line.text), ...(line.gifts?.length ? { gifts: line.gifts.slice(0, 8) } : {}) }];
  return next.length > MAX_CONVO_LINES ? next.slice(next.length - MAX_CONVO_LINES) : next;
}

/** What Send would send, or null (empty, a command, or too soon after the last one). */
export function sendable(raw: string, lastSentAt: number, now: number): string | null {
  const text = raw.trim().slice(0, MAX_CHAT_LEN);
  if (!text || text.startsWith("/")) return null;
  if (now - lastSentAt < SEND_GAP_MS) return null;
  return text;
}

/** Walked away (or they did): the window closes. Null means they are out of view. */
export function outOfRange(distance: number | null): boolean {
  return distance === null || distance > CONVO_RANGE;
}

/** The little heart change shown in the window: direction only, no reason. */
export function heartChange(delta: number): { text: string; dir: "up" | "down" } | null {
  if (delta === 0 || !Number.isFinite(delta)) return null;
  return delta > 0 ? { text: "+♥", dir: "up" } : { text: "−♥", dir: "down" };
}
