// Player card (right-click on a player) and per-account mutes: API shapes, lifetime stat counters
// and the /mute command, shared by the Worker (src/worker/players, src/worker/mutes) and the client.
// Pure: no DOM, no Workers APIs.

/** Lifetime counters kept in the player's save (HomeRoom), bumped where the events already happen. */
export interface PlayerStats {
  cropsHarvested: number;
  monstersDefeated: number;
  oresMined: number;
}

export type StatKey = keyof PlayerStats;
export const STAT_KEYS: readonly StatKey[] = ["cropsHarvested", "monstersDefeated", "oresMined"];
const STAT_MAX = 1e9;

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(STAT_MAX, Math.floor(v)) : 0;
}

/** Trusted copy of whatever a save holds (absent or bad counters read as 0). */
export function cleanStats(raw: unknown): PlayerStats {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { cropsHarvested: count(r.cropsHarvested), monstersDefeated: count(r.monstersDefeated), oresMined: count(r.oresMined) };
}

/** Adds one (or `n`) to a counter, in place. Returns the stats for chaining. */
export function bumpStat(stats: PlayerStats, key: StatKey, n = 1): PlayerStats {
  stats[key] = Math.min(STAT_MAX, count(stats[key]) + count(n));
  return stats;
}

/**
 * Counters only ever grow, so a save from a zone merges by taking the larger of each: a late or
 * duplicated save can't roll a counter back.
 */
export function mergeStats(a: unknown, b: unknown): PlayerStats {
  const x = cleanStats(a);
  const y = cleanStats(b);
  return {
    cropsHarvested: Math.max(x.cropsHarvested, y.cropsHarvested),
    monstersDefeated: Math.max(x.monstersDefeated, y.monstersDefeated),
    oresMined: Math.max(x.oresMined, y.oresMined),
  };
}

/** How the viewer and the card's player are related. "outgoing": you asked them; "incoming": they asked you. */
export type Friendship = "self" | "friends" | "outgoing" | "incoming" | "none";

/**
 * GET /api/players/:id/card. Public info only: never an email, never a position. `minimal` cards
 * (a guest looking, or a guest being looked at) carry only the name and flags.
 */
export interface PlayerCard {
  userId: string;
  name: string;
  self: boolean;
  /** The card's player is a guest (no account). */
  guest: boolean;
  minimal: boolean;
  online: boolean;
  /** Only for yourself, friends, or someone in the same zone as you; else null. */
  zone: string | null;
  /** Account creation day, "YYYY-MM-DD" (UTC). */
  joined: string | null;
  /** The player's home calendar day (days farmed). */
  homeDay: number | null;
  stats: PlayerStats | null;
  /** Their level (shared/leveling.ts); absent on minimal cards and homes that predate levels. */
  level?: number;
  friendship: Friendship;
  /** You muted them. */
  muted: boolean;
}

/** Card lookups per viewer per window (each is a D1 read or two plus a HomeRoom call). */
export const CARD_RATE_MAX = 60;
export const CARD_RATE_WINDOW_MS = 60_000;

/** "YYYY-MM-DD" for Better Auth's createdAt (epoch ms/seconds number or a date string), else null. */
export function joinDay(raw: unknown): string | null {
  let ms: number;
  if (typeof raw === "number" && Number.isFinite(raw)) ms = raw < 1e11 ? raw * 1000 : raw;
  else if (typeof raw === "string" && raw) {
    const n = Number(raw);
    ms = Number.isFinite(n) && /^\d+$/.test(raw) ? (n < 1e11 ? n * 1000 : n) : Date.parse(raw.includes("T") || raw.endsWith("Z") ? raw : `${raw.replace(" ", "T")}Z`);
  } else return null;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ mutes

export const MAX_MUTES = 200;

export interface MutedEntry {
  userId: string;
  name: string;
  at: number;
}

/** GET /api/mutes */
export interface MutedList {
  muted: MutedEntry[];
}

/** POST /api/mutes -> 201/200; DELETE /api/mutes/:id -> 200. */
export interface MuteResult {
  status: "muted" | "unmuted";
  user: { userId: string; name: string };
}

/**
 * Pushed (SocialRoom.notify) to the muter's own sockets when their list changes, so other
 * devices refresh. Never sent to the muted player: mute is silent.
 */
export interface MutesChangedNotice {
  t: "mutes";
}
export const MUTES_NOTICE = "mutes";

/** `/mute name` or `/unmute name` typed in chat; null for anything else. Name may be empty/invalid. */
export function parseMuteCommand(text: string): { cmd: "mute" | "unmute"; name: string } | null {
  const m = /^\/(mute|unmute)(?:\s+(.*))?$/i.exec(text.trim());
  if (!m) return null;
  return { cmd: m[1]!.toLowerCase() as "mute" | "unmute", name: (m[2] ?? "").trim() };
}

/** Player entity ids are "p:<userId>"; null for NPCs, monsters and anything else. */
export function userIdOfEntity(entityId: string): string | null {
  return entityId.startsWith("p:") && entityId.length > 2 ? entityId.slice(2) : null;
}
