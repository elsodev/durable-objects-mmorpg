// Home: private per-player map. Cottage interior on the left (walled room, door on its east
// wall), farm yard on the right, path east to the village.
//
// Layout (40x30):
//   cottage walls x 2..15, y 2..15 (north wall is 3 rows thick and carries the "cottage" roof prop)
//   interior floor x 3..14, y 5..14, door at (15, 12)
//   farm area x 19..32, y 3..10 (14x8 = 112 tiles), fenced, gate at x 24..27 on the south side
//   path y 12..13 from the door to the east exit at x 39

import { Ground, type MapData } from "../types";
import { MapBuilder } from "./builder";

export const HOME_SIZE = { width: 40, height: 30 } as const;

const COTTAGE = { x: 2, y: 2, w: 14, h: 14 };
const INTERIOR = { x: 3, y: 5, w: 12, h: 10 };
const DOOR = { x: 15, y: 12 };
const FARM = { x: 19, y: 3, w: 14, h: 8 };

export function buildHome(): MapData {
  const b = new MapBuilder(HOME_SIZE.width, HOME_SIZE.height, Ground.Grass, 0x0405e);

  // Pond in the south-west corner of the yard, ringed with sand.
  b.blob(8, 22, 4, 2.5, Ground.Water, 0.15);
  b.shore();

  // Cottage: solid wall block, then carve the floor and the door.
  b.fill(COTTAGE, Ground.Wall);
  b.fill(INTERIOR, Ground.Wood);
  b.set(DOOR.x, DOOR.y, Ground.Wood);
  b.prop("cottage", COTTAGE.x, COTTAGE.y, { id: "cottage", w: COTTAGE.w, h: 3 });
  b.reserve({ x: COTTAGE.x - 1, y: COTTAGE.y - 1, w: COTTAGE.w + 2, h: COTTAGE.h + 2 });

  // Markers first so the scatter below keeps them clear.
  b.spawn("default", 8, 10);
  b.spawn("from_village", 37, 12);
  b.exit({ x: 39, y: 11, w: 1, h: 4 }, "village", "from_home");
  b.prop("sign_post", 36, 11, { id: "sign_village", label: "Village →" });

  // Path from the door to the east exit.
  b.path([{ x: DOOR.x + 1, y: DOOR.y }, { x: 39, y: DOOR.y }], 2);

  // Farm plot: keep it (and a 1 tile margin) free of decoration. A fence goes all the way round
  // with a 4 tile gate in the south side, facing the path.
  b.reserve({ x: FARM.x - 2, y: FARM.y - 2, w: FARM.w + 4, h: FARM.h + 4 });
  const south = FARM.y + FARM.h;
  const gate = { x0: FARM.x + 5, x1: FARM.x + 8 };
  for (let x = FARM.x - 1; x <= FARM.x + FARM.w; x++) {
    b.prop("fence_deco", x, FARM.y - 1);
    if (x < gate.x0 || x > gate.x1) b.prop("fence_deco", x, south);
  }
  for (let y = FARM.y; y < south; y++) {
    b.prop("fence_deco", FARM.x - 1, y);
    b.prop("fence_deco", FARM.x + FARM.w, y);
  }

  // Yard furniture.
  b.prop("well", 35, 4, { id: "well" });
  b.prop("shipping_bin", 35, 9, { id: "shipping_bin" });
  b.prop("lantern_post", 17, 10, { id: "lantern_door" });
  b.reserve({ x: 33, y: 2, w: 6, h: 10 });

  // Breakable stone rocks at the south-east edge of the yard.
  b.scatterRocks("home_rock", ["stone"], 7, { x: 22, y: 21, w: 15, h: 6 });

  // Decoration.
  b.borderTrees(1, 0.3);
  b.scatter("tree", 10, { x: 1, y: 16, w: 38, h: 13 });
  b.scatter("bush", 8, { x: 1, y: 1, w: 38, h: 28 });
  b.scatter("rock_deco", 4, { x: 1, y: 16, w: 38, h: 13 });

  return b.build({
    zone: "home",
    name: "Your Cottage",
    ambient: "day",
    farmArea: [FARM],
    floorArea: [INTERIOR],
  });
}
