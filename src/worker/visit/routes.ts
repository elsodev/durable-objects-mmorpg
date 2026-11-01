// /api/home/* HTTP routes for home visits: session-checked, accounts only, JSON in and out. The
// client's chat box turns `/invite name`, `/kick name` and `/uninvite name` into these calls, so
// the commands never travel as chat.
//   POST /api/home/invite            { name }             -> 201 InviteResult
//   POST /api/home/uninvite          { name }             -> 200 { status: "uninvited", user }
//   POST /api/home/kick              { name } | { userId } -> 200 { status: "kicked", user }
//   POST /api/home/invites/respond   { fromId, accept }   -> 200 RespondResult
import type { Env } from "../env";
import type { AuthUser } from "../auth";
import type { HomeRoom } from "../home";
import { errorJson, json } from "../http/util";
import { originAllowed } from "../http/origin";
import { readJson } from "../friends/routes";
import { findUsersByName } from "../friends/store";
import { socialAdapter } from "../social-adapter";
import { cleanFriendName, FRIEND_NAME_HINT, isUserId } from "../../shared/friends";
import type { InviteResult, RespondResult, VisitNotice } from "../../shared/visits";

export const HOME_API_PREFIX = "/api/home";
export const GUEST_VISITS_ERROR = "Home visits are for accounts. Create an account to invite friends!";

/** The HomeRoom RPCs these routes use (a structural subset, so tests can pass real or fake rooms). */
export type HomeStub = Pick<
  HomeRoom,
  | "takeInviteQuota"
  | "createInvite"
  | "checkInvite"
  | "revokeInviteByName"
  | "kickVisitor"
  | "declineInvite"
  | "addInvite"
  | "dismissInvite"
  | "peekPlayer"
  | "fetch"
>;

export interface HomeNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): HomeStub;
}

export type VisitEnv = Pick<Env, "DB" | "BETTER_AUTH_URL" | "DMMO_ENV"> & { HOME: HomeNamespace };

export function homeOf(env: { HOME: HomeNamespace }, userId: string): HomeStub {
  return env.HOME.get(env.HOME.idFromName(userId));
}

export function isHomeApiPath(pathname: string): boolean {
  return pathname === HOME_API_PREFIX || pathname.startsWith(HOME_API_PREFIX + "/");
}

export async function handleHomeApi(request: Request, env: VisitEnv, user: AuthUser | null, now = Date.now()): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (!user) return errorJson(401, "sign in required");
  if (user.isGuest) return errorJson(403, GUEST_VISITS_ERROR);
  if (request.method !== "POST") return errorJson(405, "method not allowed");
  if (!originAllowed(request.headers.get("origin"), env)) return errorJson(403, "bad origin");
  const body = await readJson(request);
  if (typeof body === "string") return errorJson(400, body);
  const sub = pathname.slice(HOME_API_PREFIX.length);
  const social = socialAdapter(env);
  const mine = homeOf(env, user.id);

  if (sub === "/invite") {
    const name = cleanFriendName(body.name);
    if (!name) return errorJson(400, `Usage: /invite name. ${FRIEND_NAME_HINT}`);
    // Quota first, so it also bounds probing which names exist.
    if (!(await mine.takeInviteQuota(user.id, now))) return errorJson(429, "You've sent a lot of invites. Try again in a while.");
    const found = await findUsersByName(env.DB, name);
    if (found.length === 0) return errorJson(404, `No player named ${name}.`);
    if (found.length > 1) return errorJson(409, `Several players are called ${name}; ask them for their exact name.`);
    const target = found[0]!;
    if (target.id === user.id) return errorJson(400, "You're always welcome in your own home.");
    const r = await mine.createInvite(user.id, user.name, { id: target.id, name: target.name }, now);
    if (!r.ok) return errorJson(r.status, r.reason);
    const expiresAt = r.invite.expiresAt ?? now;
    await homeOf(env, target.id).addInvite(user.id, user.name, expiresAt);
    const notice: VisitNotice = { t: "invite", fromId: user.id, fromName: user.name, expiresAt };
    await social.notify(target.id, notice);
    const result: InviteResult = { status: "invited", user: { userId: target.id, name: target.name }, expiresAt };
    return json(result, 201);
  }

  if (sub === "/uninvite") {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 32) : "";
    if (!name) return errorJson(400, "Usage: /uninvite name");
    const who = await mine.revokeInviteByName(user.id, name, now);
    if (!who) return errorJson(404, `You haven't invited ${name}.`);
    await homeOf(env, who.userId).dismissInvite(who.userId, user.id);
    const notice: VisitNotice = { t: "inviteRevoked", fromId: user.id };
    await social.notify(who.userId, notice);
    return json({ status: "uninvited", user: who });
  }

  if (sub === "/kick") {
    const target =
      isUserId(body.userId) ? { userId: body.userId } : typeof body.name === "string" && body.name.trim() ? { name: body.name.trim().slice(0, 32) } : null;
    if (!target) return errorJson(400, "Usage: /kick name");
    const who = await mine.kickVisitor(user.id, target);
    if (!who) return errorJson(404, `${target.name ?? "That player"} isn't visiting your home.`);
    return json({ status: "kicked", user: who });
  }

  if (sub === "/invites/respond") {
    if (!isUserId(body.fromId)) return errorJson(400, "fromId is required");
    if (typeof body.accept !== "boolean") return errorJson(400, "accept must be true or false");
    const fromId = body.fromId;
    if (fromId === user.id) return errorJson(400, "This is your own home.");
    await mine.dismissInvite(user.id, fromId);
    const host = homeOf(env, fromId);
    if (!body.accept) {
      await host.declineInvite(fromId, user.id);
      return json({ status: "declined", ownerId: fromId } satisfies RespondResult);
    }
    const check = await host.checkInvite(fromId, user.id, now);
    if (!check.ok) return errorJson(409, check.reason);
    return json({ status: "accepted", ownerId: fromId } satisfies RespondResult);
  }

  return errorJson(404, "not found");
}
