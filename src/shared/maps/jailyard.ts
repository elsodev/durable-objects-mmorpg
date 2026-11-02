// Jail yard (40x30): the town's police station, south of the quarry. The road comes down from the
// quarry's south edge to a dirt forecourt in front of the station door; a fenced exercise yard
// lies east of the station, the sheriff's woodpile and stores to the west, woods all round.
//   north - road up to the quarry (and on to the caves and the village)
//   centre - the police station (door: the station interior, int_police)

import { Ground, type MapData } from "../types";
import { MapBuilder } from "./builder";
import { doorsIn } from "./interiors/doors";
import { deriveSeats } from "./interiors/rules";

export const JAILYARD_SIZE = { width: 40, height: 30 } as const;

/** The station's footprint (art: buildings/police_station.png); its door is in BUILDING_DOORS. */
export const STATION = { x: 16, y: 9, w: 6, h: 4 } as const;
/** Way up to the quarry, on the north edge. */
export const NORTH_EXIT = { x: 12, y: 0, w: 2, h: 1 } as const;

export function buildJailYard(): MapData {
  const W = JAILYARD_SIZE.width;
  const H = JAILYARD_SIZE.height;
  const b = new MapBuilder(W, H, Ground.Grass, 0x1a11ba);
  const [door] = doorsIn("jail");
  if (!door) throw new Error("the police station has no door");

  // ---- exits & spawns ----
  b.exit(NORTH_EXIT, "quarry", "from_jail");
  b.spawn("from_quarry", NORTH_EXIT.x, 2);
  b.prop("sign_post", NORTH_EXIT.x + 2, 2, { id: "sign_quarry", label: "↑ Quarry & Caves" });

  // ---- road and forecourt ----
  // Straight down past the west side of the station, then east onto the forecourt by its door.
  const court = { x: STATION.x - 1, y: STATION.y + STATION.h, w: STATION.w + 3, h: 4 };
  b.path([{ x: NORTH_EXIT.x, y: 0 }, { x: NORTH_EXIT.x, y: court.y + 1 }, { x: court.x, y: court.y + 1 }], 2);
  b.fill(court, Ground.Dirt);
  b.reserve({ x: court.x - 1, y: court.y, w: court.w + 2, h: court.h + 1 });

  // ---- the station ----
  b.prop("police_station", STATION.x, STATION.y, { id: door.villageProp });
  b.reserve({ x: STATION.x - 1, y: STATION.y - 2, w: STATION.w + 2, h: STATION.h + 2 });
  b.exit({ x: door.door.x, y: door.door.y, w: 1, h: 1 }, door.zone, "from_jail");
  b.spawn(`from_${door.zone}`, door.door.x, door.door.y + 2);
  b.spawn("default", door.door.x + 2, door.door.y + 3);
  b.prop("lantern_post", door.door.x - 2, court.y);
  b.prop("lantern_post", door.door.x + 3, court.y);
  // A bench on the forecourt for anyone waiting on a friend inside.
  b.prop("bench_left", court.x + court.w - 3, court.y + court.h - 1, { id: "bench_court_1" });
  b.prop("bench_right", court.x + court.w - 2, court.y + court.h - 1, { id: "bench_court_2" });
  b.prop("barrel", court.x, court.y + court.h - 1);

  // ---- exercise yard east of the station, fenced ----
  const yard = { x: 25, y: 9, w: 8, h: 7 };
  for (let x = yard.x; x < yard.x + yard.w; x++) {
    b.prop("fence_deco", x, yard.y);
    if (x !== yard.x + 3 && x !== yard.x + 4) b.prop("fence_deco", x, yard.y + yard.h - 1);
  }
  for (let y = yard.y + 1; y < yard.y + yard.h - 1; y++) {
    b.prop("fence_deco", yard.x, y);
    b.prop("fence_deco", yard.x + yard.w - 1, y);
  }
  b.fill({ x: yard.x + 1, y: yard.y + 1, w: yard.w - 2, h: yard.h - 2 }, Ground.Dirt);
  b.prop("hay_bale", yard.x + 1, yard.y + 1);
  b.prop("woodpile", yard.x + yard.w - 2, yard.y + 1);
  b.reserve({ x: yard.x - 1, y: yard.y - 1, w: yard.w + 2, h: yard.h + 3 });
  b.path([{ x: yard.x + 3, y: yard.y + yard.h - 1 }, { x: yard.x + 3, y: court.y + 1 }, { x: court.x + court.w, y: court.y + 1 }], 2);

  // ---- stores west of the station ----
  b.prop("crate", 9, 9);
  b.prop("crate", 9, 10);
  b.prop("barrel", 10, 9);
  b.prop("wheelbarrow", 8, 12);
  b.reserve({ x: 7, y: 8, w: 5, h: 6 });

  // ---- woods ----
  b.borderTrees(2, 0.4);
  b.scatter("tree", 30, { x: 2, y: 19, w: W - 4, h: H - 21 });
  b.scatter("tree", 10, { x: 2, y: 2, w: 9, h: 16 });
  b.scatter("tree", 8, { x: 33, y: 2, w: 5, h: 16 });
  b.scatter("bush", 14, { x: 2, y: 2, w: W - 4, h: H - 4 });
  b.scatter("tall_grass", 10, { x: 2, y: 2, w: W - 4, h: H - 4 });
  b.scatter("flower_bush_yellow", 3, { x: 2, y: 2, w: W - 4, h: H - 4 });
  b.scatter("rock_deco", 5, { x: 2, y: 2, w: W - 4, h: H - 4 });

  const map = b.build({ zone: "jail", name: "Mossbrook Town Jail", ambient: "day" });
  map.seats = deriveSeats(map);
  return map;
}
