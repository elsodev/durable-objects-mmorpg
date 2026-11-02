// Who is an admin: only accounts whose email is listed in ADMIN_EMAILS (or ADMIN_EMAIL) in the
// Worker's environment. The Worker decides this after checking the session and tells Durable
// Objects with the x-dmmo-admin header; there is no other way to become one.
import type { Env } from "../env";

type AdminEnv = Pick<Env, "ADMIN_EMAILS" | "ADMIN_EMAIL">;

/** Normalised email for comparisons. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

/** "a@x.com, B@y.com" -> {"a@x.com", "b@y.com"}. Blank and malformed entries are dropped. */
export function parseAdminEmails(...raw: (string | undefined | null)[]): Set<string> {
  const out = new Set<string>();
  for (const list of raw) {
    if (typeof list !== "string") continue;
    for (const part of list.split(/[,;\s]+/)) {
      const e = emailKey(part);
      if (e.length > 3 && e.length <= 254 && /^[^@\s]+@[^@\s]+$/.test(e)) out.add(e);
    }
  }
  return out;
}

export function adminEmails(env: AdminEnv): Set<string> {
  return parseAdminEmails(env.ADMIN_EMAILS, env.ADMIN_EMAIL);
}

export function isAdminEmail(env: AdminEnv, email: string | null | undefined): boolean {
  if (typeof email !== "string" || !email) return false;
  return adminEmails(env).has(emailKey(email));
}

/** Guests never are admins, whatever their placeholder email says. */
export function isAdminUser(env: AdminEnv, user: { email: string | null; isGuest: boolean } | null): boolean {
  return !!user && !user.isGuest && isAdminEmail(env, user.email);
}
