// Town Hall: the mayor's desk at the back, the notice board by the door (village goals), a
// meeting table, shelves of records and plants. Bram keeps the desk through the day; Tess pores over
// cave maps in the evening.

import { Ground, type MapData } from "../../types";
import { Room } from "./room";

export function buildTownHall(): MapData {
  const r = new Room({
    zone: "int_townhall",
    w: 16,
    h: 9,
    floor: Ground.Wood,
    wall: "plaster",
    door: 7,
    seed: 0x7a11,
    floorStyle: "floor_parquet",
    wallPattern: "pwpapwpspwpapwpspw",
  });
  r.put("rug_red", 5, 5);
  for (const x of [0, 1, 2]) r.put("bookshelf", x, 0);
  r.put("clock", 4, 0);
  r.put("notice_board", 6, 0, "notice_board");
  r.put("potted_tree", 9, 0);
  r.put("mayor_desk", 10, 2, "mayor_desk");
  r.put("chair_down", 11, 1);
  r.put("flower_vase", 13, 0);
  for (const x of [14, 15]) r.put("bookshelf", x, 0);

  r.put("meeting_table", 2, 4, "meeting_table");
  for (const x of [2, 3, 4]) {
    r.put("chair_down", x, 3);
    r.put("chair_up", x, 6);
  }
  r.put("chair_right", 1, 4);
  r.put("chair_left", 5, 4);

  r.put("potted_plant", 0, 8);
  r.put("potted_plant", 15, 8);
  r.put("floor_lamp", 0, 3);
  r.put("chest", 12, 8);

  r.put("candle", 3, 4);
  r.put("plate", 2, 5);
  r.hang("wall_sconce", 4);
  r.hang("wall_sconce", 8);
  r.hang("painting_portrait", 12);

  r.npc("bram", 13, 1, 1);
  r.npc("tess", 13, 3, 2);
  return r.build();
}
