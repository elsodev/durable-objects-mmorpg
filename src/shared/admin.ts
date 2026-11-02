// Admin tools shared by client and server: the /shout, /kick, /unban, /jail and /unjail commands, shout text rules
// and the "removed" signals. Pure: no DOM, no Workers APIs. Who is an admin is decided only by the
// Worker (ADMIN_EMAILS); nothing here grants anything.
import { isValidName } from "./names";
import { parseJailCommand } from "./jail";

/** Longest shout, in code points. Long enough for a sentence, short enough to read as it scrolls. */
export const SHOUT_MAX_LEN = 200;
/** Longest kick reason kept in the log, in code points. */
export const KICK_REASON_MAX_LEN = 120;
/** One shout per admin this often, so a banner can't be spammed over everyone's screen. */
export const SHOUT_MIN_INTERVAL_MS = 10_000;
/** Players who come online this soon after a shout still see it. */
export const SHOUT_LATE_JOIN_MS = 5 * 60_000;

/** What a removed player is told, everywhere. */
export const REMOVED_TEXT = "You've been removed from Mossbrook.";
/** WebSocket close code for a removed player: the client shows the removed screen and stops. */
export const CLOSE_REMOVED = 4451;
/** HTTP status the Worker answers a removed player with (sockets, /api/*, sign-in). */
export const HTTP_REMOVED = 451;
/** Better Auth style error code on refused sign-in / sign-up. */
export const REMOVED_CODE = "REMOVED";

/** A global announcement as the server broadcasts it. */
export interface Shout {
  id: string;
  /** The admin who shouted (display name). */
  name: string;
  text: string;
  at: number;
}

// Control, format and line/paragraph separators (bidi overrides included): shouts are one plain line.
// eslint-disable-next-line no-control-regex
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2064\u2066-\u2069\ufeff]/g;

function capPlain(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const flat = raw.replace(UNPRINTABLE, " ").replace(/\s+/g, " ").trim();
  const capped = Array.from(flat).slice(0, max).join("").trim();
  return capped.length > 0 ? capped : null;
}

/** Shout text: one line of plain text, 1..SHOUT_MAX_LEN code points; null when nothing is left. */
export function cleanShout(raw: unknown): string | null {
  return capPlain(raw, SHOUT_MAX_LEN);
}

/** Kick reason: optional; "" when absent or empty. */
export function cleanReason(raw: unknown): string {
  return capPlain(raw, KICK_REASON_MAX_LEN) ?? "";
}

export type AdminCommand =
  | { cmd: "shout"; text: string }
  | { cmd: "kick"; name: string; reason: string }
  | { cmd: "unban"; name: string }
  /** Lock a player in the police station cell for `minutes` (shared/jail.ts). */
  | { cmd: "jail"; name: string; minutes: number }
  | { cmd: "unjail"; name: string }
  | { cmd: "error"; message: string };

const SHOUT = /^\/(?:shout|announce)(?:\s+|$)(.*)$/is;
const KICK = /^\/kick(?:\s+|$)(.*)$/is;
const UNBAN = /^\/unban(?:\s+|$)(.*)$/is;

/**
 * Parses an admin's chat line. Only called for admins (the client asks the server who it is, and
 * the server checks again); null means "not an admin command".
 */
export function parseAdminCommand(line: string): AdminCommand | null {
  const text = line.trim();
  let m: RegExpExecArray | null;
  if ((m = SHOUT.exec(text))) {
    const t = cleanShout(m[1]);
    return t ? { cmd: "shout", text: t } : { cmd: "error", message: "Usage: /shout message" };
  }
  if ((m = KICK.exec(text))) {
    const [name = "", ...rest] = m[1]!.trim().split(/\s+/);
    if (!name) return { cmd: "error", message: "Usage: /kick name [reason]" };
    if (!isValidName(name)) return { cmd: "error", message: `"${String(name).slice(0, 20)}" isn't a player name.` };
    return { cmd: "kick", name, reason: cleanReason(rest.join(" ")) };
  }
  if ((m = UNBAN.exec(text))) {
    const name = m[1]!.trim().split(/\s+/)[0] ?? "";
    if (!name) return { cmd: "error", message: "Usage: /unban name" };
    if (!isValidName(name)) return { cmd: "error", message: `"${String(name).slice(0, 20)}" isn't a player name.` };
    return { cmd: "unban", name };
  }
  return parseJailCommand(text);
}

/** A shout is still worth showing to someone who just came online. */
export function shoutIsFresh(shout: Pick<Shout, "at"> | null | undefined, now: number): boolean {
  return !!shout && now - shout.at >= 0 && now - shout.at < SHOUT_LATE_JOIN_MS;
}

/** A server shout frame, checked field by field (the client treats it as untrusted). */
export function readShout(raw: unknown): Shout | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0 || o.id.length > 64) return null;
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return null;
  const text = cleanShout(o.text);
  if (!text) return null;
  const name = typeof o.name === "string" ? o.name.slice(0, 24) : "";
  return { id: o.id, name, text, at: o.at };
}
