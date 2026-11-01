// Pure helpers for the home-visit UI (testable without a DOM).
import { cleanFriendName, FRIEND_NAME_HINT } from "../../shared/friends";
import type { HomeCommand, InviteNotice } from "../../shared/visits";

export type CommandRequest = { ok: true; path: string; body: Record<string, string> } | { ok: false; error: string };

/** Maps a typed home command to its /api/home call, or a usage hint. */
export function homeCommandRequest(cmd: HomeCommand, name: string): CommandRequest {
  const clean = cleanFriendName(name);
  if (!clean) return { ok: false, error: `Usage: /${cmd} name. ${FRIEND_NAME_HINT}` };
  return { ok: true, path: `/api/home/${cmd}`, body: { name: clean } };
}

/** What the owner sees when a command worked. */
export function commandDoneText(cmd: HomeCommand, name: string): string {
  if (cmd === "invite") return `Invited ${name} to your home. The invite lasts 10 minutes.`;
  if (cmd === "uninvite") return `Withdrew ${name}'s invite.`;
  return `Sent ${name} home.`;
}

/** Adds invites to a queue: newest copy per sender wins, expired ones drop out, sorted by expiry. */
export function mergeInvites(queue: readonly InviteNotice[], incoming: readonly unknown[], now: number): InviteNotice[] {
  const byId = new Map<string, InviteNotice>();
  for (const n of [...queue, ...incoming]) {
    const v = validInvite(n);
    if (v && v.expiresAt > now) byId.set(v.fromId, v);
  }
  return [...byId.values()].sort((a, b) => a.expiresAt - b.expiresAt);
}

/** Server data is still untrusted: keep only well-formed fields, capped. */
export function validInvite(n: unknown): InviteNotice | null {
  if (!n || typeof n !== "object") return null;
  const o = n as Record<string, unknown>;
  if (typeof o.fromId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(o.fromId)) return null;
  if (typeof o.expiresAt !== "number" || !Number.isFinite(o.expiresAt)) return null;
  const fromName = typeof o.fromName === "string" && o.fromName.trim() ? o.fromName.trim().slice(0, 24) : "A friend";
  return { fromId: o.fromId, fromName, expiresAt: o.expiresAt };
}

export function inviteText(n: InviteNotice): string {
  return `${n.fromName} invited you to visit their home!`;
}

/** "Visitors 2/10" */
export function visitorsTitle(count: number, max: number): string {
  return `Visitors ${count}/${max}`;
}
