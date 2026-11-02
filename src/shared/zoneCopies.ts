// Zone copies: one shared map (the village, the caves...) runs as several Durable Objects when it
// gets busy. Copy 1 is the original object (named by the zone id, so nothing about existing
// worlds changes); copy n > 1 is named "<zone>~n". A copy refuses a join once it holds ZONE_CAP
// players and the Worker tries the next one. Pure.

/** Players one zone copy takes. Keeps every copy well under a Durable Object's request budget. */
export const ZONE_CAP = 60;
/** Most copies of one zone; past this, joining says the zone is full. */
export const MAX_COPIES = 8;
/** Status and header a full copy answers a join with, so the Worker tries the next copy. */
export const FULL_STATUS = 409;
export const FULL_HEADER = "x-dmmo-zone-full";

/** Durable Object name of copy `n` of `zone`. */
export function copyName(zone: string, n: number): string {
  return n <= 1 ? zone : `${zone}~${n}`;
}

export function isCopyNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_COPIES;
}

/** "?copy=3" -> 3; anything else -> null. */
export function parseCopy(raw: string | null | undefined): number | null {
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return isCopyNumber(n) ? n : null;
}

/** The order the Worker tries copies in: the one asked for (to stay with friends or rejoin) first, then lowest first. */
export function copyOrder(preferred: number | null): number[] {
  const all = Array.from({ length: MAX_COPIES }, (_, i) => i + 1);
  return preferred ? [preferred, ...all.filter((n) => n !== preferred)] : all;
}

/** Whether a copy holding `players` (plus `joining` still loading) has room for one more. */
export function hasRoom(players: number, joining: number, cap = ZONE_CAP): boolean {
  return players + joining < cap;
}

/** ZONE_CAP from the environment (local testing only lowers it); anything else gives the default. */
export function capFromEnv(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= ZONE_CAP ? n : ZONE_CAP;
}

/** Zone title with the copy when it isn't the first: "Mossbrook Village · 2". */
export function copyTitle(title: string, copy: number | undefined): string {
  return copy && copy > 1 ? `${title} · ${copy}` : title;
}
