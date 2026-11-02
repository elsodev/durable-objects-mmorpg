// GET /ws/social -> the global SocialRoom. Same session, upgrade and origin checks as /ws/:zone,
// but guests are allowed (they can read world chat; SocialRoom refuses their sends).
import { H_GUEST, H_SESSION, H_USER_ID, H_USER_NAME, type Env } from "../env";
import type { AuthUser } from "../auth";
import { errorJson, setAdminAndIp, stripIdentityHeaders } from "./util";
import { originAllowed } from "./origin";
import { encodeHeaderName } from "./ws";
import { socialRoom } from "../social/hooks";

export const SOCIAL_WS_PATH = "/ws/social";

export function forwardSocialWs(request: Request, env: Env, user: AuthUser | null): Promise<Response> | Response {
  if (!user) return errorJson(401, "sign in required");
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return errorJson(426, "expected websocket");
  if (!originAllowed(request.headers.get("origin"), env)) return errorJson(403, "bad origin");
  const headers = stripIdentityHeaders(request.headers);
  headers.set(H_USER_ID, user.id);
  headers.set(H_USER_NAME, encodeHeaderName(user.name));
  headers.set(H_GUEST, user.isGuest ? "1" : "0");
  headers.set(H_SESSION, user.sessionId);
  setAdminAndIp(headers, request, user);
  return socialRoom(env).fetch(new Request(request.url, { method: "GET", headers }));
}
