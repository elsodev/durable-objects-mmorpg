// Better Auth on D1: email/password, anonymous guests, optional Turnstile captcha.
import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins/anonymous";
import { captcha } from "better-auth/plugins/captcha";
import { AUTH_RATE_LIMIT, type Env } from "./env";
import { sanitizeName } from "./http/util";
import { deleteUserUploads } from "./http/quota";
import { captchaMode } from "./captcha";
import { SHARED_ZONES } from "../shared/types";
import { checkName, evictGuestHolder, freeGuestName, nameError } from "./names";
import { socialRoom } from "./social/hooks";

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  isGuest: boolean;
  /** Better Auth session id, forwarded to the DOs so they can re-check it. */
  sessionId: string;
}

export const CAPTCHA_ENDPOINTS = ["/sign-up/email", "/sign-in/email", "/sign-in/anonymous"];

/**
 * Guest upgrade: move the guest's home to the account they just created / signed in to.
 * If that account already has a home, its progress wins and the guest home is discarded.
 * On any failure the guest home is left in place (logged) rather than half-moved.
 */
export async function transferGuestHome(env: Env, anonId: string, newId: string, newName: string): Promise<void> {
  // Linking a guest to itself would export, (not) import, then wipe the only copy.
  if (!anonId || anonId === newId) return;
  const from = env.HOME.get(env.HOME.idFromName(anonId));
  const to = env.HOME.get(env.HOME.idFromName(newId));
  try {
    const data = await from.exportHome(anonId);
    if (data) {
      const existing = await to.exportHome(newId);
      if (!existing) await to.importHome(newId, sanitizeName(newName), data);
    }
    await from.wipe(anonId);
  } catch (err) {
    console.error("guest home transfer failed", anonId, "->", newId, err);
  }
}

/** Sign-out / revocation: close that session's sockets now instead of at the next re-check. */
export async function closeSessionSockets(env: Env, userId: string, sessionId: string): Promise<void> {
  await Promise.allSettled([
    env.HOME.get(env.HOME.idFromName(userId)).closeSession(userId, sessionId),
    ...SHARED_ZONES.map((z) => env.ZONE.get(env.ZONE.idFromName(z)).closeSession(userId, sessionId)),
    socialRoom(env).closeSession(userId, sessionId),
  ]);
}

export function createAuth(env: Env) {
  const plugins = [
    anonymous({
      // Keep the guest row after linking: the guest-cleanup cron removes it (and its home) later,
      // instead of Better Auth deleting it mid-link while the home transfer is still running.
      disableDeleteAnonymousUser: true,
      // Placeholder until the guest picks a name (updateUser); always valid and unique.
      generateName: () => freeGuestName(env.DB),
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        await transferGuestHome(env, anonymousUser.user.id, newUser.user.id, newUser.user.name);
      },
    }),
    ...(captchaMode(env) === "on" && env.TURNSTILE_SECRET_KEY
      ? [
          captcha({
            provider: "cloudflare-turnstile",
            secretKey: env.TURNSTILE_SECRET_KEY,
            endpoints: CAPTCHA_ENDPOINTS,
          }),
        ]
      : []),
  ];

  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    trustedOrigins: env.BETTER_AUTH_URL ? [new URL(env.BETTER_AUTH_URL).origin] : [],
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
    rateLimit: AUTH_RATE_LIMIT,
    // Cloudflare sets cf-connecting-ip and clients can't spoof it; without this, rate limits
    // and session IPs fall back to a single shared bucket.
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    databaseHooks: {
      user: {
        create: {
          // Name rules (shared/names.ts) and case-insensitive uniqueness. Guests get a placeholder;
          // an account may take a name a guest holds (the guest is renamed), never another account's.
          before: async (user) => {
            if (user.isAnonymous === true) {
              const ok = await checkName(env.DB, user.name, { forAccount: false });
              return { data: { ...user, name: ok.ok ? user.name : await freeGuestName(env.DB) } };
            }
            const name = typeof user.name === "string" ? user.name.trim() : user.name;
            const check = await checkName(env.DB, name, { forAccount: true });
            if (!check.ok) throw nameError(check);
            await evictGuestHolder(env.DB, name as string);
            return { data: { ...user, name } };
          },
        },
        update: {
          before: async (data, ctx) => {
            if (data.name === undefined) return { data };
            const name = typeof data.name === "string" ? data.name.trim() : data.name;
            const self = (ctx?.context as { session?: { user?: { id?: string } } | null } | undefined)?.session?.user?.id ?? null;
            const check = await checkName(env.DB, name, { forAccount: false, selfId: self });
            if (!check.ok) throw nameError(check);
            return { data: { ...data, name } };
          },
        },
        delete: {
          after: async (user) => {
            try {
              await deleteUserUploads(env, user.id);
              await env.HOME.get(env.HOME.idFromName(user.id)).wipe(user.id);
              // Lazy: the agents SDK imports cloudflare:workers, which plain unit tests of this module cannot load.
              await (await import("./npc/think/client")).forgetNpcMemory(env, user.id);
            } catch (err) {
              console.error("account cleanup failed", user.id, err);
            }
          },
        },
      },
      session: {
        delete: {
          after: async (session) => {
            await closeSessionSockets(env, session.userId, session.id).catch(() => {});
          },
        },
      },
    },
    plugins,
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Resolves the session user from the request cookies, or null. */
export async function getAuthUser(auth: Auth, headers: Headers): Promise<AuthUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const u = session.user as typeof session.user & { isAnonymous?: boolean | null };
  const isGuest = u.isAnonymous === true;
  return { id: u.id, name: u.name, email: isGuest ? null : u.email, isGuest, sessionId: session.session.id };
}
