// Caves (72x56): one map holding the entrance hall (safe miner camp) and three "floors" as
// separate chambers linked by tunnels, each tunnel mouth marked by a ladder.
//   hall    (west)        - miner camp, grumm + tess, exit west to the village
//   floor 1 (north)       - copper rocks, slimes
//   floor 2 (north-east)  - iron rocks, bats
//   floor 3 (south)       - gem rocks, rock crabs

import { Ground, type MapData } from "../types";
import { MapBuilder, type Rect } from "./builder";

export const CAVES_SIZE = { width: 72, height: 56 } as const;

interface Chamber {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

const HALL: Chamber = { cx: 11, cy: 28, rx: 9, ry: 7 };
const FLOOR1: Chamber = { cx: 34, cy: 12, rx: 10, ry: 7 };
const FLOOR2: Chamber = { cx: 58, cy: 15, rx: 10, ry: 8 };
const FLOOR3: Chamber = { cx: 46, cy: 44, rx: 16, ry: 8 };

/** Bounding rect a bit inside the chamber, used for scattering rocks. */
function inner(c: Chamber, shrink = 2): Rect {
  return { x: c.cx - c.rx + shrink, y: c.cy - c.ry + shrink, w: (c.rx - shrink) * 2, h: (c.ry - shrink) * 2 };
}

export function buildCaves(): MapData {
  const b = new MapBuilder(CAVES_SIZE.width, CAVES_SIZE.height, Ground.CaveWall, 0xca7e5);

  // ---- carve chambers and tunnels ----
  for (const c of [HALL, FLOOR1, FLOOR2, FLOOR3]) b.blob(c.cx, c.cy, c.rx, c.ry, Ground.Stone, 0.3);
  const tunnel = (pts: { x: number; y: number }[]) => b.path(pts, 2, Ground.Stone, [Ground.CaveWall, Ground.Stone]);
  tunnel([{ x: 0, y: 27 }, { x: 4, y: 27 }]); // entrance from the village
  tunnel([{ x: 18, y: 24 }, { x: 24, y: 24 }, { x: 24, y: 14 }, { x: 27, y: 14 }]); // hall -> floor 1
  tunnel([{ x: 42, y: 11 }, { x: 50, y: 11 }]); // floor 1 -> floor 2
  tunnel([{ x: 60, y: 21 }, { x: 60, y: 38 }]); // floor 2 -> floor 3
  b.sealUnreachable(4, 28, Ground.CaveWall);

  // ---- exits & spawns ----
  b.exit({ x: 0, y: 27, w: 1, h: 2 }, "village", "from_caves");
  b.spawn("from_village", 3, 28); // two rows below the sign: its label clears your name tag
  b.spawn("default", 6, 28);
  b.prop("sign_post", 3, 26, { id: "sign_village", label: "← Village" });

  // ---- miner camp (safe: no monsters in the hall) ----
  b.npc("grumm", 9, 26, 2);
  b.npc("tess", 14, 31, 2);
  b.decorNear("campfire", 11, 28, { id: "campfire" });
  b.decorNear("lantern_post", 8, 23);
  b.decorNear("lantern_post", 15, 33);
  b.prop("mine_cart", 14, 23, { id: "mine_cart" });
  b.reserve({ x: 12, y: 22, w: 6, h: 3 });

  // Ladders mark each tunnel mouth (placed beside it so they never block the way).
  b.decorNear("ladder", 19, 26, { id: "ladder_hall" });
  b.decorNear("ladder", 29, 17, { id: "ladder_floor1" });
  b.decorNear("ladder", 47, 14, { id: "ladder_floor1_down" });
  b.decorNear("ladder", 57, 21, { id: "ladder_floor2_down" });
  b.decorNear("ladder", 58, 38, { id: "ladder_floor3" });

  // ---- monsters ----
  b.monster("slime", 34, 9, 4, 3);
  b.monster("slime", 36, 15, 3, 2);
  b.monster("bat", 58, 11, 5, 3);
  b.monster("bat", 55, 18, 4, 2);
  b.monster("rock_crab", 38, 44, 4, 2);
  b.monster("rock_crab", 50, 46, 4, 2);
  b.monster("rock_crab", 46, 40, 3, 1);

  // ---- mining nodes ----
  b.scatterRocks("f1", ["copper", "copper", "copper", "stone"], 14, inner(FLOOR1));
  b.scatterRocks("f2", ["iron", "iron", "iron", "stone"], 14, inner(FLOOR2));
  b.scatterRocks("f3", ["gem", "gem", "iron"], 12, inner(FLOOR3));

  // ---- decoration (stalagmites) ----
  for (const c of [HALL, FLOOR1, FLOOR2, FLOOR3]) b.scatter("rock_deco", 4, inner(c, 1), [Ground.Stone]);

  return b.build({ zone: "caves", name: "Mossbrook Caves", ambient: "cave" });
}
