// Riverside (80x40): a meandering river crosses the lower half of the map. North bank is the
// playable meadow (dock, herb patches, fishing spots). A shrine island sits mid-river, reached by
// stepping stones. The broken bridge to the upper valley (south bank) is impassable for now.

import { Ground, type MapData } from "../types";
import { MapBuilder } from "./builder";

export const RIVERSIDE_SIZE = { width: 80, height: 40 } as const;

/** River centre line (tile row) for column x. */
function riverCentre(x: number): number {
  return 28 + 1.6 * Math.sin(x / 9) + 0.8 * Math.sin(x / 4.3 + 1);
}
const RIVER_HALF = 5;

/** First water row at column x (north bank edge). */
export function riverTop(x: number): number {
  return Math.round(riverCentre(x) - RIVER_HALF);
}

export function buildRiverside(): MapData {
  const W = RIVERSIDE_SIZE.width;
  const b = new MapBuilder(W, RIVERSIDE_SIZE.height, Ground.Grass, 0x7171e5);

  // ---- river ----
  for (let x = 0; x < W; x++) {
    const top = riverTop(x);
    const bottom = Math.round(riverCentre(x) + RIVER_HALF);
    b.fill({ x, y: top, w: 1, h: bottom - top + 1 }, Ground.Water);
  }
  b.shore();

  // ---- exits & spawns ----
  b.exit({ x: 38, y: 0, w: 4, h: 1 }, "village", "from_riverside");
  b.spawn("from_village", 39, 2);
  b.spawn("default", 40, 4);
  b.prop("sign_post", 37, 2, { id: "sign_village", label: "↑ Village" });

  // ---- paths ----
  b.path([{ x: 39, y: 0 }, { x: 39, y: 13 }], 2);
  b.path([{ x: 12, y: 13 }, { x: 66, y: 13 }], 2); // meadow trail along the bank
  b.path([{ x: 21, y: 13 }, { x: 21, y: riverTop(21) - 1 }], 2); // to the dock
  b.path([{ x: 44, y: 13 }, { x: 44, y: riverTop(44) - 1 }], 2); // to the stepping stones
  b.path([{ x: 63, y: 13 }, { x: 63, y: riverTop(63) - 3 }], 2); // to the broken bridge

  // ---- dock: wooden planks into the river, boat/mooring prop at the end ----
  const dockTop = riverTop(21) - 1;
  b.fill({ x: 21, y: dockTop, w: 2, h: 6 }, Ground.Wood);
  b.prop("dock", 20, dockTop + 5, { id: "dock" });
  b.reserve({ x: 20, y: dockTop - 1, w: 4, h: 6 });

  // ---- shrine island + stepping stones ----
  const islandY = Math.round(riverCentre(46));
  b.blob(46, islandY, 5, 2.6, Ground.Sand, 0);
  b.blob(46, islandY, 3.5, 1.6, Ground.Grass, 0);
  for (let y = riverTop(44); y < islandY - 2; y++) b.set(44, y, Ground.Stone);
  b.reserve({ x: 43, y: riverTop(44) - 1, w: 3, h: islandY - riverTop(44) });
  b.prop("shrine", 46, islandY - 1, { id: "shrine" });
  b.prop("lantern_post", 49, islandY - 1, { id: "shrine_lantern" });

  // ---- broken bridge to the upper valley (blocked) ----
  b.prop("bridge_broken", 62, riverTop(63) - 2, { id: "bridge_broken" });

  // ---- fishing spots (on water) ----
  const fishCols = [10, 30, 56, 72];
  fishCols.forEach((x, i) => b.prop("fishing_spot", x, riverTop(x) + 2, { id: `fishing_spot_${i + 1}` }));

  // ---- NPCs & monsters ----
  b.npc("marlo", 21, dockTop + 3, 1); // on the dock
  b.npc("sable", 44, islandY + 1, 2); // by the shrine
  b.npc("iris", 14, 9, 3); // among the herb patches
  b.monster("slime", 5, 5, 3, 2);
  b.monster("slime", 74, 6, 3, 2);
  b.monster("slime", 5, 17, 2, 1);
  b.monster("slime", 74, 17, 2, 1);

  // ---- decoration ----
  b.scatter("herb_patch", 9, { x: 6, y: 5, w: 18, h: 7 });
  b.scatter("herb_patch", 4, { x: 48, y: 4, w: 14, h: 7 });
  b.borderTrees(2, 0.4);
  b.scatter("tree", 30, { x: 2, y: 2, w: 76, h: 16 });
  b.scatter("bush", 14, { x: 2, y: 2, w: 76, h: 18 });
  b.scatter("rock_deco", 8, { x: 2, y: 2, w: 76, h: 20 }, [Ground.Grass, Ground.Sand]);
  // The far (south) bank is upper-valley forest: dense and out of reach.
  b.scatter("tree", 70, { x: 2, y: 33, w: 76, h: 5 });

  return b.build({ zone: "riverside", name: "Mossbrook Riverside", ambient: "day", waterStyle: "river" });
}
