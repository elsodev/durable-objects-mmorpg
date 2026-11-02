// The police station in the jail yard: the sheriff's office by the door and, across the back of
// the room, the holding cell behind a row of iron bars. Anyone may walk in and talk to an inmate
// through the bars; only jailed players are ever inside the cell (the server puts them there and
// lets them out, see worker/game/jail.ts). The bars have no way through, so nobody walks in or out.
//
//   floor rows 0..3   the cell: two bunks against the back wall, a water barrel, a straw sack
//   floor row 4       bars, with the locked cell door in the middle
//   floor rows 5..10  the office: the sheriff's desk, a visitors' table, the way out

import { Ground, type MapData } from "../../types";
import { CELL_SPAWN, RELEASE_SPAWN, type Rect } from "../../jail";
import { Room } from "./room";

/** Floor size of the station (the map is two wider and four taller). */
const W = 16;
const H = 11;
/** Floor row of the bars, and the column of the cell door in them. */
export const BARS_ROW = 4;
export const CELL_DOOR_COL = 7;

/** The cell, in map tiles: every floor tile north of the bars. */
export const POLICE_CELL: Rect = { x: 1, y: 3, w: W, h: BARS_ROW };

export function buildPolice(): MapData {
  const r = new Room({
    zone: "int_police",
    w: W,
    h: H,
    floor: Ground.Stone,
    wall: "stone",
    door: 7,
    seed: 0x5e81ff,
    floorStyle: "floor_stone",
    wallPattern: "pppwppppppppppwppp",
    entrySpawn: "from_jail",
  });

  // ---- the cell ----
  r.put("bed_grey", 0, 0);
  r.put("bed_brown", 13, 0);
  r.put("barrel_water", 15, 3);
  r.put("sack", 0, 3);
  r.hang("wall_torch", 8);
  for (let fx = 0; fx < W; fx++) r.put(fx === CELL_DOOR_COL ? "jail_door" : "jail_bars", fx, BARS_ROW, fx === CELL_DOOR_COL ? "cell_door" : `bars_${fx}`);
  r.b.spawn(CELL_SPAWN, 1 + CELL_DOOR_COL, 3 + 2);
  r.b.spawn(RELEASE_SPAWN, 1 + CELL_DOOR_COL, 3 + BARS_ROW + 2);

  // ---- the office ----
  r.put("mayor_desk", 11, 7, "sheriff_desk");
  r.put("chair_down", 12, 6, "sheriff_chair");
  r.put("candle", 11, 7);
  r.put("cash_box", 13, 7);
  r.put("chest", 15, 10);
  r.put("crate", 15, 9);
  r.put("barrel", 12, 10);
  // Where visitors wait: a table by the west wall.
  r.put("table_round", 2, 7, "visit_table");
  r.put("chair_right", 1, 7);
  r.put("chair_left", 3, 7);
  r.put("floor_lamp", 0, 6);
  r.put("potted_plant", 0, 10);
  r.put("barrel", 3, 10);
  r.put("rug_red", 5, 7);

  r.npc("sheriff", 14, 6, 2);
  return r.build();
}
