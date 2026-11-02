// Caves (72x56): one map holding the entrance hall (safe miner camp) and three "floors" as
// separate chambers linked by tunnels, each tunnel mouth marked by a ladder.
//   hall    (west)        - miner camp, grumm + tess; a tunnel south leads out to the quarry
//   floor 1 (north)       - copper rocks, slimes
//   floor 2 (north-east)  - iron rocks, bats
//   floor 3 (south)       - gem rocks, rock crabs
// Passages on three edges lead down to level 2 (JSON maps in cave-levels/): west out of the hall,
// north out of floor 1 and east out of floor 2.

import { Ground, type MapData, type ZoneId } from "../types";
import { MapBuilder, type Rect } from "./builder";
import { edgePassage } from "./json/build";
import type { Edge } from "./json/spec";

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

/** The ways down to level 2: a straight passage from `from` out through `edge`. */
const DEEPER: readonly { edge: Edge; from: { x: number; y: number }; to: ZoneId; label: string; sign: { x: number; y: number } }[] = [
  { edge: "left", from: { x: 6, y: 24 }, to: "caves_2_left", label: "← Depth 2: West Hollows", sign: { x: 5, y: 22 } },
  { edge: "top", from: { x: 31, y: 8 }, to: "caves_2_top", label: "↑ Depth 2: Bat Roost", sign: { x: 29, y: 8 } },
  { edge: "right", from: { x: 64, y: 15 }, to: "caves_2_right", label: "→ Depth 2: Crab Burrows", sign: { x: 65, y: 12 } },
];

/** Bounding rect a bit inside the chamber, used for scattering rocks. */
function inner(c: Chamber, shrink = 2): Rect {
  return { x: c.cx - c.rx + shrink, y: c.cy - c.ry + shrink, w: (c.rx - shrink) * 2, h: (c.ry - shrink) * 2 };
}

export function buildCaves(): MapData {
  const b = new MapBuilder(CAVES_SIZE.width, CAVES_SIZE.height, Ground.CaveWall, 0xca7e5);

  // ---- carve chambers and tunnels ----
  for (const c of [HALL, FLOOR1, FLOOR2, FLOOR3]) b.blob(c.cx, c.cy, c.rx, c.ry, Ground.Stone, 0.3);
  const tunnel = (pts: { x: number; y: number }[]) => b.path(pts, 2, Ground.Stone, [Ground.CaveWall, Ground.Stone]);
  tunnel([{ x: 10, y: 33 }, { x: 10, y: 40 }]); // the way out, up to the cave mouth in the quarry
  tunnel([{ x: 18, y: 24 }, { x: 24, y: 24 }, { x: 24, y: 14 }, { x: 27, y: 14 }]); // hall -> floor 1
  tunnel([{ x: 42, y: 11 }, { x: 50, y: 11 }]); // floor 1 -> floor 2
  tunnel([{ x: 60, y: 21 }, { x: 60, y: 38 }]); // floor 2 -> floor 3
  b.fill({ x: 9, y: 37, w: 4, h: 4 }, Ground.Stone); // a little landing at the tunnel's end
  for (const d of DEEPER) tunnel([d.from, edgePassage(d.edge, d.from, CAVES_SIZE.width, CAVES_SIZE.height).end]);
  b.sealUnreachable(11, 28, Ground.CaveWall);

  // ---- exits & spawns ----
  // The tunnel's end is the back of the quarry's cave mouth: you come in facing north.
  b.exit({ x: 10, y: 41, w: 2, h: 1 }, "quarry", "from_caves");
  b.spawn("from_quarry", 10, 38);
  b.spawn("default", 6, 28);
  b.prop("sign_post", 12, 38, { id: "sign_quarry", label: "↓ Quarry" });
  for (const d of DEEPER) {
    const pass = edgePassage(d.edge, d.from, CAVES_SIZE.width, CAVES_SIZE.height);
    b.exit(pass.exit, d.to, "from_caves", undefined, { label: d.label });
    b.spawn(`from_${d.to}`, pass.spawn.x, pass.spawn.y);
    b.decorNear("sign_post", d.sign.x, d.sign.y, { id: `sign_${d.to}`, label: d.label });
  }

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
