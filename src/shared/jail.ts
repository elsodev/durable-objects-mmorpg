// Jail rules shared by client and server: how long a sentence may be, when it ends, where a jailed
// player may stand in the police station, the sheriff's insult strikes and the /jail commands.
// Pure: every function takes `now`; nothing here grants anything (the server checks admin rights).
import { isValidName } from "./names";
import type { Vec2 } from "./types";

/** The police station: the only map with a cell. */
export const JAIL_ZONE = "int_police" as const;
/** Spawn inside the cell, and the spot just outside its door where a released player stands. */
export const CELL_SPAWN = "cell";
export const RELEASE_SPAWN = "released";

/** A sentence when the admin names no length, and the longest one allowed (a day). */
export const JAIL_DEFAULT_MINUTES = 5;
export const JAIL_MAX_MINUTES = 1440;

/** Insults the sheriff lets go with a warning; the next one is a night in the cell. */
export const SHERIFF_WARNINGS = 3;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Minutes from an admin: whole minutes 1..JAIL_MAX_MINUTES; absent means the default. Null when
 * the value is not a sensible sentence (0, negative, fractional, huge, text).
 */
export function parseJailMinutes(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return JAIL_DEFAULT_MINUTES;
  const n = typeof raw === "string" && /^\d{1,5}$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > JAIL_MAX_MINUTES) return null;
  return n;
}

/** When a sentence of `minutes` starting now ends. */
export function jailEndsAt(now: number, minutes: number): number {
  return now + minutes * 60_000;
}

/** Serving time right now? An end in the past (or none) means free. */
export function isJailed(until: number | null | undefined, now: number): boolean {
  return typeof until === "number" && Number.isFinite(until) && until > now;
}

/** Milliseconds left, 0 once free. */
export function jailLeftMs(until: number | null | undefined, now: number): number {
  return isJailed(until, now) ? until! - now : 0;
}

/** "4:32", "12:05", "1:02:03": the countdown the jailed player sees (rounded up to the second). */
export function formatJailLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * A stored sentence end, checked: a finite time no further than the longest sentence from `now`
 * (a corrupt or tampered value can't lock anyone up for ever). Undefined when there is none.
 */
export function cleanJailUntil(raw: unknown, now: number): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.min(raw, now + JAIL_MAX_MINUTES * 60_000);
}

export function inRect(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

/**
 * Where the police station must put a player: in the cell while jailed, outside it once free.
 * Null when they already stand where they belong.
 */
export function jailPlacement(jailed: boolean, pos: Vec2, cell: Rect): "cell" | "release" | null {
  const inside = inRect(cell, pos);
  if (jailed && !inside) return "cell";
  if (!jailed && inside) return "release";
  return null;
}

/**
 * One more insult to the sheriff. Strikes 1..SHERIFF_WARNINGS earn a warning (which one is
 * `warning`); the one after that jails the player and the count starts again from zero.
 */
export function nextInsult(strikes: number): { strikes: number; warning: number; jail: boolean } {
  const before = Number.isInteger(strikes) && strikes > 0 ? Math.min(strikes, SHERIFF_WARNINGS) : 0;
  if (before >= SHERIFF_WARNINGS) return { strikes: 0, warning: 0, jail: true };
  return { strikes: before + 1, warning: before + 1, jail: false };
}

/** A saved strike count, checked. */
export function cleanStrikes(raw: unknown): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? Math.min(raw, SHERIFF_WARNINGS) : 0;
}

/** "1 minute", "5 minutes", "1 hour", "1 hour 30 minutes". */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (h === 0) return part(m, "minute");
  return m === 0 ? part(h, "hour") : `${part(h, "hour")} ${part(m, "minute")}`;
}

/** What the jailed player is told when the door clangs shut. */
export function jailedText(minutes: number, bySheriff: boolean): string {
  return bySheriff
    ? `The sheriff locks you in the cell for ${minutesLabel(minutes)}. Mind your manners next time!`
    : `You've been sent to jail for ${minutesLabel(minutes)}.`;
}

export const RELEASED_TEXT = "Your time is up. You're free to go!";
export const UNJAILED_TEXT = "You've been let out of jail.";
export const JAILED_REFUSAL = "You're in jail until your time is up.";

export type JailCommand =
  | { cmd: "jail"; name: string; minutes: number }
  | { cmd: "unjail"; name: string }
  | { cmd: "error"; message: string };

const JAIL = /^\/jail(?:\s+|$)(.*)$/is;
const UNJAIL = /^\/(?:unjail|release)(?:\s+|$)(.*)$/is;

/** "/jail name [minutes]" and "/unjail name" (admins only; the server checks again). */
export function parseJailCommand(line: string): JailCommand | null {
  const text = line.trim();
  let m: RegExpExecArray | null;
  if ((m = JAIL.exec(text))) {
    const [name = "", minutes, ...rest] = m[1]!.trim().split(/\s+/).filter(Boolean);
    if (!name) return { cmd: "error", message: `Usage: /jail name [minutes] (default ${JAIL_DEFAULT_MINUTES}, at most ${JAIL_MAX_MINUTES})` };
    if (!isValidName(name)) return { cmd: "error", message: `"${String(name).slice(0, 20)}" isn't a player name.` };
    const mins = rest.length > 0 ? null : parseJailMinutes(minutes);
    if (mins === null) return { cmd: "error", message: `Jail time is whole minutes from 1 to ${JAIL_MAX_MINUTES}.` };
    return { cmd: "jail", name, minutes: mins };
  }
  if ((m = UNJAIL.exec(text))) {
    const name = m[1]!.trim().split(/\s+/)[0] ?? "";
    if (!name) return { cmd: "error", message: "Usage: /unjail name" };
    if (!isValidName(name)) return { cmd: "error", message: `"${String(name).slice(0, 20)}" isn't a player name.` };
    return { cmd: "unjail", name };
  }
  return null;
}
