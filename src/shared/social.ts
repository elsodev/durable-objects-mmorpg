// Social features shared by client and server: emotes, chat channels and command parsing, and the
// protocol of the global social socket (/ws/social -> SocialRoom: world chat, whispers, presence,
// stats). Pure: no DOM, no Workers APIs.
import { POSE_COMMANDS, type PoseCode } from "./poses";
import { cleanChat, MAX_CHAT_LEN } from "./validate";
import { CAVE_DEPTH_ZONES, type ZoneId } from "./types";
import { isValidName } from "./names";
import { EMOTES, isEmote, type EmoteCode } from "./emotes";
import { cleanReason, cleanShout, type Shout } from "./admin";

// ---------------------------------------------------------------- emotes

export { EMOTES, EMOTE_MS, EMOTE_MIN_INTERVAL_MS, isEmote, type EmoteCode } from "./emotes";

const EMOTE_ALIASES: Record<string, EmoteCode> = {
  hi: "wave",
  hello: "wave",
  love: "heart",
  lol: "laugh",
  haha: "laugh",
  mad: "angry",
  cry: "sad",
  zzz: "sleepy",
  sleep: "sleepy",
  wow: "surprised",
  note: "music",
  song: "music",
  bulb: "idea",
  phew: "sweat",
  thumbsup: "ok",
  yes: "ok",
  ty: "thanks",
  thx: "thanks",
};


/** "Wave", "wave", "hi" -> "wave"; unknown -> null. */
export function emoteFrom(raw: string): EmoteCode | null {
  const k = raw.trim().toLowerCase();
  if (isEmote(k)) return k;
  return Object.hasOwn(EMOTE_ALIASES, k) ? EMOTE_ALIASES[k]! : null;
}

/** Chat-log line for an emote: "Ann waves". */
export function emoteVerb(code: EmoteCode): string {
  const verbs: Record<EmoteCode, string> = {
    wave: "waves",
    heart: "sends love",
    laugh: "laughs",
    angry: "is angry",
    sad: "is sad",
    sleepy: "is sleepy",
    surprised: "is surprised",
    music: "hums a tune",
    idea: "has an idea",
    sweat: "sweats",
    ok: "gives a thumbs up",
    thanks: "says thanks",
  };
  return verbs[code];
}

// ---------------------------------------------------------------- bubbles

export const BUBBLE_WORDS = 5;

/** Speech bubbles show at most `max` words, then "…"; the chat log keeps the full line. */
export function truncateWords(text: string, max = BUBBLE_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ")}…`;
}

// ---------------------------------------------------------------- channels & input

export type ChatChannel = "zone" | "world" | "pm" | "system";
export type ChatTab = "all" | "world" | "zone" | "pm";
export const CHAT_TABS: readonly ChatTab[] = ["all", "world", "zone", "pm"];

export type ChatIntent =
  | { kind: "zone"; text: string }
  | { kind: "world"; text: string }
  | { kind: "pm"; to: string; text: string }
  | { kind: "emote"; code: EmoteCode }
  | { kind: "pose"; pose: PoseCode }
  | { kind: "error"; message: string };

/** Which channel plain text (no command) goes to from the selected tab. */
export function defaultChannel(tab: ChatTab): "zone" | "world" | "pm" {
  return tab === "world" ? "world" : tab === "pm" ? "pm" : "zone";
}

const POSE = /^\/(\w+)\s*$/;
const WHISPER = /^\/(?:w|whisper|msg|tell|pm)(?:\s+|$)(.*)$/is;
const REPLY = /^\/(?:r|reply)(?:\s+|$)(.*)$/is;
const WORLD = /^\/(?:world|g|global)(?:\s+|$)(.*)$/is;
const ZONE = /^\/(?:zone|s|say)(?:\s+|$)(.*)$/is;
const EMOTE = /^\/(?:emote|e|em)(?:\s+|$)(.*)$/is;

function splitName(rest: string): { name: string; text: string } {
  const m = /^(\S+)\s*(.*)$/s.exec(rest.trim());
  return m ? { name: m[1]!, text: m[2]! } : { name: "", text: "" };
}

/**
 * Parses what the player typed. `tab` picks the channel for plain text; `replyTo` is whoever
 * whispered last (for /r and plain text in the PM tab). Unknown "/commands" go to zone chat so
 * zone-side commands (e.g. the local "/day" dev tool) keep working.
 */
