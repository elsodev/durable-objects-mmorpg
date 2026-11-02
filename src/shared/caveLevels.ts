// Names for the cave levels in lists and labels (friends, map tab, NPC prompts). Pure.
import { isCaveDepthZone } from "./types";

const WING_NAME = { left: "west", top: "north", right: "east" } as const;

/** Depth and wing of a deeper cave zone ("caves_3_left" -> 3, "left"); null for anything else. */
export function caveLevelOf(zone: unknown): { depth: number; wing: keyof typeof WING_NAME } | null {
  if (!isCaveDepthZone(zone)) return null;
  const [, depth, wing] = zone.split("_") as [string, string, keyof typeof WING_NAME];
  return { depth: Number(depth), wing };
}

/** How deep a zone lies: 1 for the caves, 2..4 for the levels below, 0 for anything else. */
export function caveDepth(zone: unknown): number {
  if (zone === "caves") return 1;
  return caveLevelOf(zone)?.depth ?? 0;
}

/**
 * Which map above each cave level a player last came down from (zone -> zone), so a way up
 * shared by several maps returns them there. Only cave zones, one level apart.
 */
export type CaveTrail = Partial<Record<string, string>>;

/** Copies the valid entries of an untrusted trail. */
export function sanitizeCaveTrail(raw: unknown): CaveTrail {
  const out: CaveTrail = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [zone, from] of Object.entries(raw as Record<string, unknown>)) {
    if (caveDepth(zone) >= 2 && typeof from === "string" && caveDepth(from) === caveDepth(zone) - 1) out[zone] = from;
  }
  return out;
}

/** The trail after arriving in `zone` from `from`: remembered only when you came down. */
export function noteCaveArrival(trail: CaveTrail, zone: string, from: string | undefined): CaveTrail {
  if (!from || caveDepth(zone) < 2 || caveDepth(from) !== caveDepth(zone) - 1 || trail[zone] === from) return trail;
  return { ...trail, [zone]: from };
}

/** "Caves, depth 3 west" for a deeper level; null for any other zone. */
export function caveLevelLabel(zone: unknown): string | null {
  const l = caveLevelOf(zone);
  return l ? `Caves, depth ${l.depth} ${WING_NAME[l.wing]}` : null;
}
