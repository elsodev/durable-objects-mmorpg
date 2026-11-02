// Keeps removed players out. The Worker runs this before every socket, /api/* call and sign-in /
// sign-up: the session's user id, the ban cookie and the client IP are checked against
// SocialRoom's ban list. Admins are never refused (an IP ban on a shared address must not lock
// the admin out of /unban). A refusal answers 451 and (re)sets the signed cookie.
import type { Env } from "../env";
import type { AuthUser } from "../auth";
import { HTTP_REMOVED, REMOVED_CODE, REMOVED_TEXT } from "../../shared/admin";
import { isAdminEmail, isAdminUser } from "./config";
import { BAN_COOKIE, banCookieHeader, readCookie, signBanCookie, verifyBanCookie } from "./cookie";
import { socialRoom } from "../social/hooks";

type GateEnv = Pick<Env, "SOCIAL" | "BETTER_AUTH_SECRET" | "ADMIN_EMAILS" | "ADMIN_EMAIL">;

/** Better Auth endpoints that create a session: refused for a removed browser or address. */
export const SIGN_IN_ENDPOINTS: readonly string[] = ["/sign-up/email", "/sign-in/email", "/sign-in/anonymous"];

/** GET -> { removed: boolean }: the client's start-up check. */
export const STANDING_PATH = "/api/standing";

export function clientIp(request: Request): string | null {
  return request.headers.get("cf-connecting-ip")?.slice(0, 64) || null;
}

/** The email a sign-in / sign-up body names, without consuming the request (capped read). */
export async function bodyEmail(request: Request): Promise<string | null> {
  if (request.method !== "POST") return null;
  try {
    const text = await request.clone().text();
    if (text.length > 8192) return null;
    const body = JSON.parse(text) as { email?: unknown };
    return typeof body.email === "string" ? body.email.slice(0, 254) : null;
  } catch {
    return null;
  }
}

export function removedResponse(cookie: string | null): Response {
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (cookie) headers["set-cookie"] = cookie;
  // `code`/`message` read like a Better Auth error, so the sign-in form shows it too.
  return new Response(JSON.stringify({ error: REMOVED_TEXT, message: REMOVED_TEXT, code: REMOVED_CODE, removed: true }), {
    status: HTTP_REMOVED,
    headers,
  });
}

/**
 * null when this request may go on; otherwise the 451 to send. `signIn` marks a sign-in / sign-up
 * request, whose `email` exempts an admin (no session yet). The address is checked only for a
 * signed-in player or a sign-in attempt: a visitor on a banned address still sees the sign-in form
 * (an admin on that network must be able to reach it). Fails open on a SocialRoom error: a hiccup
 * must not lock everyone out.
 */
export async function banGate(
  env: GateEnv,
  request: Request,
  user: AuthUser | null,
  opts: { signIn?: boolean; email?: string | null; now?: number } = {},
): Promise<Response | null> {
  if (isAdminUser(env, user) || (!user && opts.signIn && isAdminEmail(env, opts.email))) return null;
  const now = opts.now ?? Date.now();
  const cookieUser = await verifyBanCookie(env.BETTER_AUTH_SECRET, readCookie(request.headers.get("cookie"), BAN_COOKIE));
  let verdict;
  try {
    const ip = user || opts.signIn ? clientIp(request) : null;
    if (!user && !ip && !cookieUser) return null;
    verdict = await socialRoom(env).banCheck(user?.id ?? null, ip, cookieUser);
  } catch (err) {
    console.error("ban check failed", err);
    return null;
  }
  if (!verdict.banned) return null;
  let cookie: string | null = null;
  // Only a browser known to be theirs gets the cookie: a shared address must not mark a stranger's
  // browser for longer than the address ban itself lasts.
  if (verdict.via !== "ip") {
    try {
      const secure = new URL(request.url).protocol === "https:";
      cookie = banCookieHeader(await signBanCookie(env.BETTER_AUTH_SECRET, verdict.userId, now), secure);
    } catch {
      // an id we can't sign: refuse anyway
    }
  }
  return removedResponse(cookie);
}
