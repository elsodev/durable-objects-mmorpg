// /api/mutes HTTP routes: session-checked, accounts only, JSON in and out. Mute is one-way and
// silent: only the muter's own sockets hear about a change ({ t: "mutes" }), never the muted player.
//   GET    /api/mutes                        -> MutedList
//   POST   /api/mutes   { userId } | { name } -> 201 MuteResult (200 if already muted)
//   DELETE /api/mutes/:userId                -> 200 MuteResult
import type { Env } from "../env";
import type { AuthUser } from "../auth";
import { errorJson, json } from "../http/util";
import { originAllowed } from "../http/origin";
import { takeQuota } from "../http/rate";
import { readJson } from "../friends/routes";
import { socialAdapter } from "../social-adapter";
import { cleanFriendName, FRIEND_NAME_HINT, isUserId } from "../../shared/friends";
import { MAX_MUTES, MUTES_NOTICE, type MutedList, type MuteResult, type MutesChangedNotice } from "../../shared/players";
import * as store from "./store";

export const MUTES_PREFIX = "/api/mutes";
export const GUEST_MUTES_ERROR = "Muting is for accounts. Create an account to keep a mute list.";
/** Mute changes per user per window: also bounds probing which names exist. */
export const MUTE_RATE_MAX = 60;
export const MUTE_RATE_WINDOW_MS = 60 * 60_000;

type MutesEnv = Pick<Env, "DB" | "BETTER_AUTH_URL" | "DMMO_ENV">;

export function isMutesPath(pathname: string): boolean {
  return pathname === MUTES_PREFIX || pathname.startsWith(MUTES_PREFIX + "/");
}

export async function handleMutes(request: Request, env: MutesEnv, user: AuthUser | null, now = Date.now()): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (!user) return errorJson(401, "sign in required");
  if (user.isGuest) return errorJson(403, GUEST_MUTES_ERROR);
  const method = request.method;
  if (method !== "GET" && !originAllowed(request.headers.get("origin"), env)) return errorJson(403, "bad origin");
  const db = env.DB;
  const sub = pathname.slice(MUTES_PREFIX.length);
  const changed = async (): Promise<void> => {
    const notice: MutesChangedNotice = { t: MUTES_NOTICE };
    await socialAdapter(env).notify(user.id, notice);
  };

  if (sub === "" || sub === "/") {
    if (method === "GET") return json({ muted: await store.listMutes(db, user.id) } satisfies MutedList);
    if (method !== "POST") return errorJson(405, "method not allowed");
    const body = await readJson(request);
    if (typeof body === "string") return errorJson(400, body);
    if (!(await takeQuota(db, `mutes:change:${user.id}`, now, MUTE_RATE_WINDOW_MS, MUTE_RATE_MAX))) {
      return errorJson(429, "You've changed your mute list a lot. Try again in a while.");
    }
    let target: { id: string; name: string } | null;
    if (body.userId !== undefined) {
      if (!isUserId(body.userId)) return errorJson(400, "bad user id");
      target = await store.userById(db, body.userId);
      if (!target) return errorJson(404, "No such player.");
    } else {
      const name = cleanFriendName(body.name);
      if (!name) return errorJson(400, `Usage: /mute name. ${FRIEND_NAME_HINT}`);
      const found = await store.usersByName(db, name);
      if (found.length === 0) return errorJson(404, `No player named ${name}.`);
      if (found.length > 1) return errorJson(409, `Several players are called ${name}.`);
      target = found[0]!;
    }
    if (target.id === user.id) return errorJson(400, "You can't mute yourself.");
    const r = await store.addMute(db, user.id, target.id, now);
    if (r === "full") return errorJson(409, `Your mute list is full (${MAX_MUTES}).`);
    if (r === "added") await changed();
    const result: MuteResult = { status: "muted", user: { userId: target.id, name: target.name } };
    return json(result, r === "added" ? 201 : 200);
  }

  const raw = sub.startsWith("/") ? sub.slice(1) : "";
  if (raw && !raw.includes("/")) {
    if (method !== "DELETE") return errorJson(405, "method not allowed");
    let id: string;
    try {
      id = decodeURIComponent(raw);
    } catch {
      return errorJson(400, "bad user id");
    }
    if (!isUserId(id)) return errorJson(400, "bad user id");
    const who = await store.userById(db, id);
    if (!(await store.removeMute(db, user.id, id))) return errorJson(404, "That player isn't muted.");
    await changed();
    const result: MuteResult = { status: "unmuted", user: { userId: id, name: who?.name ?? "" } };
    return json(result);
  }

  return errorJson(404, "not found");
}
