// Player name rules, shared by the sign-up form, Better Auth hooks and the Durable Objects.
// Names are 3-16 ASCII letters, digits or "_" and unique ignoring case (D1 index on lower(name)).

export const NAME_MIN = 3;
export const NAME_MAX = 16;
export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
/** For <input pattern>: the browser anchors it itself. */
export const NAME_PATTERN = "[A-Za-z0-9_]{3,16}";
export const NAME_RULE_TEXT = "Names use 3-16 letters, numbers or _ (no spaces).";
export const NAME_TAKEN_TEXT = "That name is taken.";

export function isValidName(name: unknown): name is string {
  return typeof name === "string" && NAME_RE.test(name);
}

/** Friendly reason a name is not allowed, or null when it is fine. */
export function nameProblem(name: unknown): string | null {
  if (typeof name !== "string" || name.trim().length === 0) return "Pick a name for your farmer.";
  const n = name;
  if (n !== n.trim()) return NAME_RULE_TEXT;
  if (n.length < NAME_MIN) return `Names need at least ${NAME_MIN} characters.`;
  if (n.length > NAME_MAX) return `Names can be at most ${NAME_MAX} characters.`;
  if (!NAME_RE.test(n)) return NAME_RULE_TEXT;
  return null;
}

/** Case-insensitive key used for uniqueness and name lookups (PMs, friends). */
export function nameKey(name: string): string {
  return name.toLowerCase();
}

/**
 * Coerces any stored name (accounts made before the rule) into a valid one for display:
 * invalid characters become "_", runs of "_" collapse, capped at 16, padded to 3.
 */
export function coerceName(name: unknown, fallback = "Farmer"): string {
  if (typeof name !== "string") return fallback;
  let s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, NAME_MAX);
  if (s.length === 0) return fallback;
  while (s.length < NAME_MIN) s += "_";
  return s;
}

/** Placeholder guest name ("Guest_" + 6 hex), unique enough; the D1 index is the final word. */
export function guestName(rand: () => number): string {
  let hex = "";
  for (let i = 0; i < 6; i++) hex += Math.floor(rand() * 16).toString(16);
  return `Guest_${hex}`;
}
