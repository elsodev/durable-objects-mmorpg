// The deeper cave levels (2..4), one JSON file per map. Each file is checked when its map is
// first built; see docs/guides/json-maps.md for the format and src/shared/maps/caves.ts for
// level 1. Topology: every level-N map has passages on its left, top and right edges leading to
// the level-(N+1) map of that wing, and a way back up on its bottom edge.
import type { CaveDepthZoneId, MapData } from "../../types";
import { loadJsonMap } from "../json";
import caves_2_left from "./caves_2_left.json";
import caves_2_top from "./caves_2_top.json";
import caves_2_right from "./caves_2_right.json";
import caves_3_left from "./caves_3_left.json";
import caves_3_top from "./caves_3_top.json";
import caves_3_right from "./caves_3_right.json";
import caves_4_left from "./caves_4_left.json";
import caves_4_top from "./caves_4_top.json";
import caves_4_right from "./caves_4_right.json";

/** Raw JSON per level map (tests read these to check the files themselves). */
export const CAVE_LEVEL_FILES: Record<CaveDepthZoneId, unknown> = {
  caves_2_left,
  caves_2_top,
  caves_2_right,
  caves_3_left,
  caves_3_top,
  caves_3_right,
  caves_4_left,
  caves_4_top,
  caves_4_right,
};

export const CAVE_LEVEL_BUILDERS = Object.fromEntries(
  Object.entries(CAVE_LEVEL_FILES).map(([id, raw]) => [id, () => loadJsonMap(raw, `${id}.json`, id as CaveDepthZoneId)]),
) as Record<CaveDepthZoneId, () => MapData>;

/** The three wings every deeper level has, in edge order. */
export const CAVE_WINGS = ["left", "top", "right"] as const;
export type CaveWing = (typeof CAVE_WINGS)[number];
export const CAVE_MAX_DEPTH = 4;
