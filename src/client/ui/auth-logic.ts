// DOM-free auth helpers (validation, error text, session mapping) so tests typecheck without DOM.

import { NAME_MAX, NAME_RULE_TEXT, NAME_TAKEN_TEXT, nameProblem } from "../../shared/names";

export type Mode = "signin" | "signup";

/** Names: 3-16 of [A-Za-z0-9_] (shared/names.ts); the server enforces the same rule and uniqueness. */
export const MAX_NAME_LEN = NAME_MAX;
export const MIN_PASSWORD_LEN = 8;
export const MAX_PASSWORD_LEN = 128;

/** Strips control/format chars, collapses whitespace, caps length; validateName then applies the rule. */
export function cleanName(name: string): string {
  const cleaned = name
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, MAX_NAME_LEN).join("").trim();
}

export function validateName(name: string): string | null {
  return nameProblem(cleanName(name));
}

export function validateEmail(email: string): string | null {
  const e = email.trim();
  if (!e) return "Enter your email address.";
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "That email address doesn't look right.";
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LEN) return `Passwords need at least ${MIN_PASSWORD_LEN} characters.`;
  if (password.length > MAX_PASSWORD_LEN) return `Passwords can be at most ${MAX_PASSWORD_LEN} characters.`;
  return null;
}

export interface AuthErrorLike {
  code?: string | null;
  message?: string | null;
  status?: number;
}

/** Turns a Better Auth error into something a player can act on. Never echoes unknown server text verbatim beyond a short cap. */
export function friendlyAuthError(err: AuthErrorLike | null | undefined, mode: Mode | "guest"): string {
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").toLowerCase();
  const status = err?.status ?? 0;
  if (status === 429) return "Too many attempts. Take a short break and try again in a minute.";
  if (code === "VERIFICATION_FAILED" || code === "MISSING_RESPONSE" || msg.includes("captcha"))
    return "The human check didn't go through. Please try again.";
  if (code === "NAME_TAKEN") return NAME_TAKEN_TEXT;
  if (code === "INVALID_NAME") return err?.message && err.message.length < 100 ? err.message : NAME_RULE_TEXT;
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "That email and password don't match.";
  if (code.startsWith("USER_ALREADY_EXISTS")) return "An account with that email already exists. Try signing in.";
  if (code === "INVALID_EMAIL" || code === "INVALID_EMAIL_FORMAT") return "That email address doesn't look right.";
  if (code === "PASSWORD_TOO_SHORT") return `Passwords need at least ${MIN_PASSWORD_LEN} characters.`;
  if (code === "PASSWORD_TOO_LONG") return `Passwords can be at most ${MAX_PASSWORD_LEN} characters.`;
  if (status === 0 || status >= 500) return "Couldn't reach Mossbrook. Check your connection and try again.";
  if (mode === "signin" && status === 401) return "That email and password don't match.";
  return mode === "guest" ? "Couldn't start a guest farm. Please try again." : "Something went wrong. Please try again.";
}

export interface RawUser {
  id: string;
  name?: string | null;
  email?: string | null;
  isAnonymous?: boolean | null;
}

/** Structurally a ui/index.ts SessionUser (not imported: that would pull DOM modules into the worker typecheck). */
export function toSessionUser(u: RawUser): { id: string; name: string; email: string | null; isGuest: boolean } {
  const isGuest = u.isAnonymous === true;
  return { id: u.id, name: u.name || (isGuest ? "Guest" : "Farmer"), email: isGuest ? null : (u.email ?? null), isGuest };
}

export type NameCheckResult = { ok: true } | { ok: false; reason: string };

/** Reads GET /api/name-check's JSON; anything unexpected counts as ok (the server re-checks on submit). */
export function parseNameCheck(body: unknown): NameCheckResult {
  if (body && typeof body === "object" && (body as { ok?: unknown }).ok === false) {
    const r = (body as { reason?: unknown }).reason;
    return { ok: false, reason: typeof r === "string" && r.length < 120 ? r : NAME_TAKEN_TEXT };
  }
  return { ok: true };
}
