// Server-side name rules for Better Auth hooks and /api/name-check (rules in shared/names.ts).
// The unique index on lower(name) (migrations/0006_unique_names.sql) is the final word on races.
import { APIError } from "better-auth/api";
import { guestName, nameProblem, NAME_TAKEN_TEXT } from "../shared/names";

export interface NameHolder {
  id: string;
  isAnonymous: boolean;
}

export async function nameHolder(db: D1Database, name: string): Promise<NameHolder | null> {
  const r = await db
    .prepare(`SELECT id, isAnonymous FROM "user" WHERE lower(name) = lower(?) LIMIT 1`)
    .bind(name)
    .first<{ id: string; isAnonymous: number | null }>();
  return r ? { id: r.id, isAnonymous: r.isAnonymous === 1 } : null;
}

/** A guest placeholder name nobody holds (a few tries; the unique index catches the rest). */
export async function freeGuestName(db: D1Database, rand: () => number = Math.random): Promise<string> {
  let n = guestName(rand);
  for (let i = 0; i < 4 && (await nameHolder(db, n)); i++) n = guestName(rand);
  return n;
}

export type NameCheck = { ok: true } | { ok: false; code: "INVALID_NAME" | "NAME_TAKEN"; reason: string };

/**
 * Can `name` be used? `forAccount`: accounts may take a name a guest holds (the guest is renamed,
 * see claimName); guests can't. `selfId` is the user renaming themselves (case changes are fine).
 */
export async function checkName(db: D1Database, name: unknown, opts: { forAccount: boolean; selfId?: string | null }): Promise<NameCheck> {
  const problem = nameProblem(name);
  if (problem || typeof name !== "string" || name !== name.trim()) {
    return { ok: false, code: "INVALID_NAME", reason: problem ?? "Names can't start or end with spaces." };
  }
  const holder = await nameHolder(db, name);
  if (!holder || holder.id === opts.selfId) return { ok: true };
  if (opts.forAccount && holder.isAnonymous) return { ok: true };
  return { ok: false, code: "NAME_TAKEN", reason: NAME_TAKEN_TEXT };
}

/** Throws a Better Auth APIError the client maps to a friendly message. */
export function nameError(c: Exclude<NameCheck, { ok: true }>): APIError {
  return new APIError("BAD_REQUEST", { code: c.code, message: c.reason });
}

/** An account takes this name: a guest holding it gets a fresh placeholder name. */
export async function evictGuestHolder(db: D1Database, name: string, selfId?: string | null): Promise<void> {
  const holder = await nameHolder(db, name);
  if (!holder || !holder.isAnonymous || holder.id === selfId) return;
  await db.prepare(`UPDATE "user" SET name = ? WHERE id = ?`).bind(await freeGuestName(db), holder.id).run();
}