export function parseChatInput(raw: string, tab: ChatTab, replyTo: string | null): ChatIntent | null {
  const line = cleanChat(raw);
  if (!line) return null;
  let m: RegExpExecArray | null;
  if ((m = WHISPER.exec(line))) {
    const { name, text } = splitName(m[1]!);
    if (!name) return { kind: "error", message: "Usage: /w name message" };
    if (!isValidName(name)) return { kind: "error", message: `"${String(name).slice(0, 20)}" isn't a player name.` };
    const t = cleanChat(text);
    return t ? { kind: "pm", to: name, text: t } : { kind: "error", message: `What do you want to whisper to ${name}?` };
  }
  if ((m = REPLY.exec(line))) {
    if (!replyTo) return { kind: "error", message: "Nobody has whispered to you yet." };
    const t = cleanChat(m[1]);
    return t ? { kind: "pm", to: replyTo, text: t } : { kind: "error", message: `Usage: /r message (replies to ${replyTo})` };
  }
  if ((m = WORLD.exec(line))) {
    const t = cleanChat(m[1]);
    return t ? { kind: "world", text: t } : { kind: "error", message: "Usage: /world message" };
  }
  if ((m = ZONE.exec(line))) {
    const t = cleanChat(m[1]);
    return t ? { kind: "zone", text: t } : { kind: "error", message: "Usage: /zone message" };
  }
  if ((m = EMOTE.exec(line))) {
    const code = emoteFrom(m[1] ?? "");
    return code ? { kind: "emote", code } : { kind: "error", message: `Emotes: ${EMOTES.join(", ")}` };
  }
  if ((m = POSE.exec(line))) {
    const pose = POSE_COMMANDS[m[1]!.toLowerCase()];
    if (pose) return { kind: "pose", pose };
  }
  // Other "/commands" belong to the zone (e.g. the local "/day" dev tool), whatever the tab.
  if (line.startsWith("/")) return { kind: "zone", text: line };
  const ch = defaultChannel(tab);
  if (ch === "pm") return replyTo ? { kind: "pm", to: replyTo, text: line } : { kind: "error", message: "Use /w name message to whisper." };
  return { kind: ch, text: line };
}

// ---------------------------------------------------------------- social socket protocol

export interface WorldLine {
  name: string;
  text: string;
  at: number;
}

/** Presence as other Durable Objects see it (SocialRoom.presenceOf). Zone name only, never a position. */
export interface PresenceView {
  userId: string;
  online: boolean;
  zone: ZoneId | null;
}

export interface SocialStats {
  online: number;
  zones: Partial<Record<ZoneId, number>>;
  /** Server-wide counters for the current UTC day, e.g. { crops_shipped: 12 }. */
  today: Record<string, number>;
  day: string;
}

export type SocialClientMsg =
  | { t: "world"; text: string }
  | { t: "pm"; to: string; text: string }
  /** Fallback only: the server prefers the zone ZoneRoom/HomeRoom report via RPC. */
  | { t: "here"; zone: ZoneId }
  | { t: "stats" }
  | { t: "ping"; at: number }
  /** Admins only (the server checks): a banner for everyone online. */
  | { t: "shout"; text: string }
  /** Admins only: disconnect a player and keep them out. */
  | { t: "kick"; name: string; reason?: string }
  /** Admins only: let a removed player back in. */
  | { t: "unban"; name: string };

export type SocialServerMsg =
  /** `admin` only for admins; `shout` is the latest announcement when it is a few minutes old at most. */
  | { t: "hello"; name: string; guest: boolean; history: WorldLine[]; admin?: true; shout?: Shout }
  | ({ t: "world" } & WorldLine)
  /** dir "in": `name` whispered you; "out": echo of what you sent to `name`. */
  | { t: "pm"; dir: "in" | "out"; name: string; text: string; at: number }
  | ({ t: "stats" } & SocialStats)
  | { t: "notice"; text: string; kind: "info" | "error" }
  /** Delivered from another Durable Object through SocialRoom.notify (e.g. home invites). */
  | { t: "social"; payload: { t: string } & Record<string, unknown> }
  | { t: "pong"; at: number }
  /** A global announcement (shared/admin.ts): every client shows the banner. */
  | ({ t: "shout" } & Shout)
  /** You were removed by an admin; the socket closes with CLOSE_REMOVED next. */
  | { t: "removed"; text: string };

const ZONE_IDS: readonly ZoneId[] = ["village", "riverside", "caves", "quarry", ...CAVE_DEPTH_ZONES, "home"];
export const MAX_SOCIAL_FRAME = 1024;

/** Validates a social socket frame, copying only known fields. */
export function decodeSocialClient(raw: unknown): SocialClientMsg | null {
  if (typeof raw !== "string" || raw.length > MAX_SOCIAL_FRAME) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case "world": {
      const text = cleanChat(o.text);
      return text ? { t: "world", text } : null;
    }
    case "pm": {
      const text = cleanChat(o.text);
      return text && isValidName(o.to) ? { t: "pm", to: o.to, text } : null;
    }
    case "here":
      return typeof o.zone === "string" && (ZONE_IDS as readonly string[]).includes(o.zone) ? { t: "here", zone: o.zone as ZoneId } : null;
    case "stats":
      return { t: "stats" };
    case "ping":
      return typeof o.at === "number" && Number.isFinite(o.at) ? { t: "ping", at: o.at } : null;
    case "shout": {
      const text = cleanShout(o.text);
      return text ? { t: "shout", text } : null;
    }
    case "kick": {
      if (!isValidName(o.name)) return null;
      const reason = cleanReason(o.reason);
      return reason ? { t: "kick", name: o.name, reason } : { t: "kick", name: o.name };
    }
    case "unban":
      return isValidName(o.name) ? { t: "unban", name: o.name } : null;
    default:
      return null;
  }
}

export function decodeSocialServer(raw: unknown): SocialServerMsg | null {
  if (typeof raw !== "string") return null;
  try {
    const m = JSON.parse(raw);
    return m && typeof m === "object" && typeof m.t === "string" ? (m as SocialServerMsg) : null;
  } catch {
    return null;
  }
}

export { MAX_CHAT_LEN };
