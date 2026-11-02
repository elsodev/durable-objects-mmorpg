// Small yards around the village houses: fenced garden beds, flower borders and the owners'
// clutter (barrels by the fisherman's door, a woodpile by the smith's). Each yard also marks where
// its owner stands to tend it.

import { Ground } from "../types";
import type { MapBuilder, Rect } from "./builder";
import type { PropType } from "./props";

/** Tilled bed `bed` planted with `crops` row by row, fenced along the given sides. */
function gardenBed(b: MapBuilder, bed: Rect, crops: PropType[], fence: { south?: boolean; east?: boolean; west?: boolean; soil?: boolean }): void {
  // Leafy plants without a soil mound (lettuce, flower bushes) spread past the inset soil rim, so
  // those beds grow straight out of the grass; vegetable rows keep their mounds on tilled soil.
  if (fence.soil !== false) b.fill(bed, Ground.Tilled);
  let i = 0;
  for (let y = bed.y; y < bed.y + bed.h; y++) for (let x = bed.x; x < bed.x + bed.w; x++) b.prop(crops[i++ % crops.length]!, x, y);
  const x0 = bed.x - (fence.west ? 1 : 0);
  const x1 = bed.x + bed.w - (fence.east ? 0 : 1);
  if (fence.south) for (let x = x0; x <= x1; x++) b.prop("fence_deco", x, bed.y + bed.h);
  if (fence.east) for (let y = bed.y; y < bed.y + bed.h; y++) b.prop("fence_deco", bed.x + bed.w, y);
  if (fence.west) for (let y = bed.y; y < bed.y + bed.h; y++) b.prop("fence_deco", bed.x - 1, y);
}

export function buildYards(b: MapBuilder): void {
  // Iris (herbalist): a fenced flower patch west of her cottage.
  gardenBed(b, { x: 3, y: 9, w: 4, h: 2 }, ["flower_bush_pink", "flower_bush_yellow", "flower_bush_red", "flower_bush_pink", "flower_bush_red", "flower_bush_yellow", "flower_bush_pink", "flower_bush_red"], { south: true, west: true, soil: false });
  b.hangout("garden", 7, 10, "left", "iris");
  b.prop("flower_bush_red", 5, 8);

  // Tess (explorer): crates of gear by the side wall.
  b.prop("crate", 21, 6);
  b.prop("barrel", 21, 7);

  // Bram (mayor): flowers along the front of the house.
  b.prop("flower_bush_red", 42, 9);
  b.prop("flower_bush_yellow", 43, 9);
  b.prop("flower_bush_pink", 44, 9);
  b.hangout("yard", 43, 10, "up", "bram");

  // Odette (market gardener): a big fenced vegetable bed east of her path. Mound-less cabbages sit
  // in an inner column so every plant on the bed's rim stands on its own mound.
  gardenBed(b, { x: 56, y: 10, w: 4, h: 3 }, ["garden_carrot", "garden_cabbage", "garden_pumpkin", "garden_carrot"], { south: true, east: true });
  b.hangout("garden", 55, 11, "right", "odette");
  b.prop("wheelbarrow", 56, 8);

  // Marlo (fisherman): barrels and a crate of the catch beside the door.
  b.prop("barrel", 4, 33);
  b.prop("barrel", 5, 33);
  b.prop("fish_crate", 6, 33);

  // Pip: a hay bale to climb on.
  b.prop("hay_bale", 24, 36);
  b.hangout("yard", 24, 37, "up", "pip");

  // Fenwick (smith): a woodpile for the forge.
  b.prop("woodpile", 45, 40);
  b.prop("woodpile", 45, 41);

  // Grumm (miner): crates of ore by the house.
  b.prop("ore_crate", 57, 38);
  b.prop("ore_crate", 57, 39);
}
