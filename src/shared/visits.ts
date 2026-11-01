// Home visits: limits, chat commands, HTTP shapes, socket messages and social payloads shared by the
// Worker (src/worker/visit) and the client (src/client/ui/visits.ts). Pure: no DOM, no Workers APIs.
import type { ZoneId } from "./types";

/** Invites a home may have out at once (pending or in use). */
export const MAX_INVITES = 10;
/** Visitors at one home at the same time. */
export const MAX_VISITORS = 10;
/** An invite nobody used is gone after this long. */
export const INVITE_TTL_MS = 10 * 60_000;
/** A visitor whose socket dropped (not one who left) may reconnect for this long. */
export const REJOIN_GRACE_MS = 2 * 60_000;
/** Invitations kept in a player's inbox. */
export const MAX_INBOX = 20;
/** Invite attempts (found or not) per home per window: bounds probing which names exist. */
export const INVITE_RATE_MAX = 30;
export const INVITE_RATE_WINDOW_MS = 60 * 60_000;

export type HomeCommand = "invite" | "kick" | "uninvite";

/** `/invite name`, `/kick name`, `/uninvite name` typed in chat; null for anything else. */
export function parseHomeCommand(text: string): { cmd: HomeCommand; name: string } | null {
  const m = /^\/(invite|kick|uninvite)(?:\s+(.*))?$/i.exec(text.trim());
  if (!m) return null;
  return { cmd: m[1]!.toLowerCase() as HomeCommand, name: (m[2] ?? "").trim() };
}

/** The client sends home commands over HTTP; one that reaches a room as chat is answered with this, never broadcast. */
export const HOME_COMMAND_NOTICE = "That command didn't go through. Try it again from the chat box.";

/** One invitation in the invitee's inbox. */
export interface InviteNotice {
  fromId: string;
  fromName: string;
  expiresAt: number;
}

export interface VisitorEntry {
  userId: string;
  name: string;
}

/** welcome.visit: you are a visitor in someone else's home. */
export interface VisitInfo {
  ownerId: string;
  ownerName: string;
  /** Where "Leave" takes you (your own save's zone). */
  returnTo: ZoneId;
}

export type VisitServerMsg =
  /** Invitations waiting for you (sent after welcome, and when one arrives while you're at home). */
  | { t: "invites"; invites: InviteNotice[] }
  /** Owner only, at home: who is visiting right now. */
  | { t: "visitors"; visitors: VisitorEntry[]; max: number };

/** Delivered through the social socket as `{ t: "social", payload }`. */
export type VisitNotice =
  | ({ t: "invite" } & InviteNotice)
  | { t: "inviteRevoked"; fromId: string };

/** POST /api/home/invite -> 201 */
export interface InviteResult {
  status: "invited";
  user: VisitorEntry;
  expiresAt: number;
}

/** POST /api/home/invites/respond { fromId, accept } -> 200 */
export interface RespondResult {
  status: "accepted" | "declined";
  ownerId: string;
}

/** Why an invite can't be used right now (checkInvite). */
export type InviteCheck =
  | { ok: true; ownerName: string }
  | { ok: false; reason: string };

/** "3 turnips" / "1 silver turnip": owner-facing harvest notice wording. */
export function countLabel(qty: number, name: string): string {
  const lower = name.toLowerCase();
  if (qty === 1) return `1 ${lower}`;
  return `${qty} ${/(s|x|ch|sh)$/.test(lower) ? lower + "es" : lower + "s"}`;
}
