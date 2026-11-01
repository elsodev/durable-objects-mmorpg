// GET /ws/visit/<ownerId> -> a visitor's WebSocket, forwarded to the owner's HomeRoom.
// Order matters: the client probes the same path over plain HTTP after a refused socket, so every
// refusal (no session, guest, no invite, owner away) answers before the upgrade check and the
// client can tell "not allowed" (401/403) from "try again".
import {
  H_GUEST,
  H_SESSION,
  H_USER_ID,
  H_USER_NAME,
  H_VISIT_LOOK,
  H_VISIT_OWNER,
  H_VISIT_RETURN,
  H_VISIT_SPRITE,
  H_ZONE,
} from "../env";
import type { AuthUser } from "../auth";
import { errorJson, stripIdentityHeaders } from "../http/util";
import { originAllowed } from "../http/origin";
import { encodeHeaderName } from "../http/ws";
import { isUserId } from "../../shared/friends";
import { GUEST_VISITS_ERROR, homeOf, type VisitEnv } from "./routes";

/** "/ws/visit/abc" -> "abc"; anything else -> null. */
export function parseVisitPath(pathname: string): string | null {
  const m = /^\/ws\/visit\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  return isUserId(id) ? id : null;
}

export async function forwardVisit(request: Request, env: VisitEnv, ownerId: string, user: AuthUser | null, now = Date.now()): Promise<Response> {
  if (!user) return errorJson(401, "sign in required");
  if (user.isGuest) return errorJson(403, GUEST_VISITS_ERROR);
  if (ownerId === user.id) return errorJson(403, "This is your own home.");
  const owner = homeOf(env, ownerId);
  const check = await owner.checkInvite(ownerId, user.id, now);
  if (!check.ok) return errorJson(403, check.reason);
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return errorJson(426, "expected websocket");
  // After the upgrade check, like /ws/:zone: a same-origin probe GET carries no Origin header.
  if (!originAllowed(request.headers.get("origin"), env)) return errorJson(403, "bad origin");

  // Read-only: the visitor's own home keeps its lease and save; we only learn where they came from.
  const me = await homeOf(env, user.id).peekPlayer(user.id);
  const headers = stripIdentityHeaders(request.headers);
  headers.set(H_USER_ID, user.id);
  headers.set(H_USER_NAME, encodeHeaderName(user.name));
  headers.set(H_ZONE, "home");
  headers.set(H_GUEST, "0");
  headers.set(H_SESSION, user.sessionId);
  headers.set(H_VISIT_OWNER, ownerId);
  headers.set(H_VISIT_RETURN, me.zone);
  headers.set(H_VISIT_SPRITE, me.sprite);
  if (me.look) headers.set(H_VISIT_LOOK, JSON.stringify(me.look));
  const forwarded = new Request(request.url, { method: "GET", headers });
  return owner.fetch(forwarded);
}
