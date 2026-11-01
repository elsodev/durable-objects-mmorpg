// Situation-aware dialogue: what the villager knows about "now" (world date, hour, zone, hearts,
// birthday), the tone they take by heart level, and which scripted line key applies. Pure, so
// ZoneRoom, the NpcAgent prompt and the scripted fallback all agree.
import type { Season, Weekday } from "../../shared/calendar";
import { SHARED_ZONES, type SharedZoneId } from "../../shared/types";

export interface Situation {
  /** Hearts with this player, 0..10. */
  hearts: number;
  zone: SharedZoneId;
  /** UTC hour, 0..23 (public zones keep UTC time). */
  hour: number;
  weekday: Weekday;
  season: Season;
  /** Day of the season, 1..28. */
  day: number;
  /** Today is this villager's birthday. */
  birthday: boolean;
}

/** Heart-gated keys, warmest first: the first one at or under the player's hearts wins. */
export const HEART_KEYS: readonly (readonly [number, string])[] = [
  [9, "hearts9"],
  [6, "hearts6"],
  [2, "hearts2"],
];

/**
 * Line keys to try for this situation, highest priority first:
 * birthday, hearts band, weekday, season, then "default".
 */
export function lineKeys(sit: Situation): string[] {
  const keys: string[] = [];
  if (sit.birthday) keys.push("birthday");
  for (const [min, key] of HEART_KEYS) if (sit.hearts >= min) keys.push(key);
  keys.push(sit.weekday, sit.season, "default");
  return keys;
}

/** The first key in priority order that has lines, or null. */
export function pickLineKey(lines: Partial<Record<string, readonly string[]>>, sit: Situation): string | null {
  for (const k of lineKeys(sit)) {
    const l = Object.hasOwn(lines, k) ? lines[k] : undefined;
    if (l && l.length > 0) return k;
  }
  return null;
}

export type HeartBand = "polite" | "friendly" | "warm" | "close";

export function heartBand(hearts: number): HeartBand {
  if (hearts >= 9) return "close";
  if (hearts >= 6) return "warm";
  if (hearts >= 2) return "friendly";
  return "polite";
}

const TONE: Record<HeartBand, string> = {
  polite: "You barely know this visitor: be polite and a little reserved, like with a newcomer.",
  friendly: "You know this visitor a bit: be friendly and relaxed, use their name.",
  warm: "This visitor is a good friend: be warm, share small personal things, tease gently.",
  close: "This visitor is one of your closest friends: be openly fond, confide in them, remember shared moments.",
};

export function toneGuide(hearts: number): string {
  return TONE[heartBand(hearts)];
}

export function timeOfDay(hour: number): string {
  if (hour < 5) return "the middle of the night";
  if (hour < 9) return "early morning";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

const WEEKDAY_NAME: Record<Weekday, string> = {
  Sun: "Sunday",
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
};
const OUTDOOR_NAME: Record<string, string> = { village: "the village", riverside: "the riverside", caves: "the caves" };
const ROOM_NAME: Record<string, string> = { int_townhall: "the town hall", int_inn: "the inn", int_smithy: "the smithy" };

/** Plain place name for a zone ("the inn", "Bram's house"). */
export function zonePlace(zone: SharedZoneId): string {
  if (Object.hasOwn(OUTDOOR_NAME, zone)) return OUTDOOR_NAME[zone]!;
  if (Object.hasOwn(ROOM_NAME, zone)) return ROOM_NAME[zone]!;
  const owner = zone.startsWith("int_house_") ? zone.slice("int_house_".length) : "";
  return owner ? `${owner.charAt(0).toUpperCase()}${owner.slice(1)}'s house` : "the valley";
}

/** One "situation" line for the prompt, plus the tone guide. Never contains player-written text. */
export function renderSituation(sit: Situation): string {
  const season = sit.season.charAt(0).toUpperCase() + sit.season.slice(1);
  const parts = [
    `It is ${WEEKDAY_NAME[sit.weekday]}, ${season} ${sit.day}, ${timeOfDay(sit.hour)}, and you are in ${zonePlace(sit.zone)}.`,
    `You have ${sit.hearts} of 10 hearts of friendship with this visitor.`,
  ];
  if (sit.birthday) parts.push("Today is your birthday.");
  parts.push(toneGuide(sit.hearts));
  return parts.join(" ");
}

/** Validates a Situation that crossed an RPC boundary; null when anything is off. */
export function cleanSituation(raw: unknown): Situation | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
  if (!int(o.hearts, 0, 10) || !int(o.hour, 0, 23) || !int(o.day, 1, 28)) return null;
  if (typeof o.zone !== "string" || !(SHARED_ZONES as readonly string[]).includes(o.zone)) return null;
  if (typeof o.weekday !== "string" || !Object.hasOwn(WEEKDAY_NAME, o.weekday)) return null;
  if (o.season !== "spring" && o.season !== "summer" && o.season !== "fall" && o.season !== "winter") return null;
  return {
    hearts: o.hearts,
    zone: o.zone as SharedZoneId,
    hour: o.hour,
    weekday: o.weekday as Weekday,
    season: o.season,
    day: o.day,
    birthday: o.birthday === true,
  };
}
