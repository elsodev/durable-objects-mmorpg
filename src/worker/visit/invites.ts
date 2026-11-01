// Invite bookkeeping, pure so it can be tested without a Durable Object. The owner's HomeRoom keeps
// an Invite list (who may visit); each invitee's own HomeRoom keeps an inbox (what to show them).
// The owner's list is the only authority: the inbox is a delivery cache.
import {
  INVITE_RATE_MAX,
  INVITE_RATE_WINDOW_MS,
  INVITE_TTL_MS,
  MAX_INBOX,
  MAX_INVITES,
  REJOIN_GRACE_MS,
  type InviteNotice,
} from "../../shared/visits";
import { isUserId } from "../../shared/friends";
import { cleanName } from "../game/identity";

export interface Invite {
  userId: string;
  name: string;
  at: number;
  /** null while the invitee is visiting (an invite in use doesn't run out). */
  expiresAt: number | null;
}

export interface Person {
  id: string;
  name: string;
  guest: boolean;
}

export type InviteOutcome =
  | { ok: true; invite: Invite; renewed: boolean }
  | { ok: false; status: number; reason: string };

export function isLive(inv: Invite, now: number): boolean {
  return inv.expiresAt === null || inv.expiresAt > now;
}

/** Drops expired invites in place; true if any were removed. */
export function pruneInvites(list: Invite[], now: number): boolean {
  const before = list.length;
  for (let i = list.length - 1; i >= 0; i--) if (!isLive(list[i]!, now)) list.splice(i, 1);
  return list.length !== before;
}

export function findInvite(list: readonly Invite[], userId: string, now: number): Invite | null {
  const inv = list.find((i) => i.userId === userId);
  return inv && isLive(inv, now) ? inv : null;
}

/** Case-insensitive name match among live invites. */
export function findInviteByName(list: readonly Invite[], name: string, now: number): Invite | null {
  const n = name.trim().toLowerCase();
  return list.find((i) => isLive(i, now) && i.name.toLowerCase() === n) ?? null;
}

/**
 * Adds (or renews) an invite from `owner` to `target`. Accounts only, no self-invites, at most
 * MAX_INVITES live at once. Re-inviting someone renews their invite instead of using a new slot.
 */
export function addInvite(list: Invite[], owner: Person, target: Person, now: number): InviteOutcome {
  if (owner.guest) return { ok: false, status: 403, reason: "Create an account to invite friends home." };
  if (target.guest) return { ok: false, status: 403, reason: "Guests can't visit other homes." };
  if (!isUserId(target.id)) return { ok: false, status: 400, reason: "Unknown player." };
  if (target.id === owner.id) return { ok: false, status: 400, reason: "You're always welcome in your own home." };
  pruneInvites(list, now);
  const existing = list.find((i) => i.userId === target.id);
  if (existing) {
    existing.name = cleanName(target.name);
    existing.at = now;
    // Someone visiting right now keeps their unlimited pass.
    if (existing.expiresAt !== null) existing.expiresAt = now + INVITE_TTL_MS;
    return { ok: true, invite: existing, renewed: true };
  }
  if (list.length >= MAX_INVITES) {
    return { ok: false, status: 409, reason: `You already have ${MAX_INVITES} invites out. Use /uninvite name to free one.` };
  }
  const invite: Invite = { userId: target.id, name: cleanName(target.name), at: now, expiresAt: now + INVITE_TTL_MS };
  list.push(invite);
  return { ok: true, invite, renewed: false };
}

/** Removes the invite for `userId`; the removed invite or null. */
export function revokeInvite(list: Invite[], userId: string): Invite | null {
  const i = list.findIndex((x) => x.userId === userId);
  return i < 0 ? null : list.splice(i, 1)[0]!;
}

/** The invitee arrived: the invite stays good for as long as they stay. */
export function markVisiting(list: Invite[], userId: string): void {
  const inv = list.find((i) => i.userId === userId);
  if (inv) inv.expiresAt = null;
}

/**
 * The visitor went away. A deliberate leave (exit, kick, owner left) uses the invite up; a dropped
 * socket keeps it for REJOIN_GRACE_MS so the client's automatic reconnect still gets in.
 */
export function markLeft(list: Invite[], userId: string, now: number, deliberate: boolean): void {
  if (deliberate) {
    revokeInvite(list, userId);
    return;
  }
  const inv = list.find((i) => i.userId === userId);
  if (inv) inv.expiresAt = now + REJOIN_GRACE_MS;
}

export function sanitizeInvites(v: unknown): Invite[] {
  const out: Invite[] = [];
  for (const e of Array.isArray(v) ? v : []) {
    if (out.length >= MAX_INVITES) break;
    const o = e as Partial<Invite> | null;
    if (!o || !isUserId(o.userId) || typeof o.at !== "number") continue;
    if (o.expiresAt !== null && typeof o.expiresAt !== "number") continue;
    if (out.some((x) => x.userId === o.userId)) continue;
    out.push({ userId: o.userId, name: cleanName(o.name), at: o.at, expiresAt: o.expiresAt ?? null });
  }
  return out;
}

// ------------------------------------------------------------------ inbox (invitee side)

/** Adds or refreshes one invitation; oldest dropped past MAX_INBOX. */
export function addToInbox(inbox: InviteNotice[], n: InviteNotice, now: number): InviteNotice[] {
  const rest = inbox.filter((x) => x.fromId !== n.fromId && x.expiresAt > now);
  rest.push({ fromId: n.fromId, fromName: cleanName(n.fromName), expiresAt: n.expiresAt });
  return rest.slice(-MAX_INBOX);
}

export function liveInbox(inbox: readonly InviteNotice[], now: number): InviteNotice[] {
  return inbox.filter((x) => x.expiresAt > now);
}

export function removeFromInbox(inbox: readonly InviteNotice[], fromId: string): InviteNotice[] {
  return inbox.filter((x) => x.fromId !== fromId);
}

export function sanitizeInbox(v: unknown, now: number): InviteNotice[] {
  const out: InviteNotice[] = [];
  for (const e of Array.isArray(v) ? v : []) {
    const o = e as Partial<InviteNotice> | null;
    if (!o || !isUserId(o.fromId) || typeof o.expiresAt !== "number" || o.expiresAt <= now) continue;
    out.push({ fromId: o.fromId, fromName: cleanName(o.fromName), expiresAt: o.expiresAt });
  }
  return out.slice(-MAX_INBOX);
}

// ------------------------------------------------------------------ rate limit

/** Sliding-window quota of invite attempts; mutates `times`. */
export function takeInviteQuota(times: number[], now: number): boolean {
  while (times.length > 0 && now - times[0]! >= INVITE_RATE_WINDOW_MS) times.shift();
  if (times.length >= INVITE_RATE_MAX) return false;
  times.push(now);
  return true;
}
