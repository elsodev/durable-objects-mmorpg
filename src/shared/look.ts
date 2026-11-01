// Character look options shared by server (validation) and client (creator, compositor).
// The ids mirror src/client/public/assets/lpc/custom/custom.json; test/look.test.ts keeps them in sync.
import type { Look } from "./types";

export type LookPart = keyof Look;

/** Display order of the creator tabs, and of fields in a look key. */
export const LOOK_PARTS: readonly LookPart[] = ["body", "skin", "eyes", "hairStyle", "hairColor", "top", "bottom", "shoes"];

export const LOOK_OPTIONS: Readonly<Record<LookPart, readonly string[]>> = {
  body: ["male", "male_slim", "female"],
  skin: ["light", "amber", "olive", "brown", "black"],
  eyes: ["brown", "blue", "green", "hazel", "gray"],
  hairStyle: ["short", "curly", "bob", "bun", "long"],
  hairColor: ["chestnut", "black", "blonde", "ginger", "dark_brown"],
  top: ["teal_longsleeve", "red_tshirt", "green_polo", "sky_vneck", "mustard_cardigan"],
  bottom: ["brown_pants", "navy_cuffed", "tan_shorts", "forest_skirt", "slate_pants"],
  shoes: ["brown_shoes", "black_shoes", "tan_ghillies"],
};

export const DEFAULT_LOOK: Readonly<Look> = Object.freeze({
  body: "male",
  skin: "light",
  eyes: "brown",
  hairStyle: "short",
  hairColor: "chestnut",
  top: "teal_longsleeve",
  bottom: "brown_pants",
  shoes: "brown_shoes",
});

/** Body type of looks saved before body types existed (they were all drawn on the male base). */
export const LEGACY_BODY = "male";

/**
 * A clean copy of `v` if every part is a known option id (extra fields dropped), else null.
 * A missing `body` reads as LEGACY_BODY so older saves and clients stay valid.
 */
export function validateLook(v: unknown): Look | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out = {} as Look;
  for (const part of LOOK_PARTS) {
    const id = part === "body" && o.body === undefined ? LEGACY_BODY : o[part];
    if (typeof id !== "string" || !LOOK_OPTIONS[part].includes(id)) return null;
    out[part] = id;
  }
  return out;
}

/** Stable string for a look (cache key / equality). */
export function lookKey(look: Look): string {
  return LOOK_PARTS.map((p) => look[p]).join("|");
}

export function sameLook(a: Look | undefined | null, b: Look | undefined | null): boolean {
  return !!a && !!b && lookKey(a) === lookKey(b);
}

/** Random look; `rand` returns [0, 1) (pass Math.random on the client). */
export function randomLook(rand: () => number): Look {
  const out = {} as Look;
  for (const part of LOOK_PARTS) {
    const ids = LOOK_OPTIONS[part];
    out[part] = ids[Math.min(ids.length - 1, Math.floor(rand() * ids.length))]!;
  }
  return out;
}
