// Emote codes (kept apart from social.ts so validate.ts can import them without a cycle).
export const EMOTES = [
  "wave",
  "heart",
  "laugh",
  "angry",
  "sad",
  "sleepy",
  "surprised",
  "music",
  "idea",
  "sweat",
  "ok",
  "thanks",
] as const;
export type EmoteCode = (typeof EMOTES)[number];
/** Bubbles only the server shows (a frightened animal); players can't send these. */
export const SERVER_EMOTES = ["scared"] as const;
/** Anything a bubble can show: a player emote or a server-only one. */
export type BubbleCode = EmoteCode | (typeof SERVER_EMOTES)[number];
export const BUBBLES: readonly BubbleCode[] = [...EMOTES, ...SERVER_EMOTES];
export const EMOTE_MS = 3000;
/** Minimum gap between two emotes from one player. */
export const EMOTE_MIN_INTERVAL_MS = 800;

export function isEmote(code: unknown): code is EmoteCode {
  return typeof code === "string" && (EMOTES as readonly string[]).includes(code);
}
