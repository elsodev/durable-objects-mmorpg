// The Mossy Mug: bar along the west side with kegs behind it, a stone fireplace with a rug in
// front, stairs up to the guest rooms, and tables set for supper. Rue runs it from lunch on; most
// villagers drop in after work.

import { Ground, type MapData } from "../../types";
import { Room } from "./room";

export function buildInn(): MapData {
  const r = new Room({
    zone: "int_inn",
    w: 18,
    h: 9,
    floor: Ground.Wood,
    wall: "timber",
    door: 8,
    seed: 0x1bb,
    floorStyle: "floor_wood_dark",
    wallPattern: "pspspspw--wpapwpwp",
  });
  r.wallProp("stairs_up", 8, "stairs");
  r.put("rug_vine", 12, 1);

  // Bar: kegs and a cupboard behind, counter, stools in front.
  r.put("barrel_stack", 0, 0);
  r.put("dish_cabinet", 5, 0);
  r.put("bar_counter", 1, 2, "bar_counter");
  r.put("bar_counter", 4, 2, "bar_counter_2");
  for (const x of [1, 3, 5]) r.put("bar_stool", x, 3);

  r.put("fireplace", 13, 0, "fireplace");
  r.put("potted_plant", 11, 0);
  r.put("flower_vase", 17, 0);

  // Supper tables.
  r.put("table_round_meal", 10, 4);
  r.put("chair_right", 9, 4);
  r.put("chair_left", 11, 4);
  r.put("table_round", 15, 4);
  r.put("chair_right", 14, 4);
  r.put("chair_left", 16, 4);
  r.put("table_long_meal", 2, 6);
  for (const x of [2, 4]) {
    r.put("chair_down", x, 5);
    r.put("chair_up", x, 7);
  }
  r.put("table_long_meal", 12, 7);
  for (const x of [12, 14]) r.put("chair_down", x, 6);

  r.put("potted_plant", 0, 8);
  r.put("potted_plant", 17, 8);
  r.put("crate", 6, 0);

  r.put("mugs", 1, 2);
  r.put("bottle", 5, 2);
  r.put("candle", 15, 4);
  r.hang("wall_lamp_double", 4);
  r.hang("mirror", 11);
  r.hang("wall_sconce", 13);
  r.hang("painting_portrait", 2);

  r.npc("rue", 3, 0, 1);
  r.npc("odette", 12, 4, 1);
  r.npc("bram", 15, 2, 1);
  r.npc("pip", 9, 2, 2);
  r.npc("marlo", 6, 4, 1);
  r.npc("iris", 16, 6, 1);
  r.npc("grumm", 9, 7, 1);
  return r.build();
}
