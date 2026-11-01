// /api/friends HTTP routes: session-checked, accounts only, JSON in and out.
//   GET    /api/friends                 -> FriendsList
//   POST   /api/friends/request         { name }             -> FriendRequestResult
//   POST   /api/friends/respond         { fromId, accept }   -> { status: "accepted" | "declined" }
//   DELETE /api/friends/:userId                              -> { status: "removed" }
import type { Env } from "../env";
import type { AuthUser } from "../auth";
import { errorJson, json } from "../http/util";
import { originAllowed } from "../http/origin";
import { socialAdapter } from "../social-adapter";
import { cleanFriendName, FRIEND_NAME_HINT, isUserId } from "../../shared/friends";
import * as service from "./service";

export const FRIENDS_PREFIX = "/api/friends";
const MAX_BODY_BYTES = 1024;
export const GUEST_FRIENDS_ERROR = "Friends are for accounts. Create an account to add friends!";

type FriendsEnv = Pick<Env, "DB" | "BETTER_AUTH_URL" | "DMMO_ENV">;

export function isFriendsPath(pathname: string): boolean {
  return pathname === FRIENDS_PREFIX || pathname.startsWith(FRIENDS_PREFIX + "/");
}

/** Parsed JSON object body, or an error message. */
export async function readJson(request: Request): Promise<Record<string, unknown> | string> {
  const type = request.headers.get("content-type") ?? "";
  // Also forces a CORS preflight for cross-site callers (a plain form post can't set it).
  if (!/^application\/json\b/i.test(type)) return "expected application/json";
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return "body too large";
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : "expected a JSON object";
  } catch {
    return "invalid JSON";
  }
}

export async function handleFriends(
  request: Request,
  env: FriendsEnv,
  user: AuthUser | null,
  now = Date.now(),
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (!user) return errorJson(401, "sign in required");
  if (user.isGuest) return errorJson(403, GUEST_FRIENDS_ERROR);
  const method = request.method;
  if (method !== "GET" && !originAllowed(request.headers.get("origin"), env)) return errorJson(403, "bad origin");

  const me = { id: user.id, name: user.name };
  const social = socialAdapter(env);
  const db = env.DB;
  const sub = pathname.slice(FRIENDS_PREFIX.length);
  const send = (o: service.Outcome): Response => json(o.body, o.status);

  if (sub === "" || sub === "/") {
    if (method !== "GET") return errorJson(405, "method not allowed");
    return json(await service.listFor(db, social, me));
  }

  if (sub === "/request") {
    if (method !== "POST") return errorJson(405, "method not allowed");
    const body = await readJson(request);
    if (typeof body === "string") return errorJson(400, body);
    const name = cleanFriendName(body.name);
    if (!name) return errorJson(400, FRIEND_NAME_HINT);
    return send(await service.request(db, social, me, name, now));
  }

  if (sub === "/respond") {
    if (method !== "POST") return errorJson(405, "method not allowed");
    const body = await readJson(request);
    if (typeof body === "string") return errorJson(400, body);
    if (!isUserId(body.fromId)) return errorJson(400, "fromId is required");
    if (typeof body.accept !== "boolean") return errorJson(400, "accept must be true or false");
    return send(await service.respond(db, social, me, body.fromId, body.accept, now));
  }

  const target = sub.startsWith("/") ? sub.slice(1) : "";
  if (target && !target.includes("/")) {
    if (method !== "DELETE") return errorJson(405, "method not allowed");
    let id: string;
    try {
      id = decodeURIComponent(target);
    } catch {
      return errorJson(400, "bad user id");
    }
    if (!isUserId(id)) return errorJson(400, "bad user id");
    return send(await service.remove(db, social, me, id));
  }

  return errorJson(404, "not found");
}
