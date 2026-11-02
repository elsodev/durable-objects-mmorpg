// Worker entry.
// Routes: /api/auth/* (Better Auth), /api/config, /api/me, /api/standing (removed by an admin?), /api/uploads, /api/friends, /api/mutes,
// /api/feedback (bug button; admins review),
// /api/players/:id/card, /api/name-check,
// /api/home/* (visits), /files/*, /ws/:zone (WebSocket -> DO), /ws/visit/:ownerId (visitor WebSocket ->
// owner's HomeRoom), /ws/social (SocialRoom), static assets.
import { isUsableAuthSecret, type Env } from "./env";
import { CAPTCHA_ENDPOINTS, createAuth, getAuthUser, type Auth, type AuthUser } from "./auth";
import { captchaMode } from "./captcha";
import { cleanupGuests } from "./cron";
import { handleUpload, serveFile } from "./http/files";
import { errorJson, json } from "./http/util";
import { forwardWs } from "./http/ws";
import { handleFriends, isFriendsPath } from "./friends/routes";
import { handleMutes, isMutesPath } from "./mutes/routes";
import { handleFeedback, isFeedbackPath } from "./feedback/routes";
import { handlePlayerCard, isPlayersPath } from "./players/card";
import { parseWsZone } from "./http/zone-route";
import { handleHomeApi, isHomeApiPath } from "./visit/routes";
import { forwardVisit, parseVisitPath } from "./visit/ws";
import { forwardSocialWs, SOCIAL_WS_PATH } from "./http/social-route";
import { checkName } from "./names";
import { isAdminUser } from "./admin/config";
import { banGate, bodyEmail, SIGN_IN_ENDPOINTS, STANDING_PATH } from "./admin/gate";
export { ZoneRoom } from "./zone";
export { HomeRoom } from "./home";
export { AiBudget } from "./npc/budget";
export { SocialRoom } from "./social/room";
export { NpcAgent } from "./npc/think/agent";

/** The session user, with the Worker's own admin verdict (admin/config.ts) attached. */
async function sessionUser(auth: Auth, env: Env, request: Request): Promise<AuthUser | null> {
  const user = await getAuthUser(auth, request.headers);
  if (user && isAdminUser(env, user)) user.admin = true;
  return user;
}

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
    // A removed player's browser or address can't sign in again or start a new account.
    if (SIGN_IN_ENDPOINTS.includes(sub) && request.method === "POST") {
      const refused = await banGate(env, request, null, { signIn: true, email: await bodyEmail(request) });
      if (refused) return refused;
    }
    return auth.handler(request);
  }

  if (pathname === "/api/name-check") {
    // Lets the sign-up and guest forms say "That name is taken" before submitting. Names are public.
    if (request.method !== "GET") return errorJson(405, "method not allowed");
    const q = new URL(request.url).searchParams;
    const r = await checkName(env.DB, q.get("name") ?? "", { forAccount: q.get("for") !== "guest" });
    return json(r.ok ? { ok: true } : { ok: false, code: r.code, reason: r.reason });
  }

  // Everything below acts for the signed-in player: removed players (by account, browser cookie
  // or address) stop here, before any socket or API call.
  const user = await sessionUser(auth, env, request);
  const refused = await banGate(env, request, user);
  if (pathname === STANDING_PATH) {
    // The start screen asks this first (always 200, so a normal visit logs no failed request).
    const cookie = refused?.headers.get("set-cookie");
    return json({ removed: !!refused }, 200, cookie ? { "set-cookie": cookie } : {});
  }
  if (refused) return refused;

  if (pathname.startsWith("/ws/visit/")) {
    const ownerId = parseVisitPath(pathname);
    if (!ownerId) return errorJson(404, "unknown home");
    return forwardVisit(request, env, ownerId, user);
  }
  if (pathname === SOCIAL_WS_PATH) return forwardSocialWs(request, env, user);
  if (isWs) {
    const zone = parseWsZone(pathname);
    if (!zone) return errorJson(404, "unknown zone");
    return forwardWs(request, env, zone, user);
  }

  if (pathname === "/api/me") {
    if (request.method !== "GET") return errorJson(405, "method not allowed");
    return user ? json({ ...user, admin: user.admin === true }) : errorJson(401, "not signed in");
  }
  if (pathname === "/api/uploads") return handleUpload(request, env, user);
  if (isFriendsPath(pathname)) return handleFriends(request, env, user);
  if (isHomeApiPath(pathname)) return handleHomeApi(request, env, user);
  if (isMutesPath(pathname)) return handleMutes(request, env, user);
  if (isPlayersPath(pathname)) return handlePlayerCard(request, env, user);
  if (isFeedbackPath(pathname)) return handleFeedback(request, env, user);

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
