// Home, outside: the player's private yard (40x30), laid out like the village. One house (the
// LPC cottage exterior) with its shipping bin and mailbox beside the door, the fenced farm to the
// east, a pond south-west, breakable rocks south-east and the road east to the village.
// The house door leads into the second home map, "home_in" (home-in.ts), on the same connection.
//
// Layout:
//   house footprint x 6..9, y 8..10, door (8, 10); doorstep spawn "from_home_in" at (8, 12)
//   mailbox (5, 11) west of the door, shipping bin (10..11, 11) east of it
//   every grass tile is tillable (farmGrass); the fenced plot x 19..32, y 3..10 is the main field
//   road y 12..13 from the doorstep to the east exit at x 39

import { Ground, type MapData } from "../types";
import { MapBuilder } from "./builder";

export const HOME_SIZE = { width: 40, height: 30 } as const;

const HOUSE = { x: 6, y: 8, w: 4, h: 3 };
/** The house door: the footprint's bottom row under the painted door (as for village houses). */
export const HOME_DOOR = { x: 8, y: 10 } as const;
const FARM = { x: 19, y: 3, w: 14, h: 8 };
/**
 * Spawn name for fainting in a zone: the home welcomes you inside, by the bed. Its yard point is
 * the doorstep, used only if the bed can't be reached.
 */
export const HOME_FAINT_SPAWN = "bed";

export function buildHome(): MapData {
  const b = new MapBuilder(HOME_SIZE.width, HOME_SIZE.height, Ground.Grass, 0x0405e);

  // Pond in the south-west corner of the yard, ringed with sand.
  b.blob(8, 22, 4, 2.5, Ground.Water, 0.15);
  b.shore();

  // The house: its door tile is an exit into the house (cut out of the footprint by
  // buildCollision); leaving the house puts you on the doorstep two tiles south.
  b.prop("home_house", HOUSE.x, HOUSE.y, { id: "house" });
  // The roof art reaches far above the footprint: keep trees off it.
  b.reserve({ x: HOUSE.x - 3, y: 0, w: HOUSE.w + 6, h: HOUSE.y + HOUSE.h + 2 });
  b.exit({ x: HOME_DOOR.x, y: HOME_DOOR.y, w: 1, h: 1 }, "home", "from_home", "home_in");
  b.spawn("from_home_in", HOME_DOOR.x, HOME_DOOR.y + 2);
  b.spawn("default", HOME_DOOR.x, HOME_DOOR.y + 2);
  b.spawn(HOME_FAINT_SPAWN, HOME_DOOR.x, HOME_DOOR.y + 2);

  // Markers first so the scatter below keeps them clear.
  b.spawn("from_village", 37, 13); // two rows below the sign: its label clears your name tag
  b.exit({ x: 39, y: 11, w: 1, h: 4 }, "village", "from_home");
  b.prop("sign_post", 36, 11, { id: "sign_village", label: "Village →" });

  // Doorstep down to the road, and the road east to the village.
  b.path([{ x: HOME_DOOR.x, y: HOME_DOOR.y + 1 }, { x: HOME_DOOR.x, y: 12 }, { x: 39, y: 12 }], 2);

  // Beside the door: the mailbox to the west, the shipping bin to the east.
  b.prop("mailbox", HOME_DOOR.x - 3, HOME_DOOR.y + 1, { id: "mailbox" });
  b.prop("shipping_bin", HOME_DOOR.x + 2, HOME_DOOR.y + 1, { id: "shipping_bin" });
  b.prop("lantern_post", HOME_DOOR.x + 5, HOME_DOOR.y + 1, { id: "lantern_door" });

  // Farm plot: keep it (and a 1 tile margin) free of decoration. A fence goes all the way round
  // with a 4 tile gate in the south side, facing the road.
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
  b.reserve({ x: 33, y: 2, w: 6, h: 10 });

  // Breakable stone rocks at the south-east edge of the yard.
  b.scatterRocks("home_rock", ["stone"], 7, { x: 22, y: 21, w: 15, h: 6 });

  // Decoration.
  b.borderTrees(1, 0.3);
  b.scatter("tree", 12, { x: 1, y: 15, w: 38, h: 14 });
  b.scatter("tree", 4, { x: 1, y: 1, w: 16, h: 6 });
  b.scatter("bush", 8, { x: 1, y: 1, w: 38, h: 28 });
  b.scatter("rock_deco", 4, { x: 1, y: 16, w: 38, h: 13 });

  return b.build({
    zone: "home",
    homeMap: "home",
    name: "Your Home",
    ambient: "day",
    // Any grass is farmland; keep a tile clear around the door, the mailbox and the bin.
    farmGrass: true,
    noFarm: [
      { x: HOME_DOOR.x - 1, y: HOME_DOOR.y + 1, w: 3, h: 1 },
      { x: HOME_DOOR.x - 4, y: HOME_DOOR.y, w: 3, h: 3 },
      { x: HOME_DOOR.x + 1, y: HOME_DOOR.y, w: 4, h: 3 },
    ],
  });
}
