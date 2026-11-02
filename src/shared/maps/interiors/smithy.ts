// Fenwick's smithy: forge and coal against the back wall, anvil and grindstone in the middle,
// tool racks and a workbench, stock in barrels and crates. Fenwick works the anvil here through the
// day and finishes orders here evenings.

import { Ground, type MapData } from "../../types";
import { Room } from "./room";

export function buildSmithy(): MapData {
  const r = new Room({
    zone: "int_smithy",
    w: 12,
    h: 8,
    floor: Ground.Stone,
    wall: "stone",
    door: 5,
    seed: 0x5e17,
    floorStyle: "floor_stone",
    wallPattern: "pppppwpspwpspp",
  });
  r.put("forge", 0, 0, "forge");
  r.put("coal_pile", 4, 0);
  r.put("tool_rack", 7, 0);
  r.put("tool_rack", 10, 0);
  r.put("smith_anvil", 4, 3, "anvil");
  r.put("grindstone", 8, 3);
  r.put("smith_bench", 10, 3);
  r.put("crate", 0, 7);
  r.put("crate", 1, 7);
  r.put("chest", 9, 7);
  r.put("barrel", 11, 6);
  r.put("barrel", 11, 7);

  r.put("bellows", 4, 2);
  r.hang("wall_torch", 6);
  r.hang("wall_torch", 10);

  r.npc("fenwick", 6, 4, 2);
  r.npc("jory", 9, 5, 1);
  return r.build();
}
