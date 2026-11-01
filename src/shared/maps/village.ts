// Village: the shared hub (64x48). Central square with fountain + notice board, Town Hall to the
// north, market stalls east, blacksmith south-east, inn west, cottages around the edges.
// Main roads: east-west along y 23..24 (home <-> caves), north-south along x 31..32 (hall <-> river).

import { Ground, type MapData } from "../types";
import { MapBuilder } from "./builder";
import { BUILDING_DOORS } from "./interiors/doors";

export const VILLAGE_SIZE = { width: 64, height: 48 } as const;

const PLAZA = { x: 24, y: 17, w: 16, h: 14 };

export function buildVillage(): MapData {
  const b = new MapBuilder(VILLAGE_SIZE.width, VILLAGE_SIZE.height, Ground.Grass, 0x5111a6e);

  // ---- exits & spawns ----
  b.exit({ x: 0, y: 22, w: 1, h: 4 }, "home", "from_village");
  b.exit({ x: 30, y: 47, w: 4, h: 1 }, "riverside", "from_village");
  b.exit({ x: 63, y: 22, w: 1, h: 4 }, "caves", "from_village");
  b.spawn("from_home", 2, 24); // a row below the "← Home" sign so its label never sits on your name tag
  b.spawn("from_riverside", 31, 45);
  b.spawn("from_caves", 61, 24); // (same for the "Caves →" sign)
  // Signposts beside each exit path.
  b.prop("sign_post", 3, 22, { id: "sign_home", label: "← Home" });
  b.prop("sign_post", 29, 45, { id: "sign_riverside", label: "↓ Riverside" });
  b.prop("sign_post", 60, 22, { id: "sign_caves", label: "Caves →" });
  b.spawn("default", 27, 24);

  // ---- roads & square ----
  b.fill(PLAZA, Ground.Dirt);
  b.reserve(PLAZA);
  b.path([{ x: 0, y: 23 }, { x: 63, y: 23 }], 2);
  b.path([{ x: 31, y: 8 }, { x: 31, y: 47 }], 2);
  b.path([{ x: 17, y: 20 }, { x: 17, y: 23 }], 2); // inn porch
  b.path([{ x: 33, y: 33 }, { x: 46, y: 33 }], 2); // blacksmith yard
  b.path([{ x: 40, y: 21 }, { x: 52, y: 21 }], 2); // market lane in front of the stalls
  b.path([{ x: 8, y: 9 }, { x: 8, y: 23 }], 2); // north-west cottages
  b.path([{ x: 15, y: 9 }, { x: 15, y: 12 }, { x: 8, y: 12 }], 2);
  b.path([{ x: 44, y: 9 }, { x: 44, y: 15 }, { x: 53, y: 15 }], 2); // north-east cottages
  b.path([{ x: 53, y: 9 }, { x: 53, y: 23 }], 2);
  b.path([{ x: 10, y: 25 }, { x: 10, y: 37 }], 2); // south-west cottages
  b.path([{ x: 33, y: 42 }, { x: 50, y: 42 }], 2); // south-east cottages

  // ---- square furniture ----
  b.prop("fountain", 30, 19, { id: "fountain" });
  b.prop("notice_board", 35, 18, { id: "notice_board" });
  for (const [x, y] of [[24, 17], [39, 17], [24, 30], [39, 30]] as const) b.prop("lantern_post", x, y);

  // ---- buildings (doors face south onto a path) ----
  b.prop("town_hall", 28, 3, { id: "town_hall" });
  b.prop("inn", 14, 15, { id: "inn" });
  b.prop("blacksmith", 43, 27, { id: "blacksmith" });
  b.prop("market_stall", 42, 18, { id: "stall_seeds" });
  b.prop("market_stall", 46, 18, { id: "stall_produce" });
  b.prop("market_stall", 50, 18, { id: "stall_goods" });
  b.prop("house_small", 6, 6, { id: "house_nw1" });
  b.prop("house_small", 14, 6, { id: "house_nw2" });
  b.prop("house_large", 42, 5, { id: "house_ne1" });
  b.prop("house_small", 52, 6, { id: "house_ne2" });
  b.prop("house_small", 6, 30, { id: "house_sw1" });
  b.prop("house_large", 13, 34, { id: "house_sw2" });
  b.prop("house_small", 40, 39, { id: "house_se1" });
  b.prop("house_large", 48, 36, { id: "house_se2" });
  b.prop("well", 20, 27, { id: "well" });

  // Every building is enterable: its door tile is an exit into the interior, and leaving the
  // interior puts you two tiles south of the door (spawns reserve the doorstep from scatter).
  for (const d of BUILDING_DOORS) {
    b.exit({ x: d.door.x, y: d.door.y, w: 1, h: 1 }, d.zone, "from_village");
    b.spawn(`from_${d.zone}`, d.door.x, d.door.y + 2);
  }

  // Garden fences beside a couple of cottages.
  for (let x = 3; x <= 7; x++) b.prop("fence_deco", x, 11);
  for (let x = 47; x <= 54; x++) b.prop("fence_deco", x, 44);

  // ---- NPCs ----
  b.npc("bram", 33, 10, 3); // in front of the Town Hall
  // Odette keeps the middle stall: feet on the art's keeper point (one tile above the footprint's
  // bottom edge) so the counter overlay hides her legs. She stays put; players talk across the counter.
  b.npc("odette", 47, 19, 0, 19);
  b.npc("fenwick", 46, 32, 2); // blacksmith yard
  b.npc("rue", 18, 21, 2); // inn porch
  b.npc("pip", 27, 27, 5); // runs around the square

  // ---- decoration ----
  b.borderTrees(2, 0.4);
  b.scatter("tree", 40, { x: 2, y: 2, w: 60, h: 44 });
  b.scatter("bush", 25, { x: 2, y: 2, w: 60, h: 44 });
  b.scatter("rock_deco", 6, { x: 2, y: 2, w: 60, h: 44 });

  return b.build({ zone: "village", name: "Mossbrook Village", ambient: "day" });
}
