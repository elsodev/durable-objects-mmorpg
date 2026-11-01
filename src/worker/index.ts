// Worker entry.
// Routes: /api/auth/* (Better Auth), /api/config, /api/me, /api/uploads, /api/friends, /api/name-check,
// /api/home/* (visits), /files/*, /ws/:zone (WebSocket -> DO), /ws/visit/:ownerId (visitor WebSocket ->
// owner's HomeRoom), /ws/social (SocialRoom), static assets.
import { isUsableAuthSecret, type Env } from "./env";
import { CAPTCHA_ENDPOINTS, createAuth, getAuthUser } from "./auth";
import { captchaMode } from "./captcha";
import { cleanupGuests } from "./cron";
import { handleUpload, serveFile } from "./http/files";
import { errorJson, json } from "./http/util";
import { forwardWs } from "./http/ws";
import { handleFriends, isFriendsPath } from "./friends/routes";
import { parseWsZone } from "./http/zone-route";
import { handleHomeApi, isHomeApiPath } from "./visit/routes";
import { forwardVisit, parseVisitPath } from "./visit/ws";
import { forwardSocialWs, SOCIAL_WS_PATH } from "./http/social-route";
import { checkName } from "./names";
export { ZoneRoom } from "./zone";
export { HomeRoom } from "./home";
export { AiBudget } from "./npc/budget";
export { SocialRoom } from "./social/room";
export { NpcAgent } from "./npc/think/agent";

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname.startsWith("/files/")) return serveFile(request, env, pathname);

  const isApi = pathname.startsWith("/api/");
  const isWs = pathname.startsWith("/ws/");
  if (!isApi && !isWs) return env.ASSETS.fetch(request);

  if (pathname === "/api/config") {
    return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || null });
  }
  // Fail closed: never sign sessions with a missing or placeholder secret.
  if (!isUsableAuthSecret(env.BETTER_AUTH_SECRET)) {
    console.error("BETTER_AUTH_SECRET is missing, too short or a placeholder; refusing to serve /api and /ws");
    return errorJson(500, "server misconfigured");
  }
  const auth = createAuth(env);

  if (pathname.startsWith("/api/auth/")) {
    const sub = pathname.slice("/api/auth".length);
    if (CAPTCHA_ENDPOINTS.includes(sub) && captchaMode(env) === "misconfigured") {
      console.error("TURNSTILE_SECRET_KEY is missing (set CAPTCHA_DISABLED=1 to run without captcha)");
      return errorJson(503, "sign-in is temporarily unavailable");
    }
    return auth.handler(request);
  }

  if (pathname.startsWith("/ws/visit/")) {
    const ownerId = parseVisitPath(pathname);
    if (!ownerId) return errorJson(404, "unknown home");
    return forwardVisit(request, env, ownerId, await getAuthUser(auth, request.headers));
  }
  if (pathname === SOCIAL_WS_PATH) return forwardSocialWs(request, env, await getAuthUser(auth, request.headers));
  if (isWs) {
    const zone = parseWsZone(pathname);
    if (!zone) return errorJson(404, "unknown zone");
    return forwardWs(request, env, zone, await getAuthUser(auth, request.headers));
  }

  if (pathname === "/api/me") {
    if (request.method !== "GET") return errorJson(405, "method not allowed");
    const user = await getAuthUser(auth, request.headers);
    return user ? json(user) : errorJson(401, "not signed in");
  }
  if (pathname === "/api/name-check") {
    // Lets the sign-up and guest forms say "That name is taken" before submitting. Names are public.
    if (request.method !== "GET") return errorJson(405, "method not allowed");
    const q = new URL(request.url).searchParams;
    const r = await checkName(env.DB, q.get("name") ?? "", { forAccount: q.get("for") !== "guest" });
    return json(r.ok ? { ok: true } : { ok: false, code: r.code, reason: r.reason });
  }
  if (pathname === "/api/uploads") return handleUpload(request, env, await getAuthUser(auth, request.headers));
  if (isFriendsPath(pathname)) return handleFriends(request, env, await getAuthUser(auth, request.headers));
  if (isHomeApiPath(pathname)) return handleHomeApi(request, env, await getAuthUser(auth, request.headers));

  return errorJson(404, "not found");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      console.error("unhandled", err);
      return errorJson(500, "internal error");
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      cleanupGuests(env, Date.now()).then((n) => console.log(`guest cleanup: deleted ${n} idle guests`)),
    );
  },
} satisfies ExportedHandler<Env>;
