// Map definitions.
// Maps are built in code (deterministic, seeded) so server and client share them without loading files.
// getMap() caches each map; treat the returned MapData as read-only (it is shared by every caller).
import type { MapData, MapId } from "../types";
import { buildCaves } from "./caves";
import { buildHome } from "./home";
import { buildHomeInterior } from "./home-in";
import { INTERIOR_BUILDERS } from "./interiors";
import { buildRiverside } from "./riverside";
import { buildVillage } from "./village";

export { mapToAscii } from "./ascii";
export { PROP_FOOTPRINTS, type PropType } from "./props";

const BUILDERS: Record<MapId, () => MapData> = {
  home: buildHome,
  home_in: buildHomeInterior,
  village: buildVillage,
  riverside: buildRiverside,
  caves: buildCaves,
  ...INTERIOR_BUILDERS,
};

const cache = new Map<MapId, MapData>();

export function getMap(zone: MapId): MapData {
  let map = cache.get(zone);
  if (!map) {
    const build = BUILDERS[zone];
    if (!build) throw new Error(`unknown zone: ${zone}`);
    map = build();
    cache.set(zone, map);
  }
  return map;
}
