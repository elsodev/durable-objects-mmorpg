// GET /api/players/:id/card: the right-click player card. Session-checked and rate-limited.
// Public info only: name, online, join day, home day, lifetime counters, how you two are related.
// Never an email or a position. Zone shows only for yourself, friends, or someone in your zone.
// A guest looking, or a guest being looked at, gets a minimal card (name and flags).
import type { AuthUser } from "../auth";
import type { Env } from "../env";
import { errorJson, json } from "../http/util";
import { takeQuota } from "../http/rate";
import { socialAdapter } from "../social-adapter";
import { areFriends, hasRequest } from "../friends/store";
import { isMutedBy } from "../mutes/store";
import { isUserId } from "../../shared/friends";
import { CARD_RATE_MAX, CARD_RATE_WINDOW_MS, joinDay, type Friendship, type PlayerCard, type PlayerStats } from "../../shared/players";

export const PLAYERS_PREFIX = "/api/players/";

/** What a HomeRoom tells the card (HomeRoom.cardPeek). */
export interface CardPeek {
  homeDay: number | null;
  stats: PlayerStats | null;
}

export interface CardHomeNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { cardPeek(): Promise<CardPeek> };
}

export type CardEnv = Pick<Env, "DB"> & { HOME: CardHomeNamespace };

/** The user id in /api/players/:id/card, or null when the path isn't that route. */
export function parseCardPath(pathname: string): string | null {
  const m = /^\/api\/players\/([^/]+)\/card$/.exec(pathname);
  if (!m) return null;
  try {
    const id = decodeURIComponent(m[1]!);
    return isUserId(id) ? id : null;
  } catch {
    return null;
  }
}

export function isPlayersPath(pathname: string): boolean {
  return pathname.startsWith(PLAYERS_PREFIX);
}

interface UserRow {
  id: string;
  name: string;
  createdAt: unknown;
  isAnonymous: number | null;
}

async function friendship(db: D1Database, me: string, them: string): Promise<Friendship> {
  if (me === them) return "self";
  if (await areFriends(db, me, them)) return "friends";
  if (await hasRequest(db, me, them)) return "outgoing";
  // A request from someone you muted stays hidden, as it does in your Friends panel.
  if ((await hasRequest(db, them, me)) && !(await isMutedBy(db, me, them))) return "incoming";
  return "none";
}

async function peek(env: CardEnv, userId: string): Promise<CardPeek> {
  try {
    const r = await env.HOME.get(env.HOME.idFromName(userId)).cardPeek();
    return { homeDay: r?.homeDay ?? null, stats: r?.stats ?? null };
  } catch (err) {
    // A home that can't answer only costs the card its numbers.
    console.warn("card peek failed", err);
    return { homeDay: null, stats: null };
  }
}

export async function handlePlayerCard(request: Request, env: CardEnv, user: AuthUser | null, now = Date.now()): Promise<Response> {
  const { pathname } = new URL(request.url);
  const targetId = parseCardPath(pathname);
  if (!targetId) return errorJson(404, "not found");
  if (request.method !== "GET") return errorJson(405, "method not allowed");
  if (!user) return errorJson(401, "sign in required");
  // Before any lookup, so it also bounds probing which ids exist.
  if (!(await takeQuota(env.DB, `players:card:${user.id}`, now, CARD_RATE_WINDOW_MS, CARD_RATE_MAX))) {
    return errorJson(429, "Slow down a little.");
  }
  const row = await env.DB.prepare(`SELECT id, name, createdAt, isAnonymous FROM "user" WHERE id = ?`).bind(targetId).first<UserRow>();
  if (!row) return errorJson(404, "No such player.");
  const self = row.id === user.id;
  const targetGuest = Number(row.isAnonymous ?? 0) === 1;
  const base: PlayerCard = {
    userId: row.id,
    name: row.name,
    self,
    guest: targetGuest,
    minimal: true,
    online: false,
    zone: null,
    joined: null,
    homeDay: null,
    stats: null,
    friendship: self ? "self" : "none",
    muted: false,
  };
  if ((user.isGuest || targetGuest) && !self) return json(base);

  const social = socialAdapter(env);
  const [[them, mine], rel, muted, home] = await Promise.all([
    social.presenceOf([row.id, user.id]),
    friendship(env.DB, user.id, row.id),
    self ? Promise.resolve(false) : isMutedBy(env.DB, user.id, row.id),
    peek(env, row.id),
  ]);
  const online = them?.online ?? false;
  const theirZone = online ? (them?.zone ?? null) : null;
  // "home" names everyone's own home, so sharing it says nothing: only friends see it.
  const sameZone = !!theirZone && theirZone !== "home" && mine?.online === true && mine.zone === theirZone;
  const card: PlayerCard = {
    ...base,
    minimal: false,
    online,
    zone: self || rel === "friends" || sameZone ? theirZone : null,
    joined: joinDay(row.createdAt),
    homeDay: home.homeDay,
    stats: home.stats,
    friendship: rel,
    muted,
  };
  return json(card);
}
