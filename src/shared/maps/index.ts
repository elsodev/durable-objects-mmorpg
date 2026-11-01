// Map definitions.
// Maps are built in code (deterministic, seeded) so server and client share them without loading files.
// getMap() caches each map; treat the returned MapData as read-only (it is shared by every caller).
import type { MapData, ZoneId } from "../types";
import { buildCaves } from "./caves";
import { buildHome } from "./home";
import { INTERIOR_BUILDERS } from "./interiors";
import { buildRiverside } from "./riverside";
import { buildVillage } from "./village";

export { mapToAscii } from "./ascii";
export { PROP_FOOTPRINTS, type PropType } from "./props";

const BUILDERS: Record<ZoneId, () => MapData> = {
  home: buildHome,
  village: buildVillage,
  riverside: buildRiverside,
  caves: buildCaves,
  ...INTERIOR_BUILDERS,
};

const cache = new Map<ZoneId, MapData>();

export function getMap(zone: ZoneId): MapData {
  let map = cache.get(zone);
  if (!map) {
    const build = BUILDERS[zone];
    if (!build) throw new Error(`unknown zone: ${zone}`);
    map = build();
    cache.set(zone, map);
  }
  return map;
}
