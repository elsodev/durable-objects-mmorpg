// The removed-player cookie: "v1.<userId>.<issuedAt>.<hmac>" signed with BETTER_AUTH_SECRET, so a
// browser that was kicked keeps saying who it belonged to even after signing out or clearing the
// session. It only names the account; SocialRoom's ban list decides whether that still means
// "keep out" (an /unban makes old cookies harmless).

export const BAN_COOKIE = "dmmo_ban";
/** Browsers cap cookie lifetimes at 400 days. */
export const BAN_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;
const MAX_COOKIE_LEN = 512;

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`dmmo-ban:${data}`)));
}

/** Constant-time compare of two short ASCII strings. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

export async function signBanCookie(secret: string, userId: string, now: number): Promise<string> {
  if (!USER_ID.test(userId)) throw new Error("bad user id");
  const body = `v1.${userId}.${Math.floor(now)}`;
  return `${body}.${await hmac(secret, body)}`;
}

/** The user id a valid cookie names, or null for a missing, malformed or forged one. */
export async function verifyBanCookie(secret: string, value: string | null | undefined): Promise<string | null> {
  if (!value || value.length > MAX_COOKIE_LEN) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1" || !USER_ID.test(parts[1]!) || !/^\d{1,16}$/.test(parts[2]!)) return null;
  const body = parts.slice(0, 3).join(".");
  const want = await hmac(secret, body);
  return sameText(want, parts[3]!) ? parts[1]! : null;
}

/** One cookie's value from a Cookie header, or null. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function banCookieHeader(value: string, secure: boolean): string {
  return `${BAN_COOKIE}=${value}; Path=/; Max-Age=${BAN_COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
