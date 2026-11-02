// Identity helpers: everything here derives from the verified x-dmmo-* headers only.
import { H_ADMIN, H_GUEST, H_IP, H_SESSION, H_SPAWN, H_USER_ID, H_USER_NAME } from "../env";
import type { VisitAttachment } from "../visit/visitors";
import { coerceName } from "../../shared/names";
import type { HomeMapId } from "../../shared/types";

export const PLAYER_SPRITES = ["player_1", "player_2", "player_3", "player_4"] as const;
export const PLAYER_MAX_HP = 100;

/** FNV-1a; stable across isolates so a player keeps their look. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function spriteForUser(userId: string): string {
  return PLAYER_SPRITES[hashString(userId) % PLAYER_SPRITES.length];
}

/**
 * Display names are untrusted text. New names already follow shared/names.ts (enforced at sign-up);
 * older ones are coerced into the same alphabet: 3-16 of [A-Za-z0-9_], never empty.
 */
export function cleanName(name: unknown): string {
  return coerceName(name, "Farmer");
}

export interface Identity {
  userId: string;
  name: string;
  guest: boolean;
  /** Raw spawn header, or null when absent (reconnect: use the saved position). */
  spawn: string | null;
  /** Better Auth session id (re-checked periodically), or null if the Worker sent none. */
  sessionId: string | null;
  /** The Worker found this account in ADMIN_EMAILS (x-dmmo-admin: 1). */
  admin: boolean;
  /** Client IP as the Worker saw it, or null. */
  ip: string | null;
}

export function readIdentity(req: Request): Identity | null {
  const userId = req.headers.get(H_USER_ID);
  if (!userId || userId.length > 128) return null;
  return {
    userId,
    name: cleanName(decodeHeader(req.headers.get(H_USER_NAME))),
    guest: req.headers.get(H_GUEST) === "1",
    spawn: req.headers.get(H_SPAWN),
    sessionId: req.headers.get(H_SESSION)?.slice(0, 256) || null,
    admin: req.headers.get(H_ADMIN) === "1" && req.headers.get(H_GUEST) !== "1",
    ip: req.headers.get(H_IP)?.slice(0, 64) || null,
  };
}

/** The Worker may percent-encode non-ASCII names; tolerate both forms. */
function decodeHeader(v: string | null): string | null {
  if (v === null) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** What each hibernatable socket remembers about its player (survives eviction). */
export interface SocketAttachment {
  userId: string;
  name: string;
  entityId: string;
  guest: boolean;
  /** Better Auth session id behind this socket. */
  sid?: string;
  /** Admin (from the Worker's x-dmmo-admin header): their entity wears the halo. */
  admin?: boolean;
  /** Last known position, refreshed on periodic saves. */
  x?: number;
  y?: number;
  /** Home sockets: the home map (yard or house) after the last door walked through. */
  homeMap?: HomeMapId;
  /** Set on a visitor's socket in someone else's HomeRoom. */
  visit?: VisitAttachment;
}

export const entityIdFor = (userId: string) => `p:${userId}`;

export function readAttachment(ws: WebSocket): SocketAttachment | null {
  try {
    const a = ws.deserializeAttachment() as SocketAttachment | null;
    return a && typeof a.userId === "string" ? a : null;
  } catch {
    return null;
  }
}
