import { describe, expect, it } from "vitest";
import { canPlace, footprint } from "../src/shared/engine";
import type { PlacedObject } from "../src/shared/types";
import { makeMap } from "./engine-fixtures";

// Rows 1-3 (x 1-6) are cottage floor, rows 5-7 are yard.
const map = makeMap(
  [
    "##########",
    "#wwwwww#.#",
    "#wwwwww#.#",
    "#wwwwww#.#",
    "####w####.",
    "..........",
    "..........",
    "..........",
  ],
  {
    floorArea: [{ x: 1, y: 1, w: 6, h: 4 }],
    farmArea: [{ x: 5, y: 5, w: 4, h: 3 }],
    props: [{ id: "bin", type: "shipping_bin", x: 0, y: 7, w: 2, h: 1 }],
    // Spawn in the yard's bottom-right corner, exit at the east edge (column 9, rows 1-3).
    spawns: { default: { x: 9.5, y: 7.5 } },
    exits: [{ x: 9, y: 1, w: 1, h: 3, to: "village", spawn: "from_home" }],
  },
);

const ok = { ok: true };

describe("footprint", () => {
  it("rotates odd rotations", () => {
    expect(footprint("table_wood", 0)).toEqual({ w: 2, h: 1 });
    expect(footprint("table_wood", 1)).toEqual({ w: 1, h: 2 });
    expect(footprint("table_wood", 2)).toEqual({ w: 2, h: 1 });
    expect(footprint("bed_simple", 3)).toEqual({ w: 2, h: 1 });
    expect(footprint("rug", 0)).toEqual({ w: 5, h: 2 }); // the size of its art
    expect(footprint("turnip", 0)).toEqual({ w: 1, h: 1 });
  });
});

describe("canPlace", () => {
  it("places floor furniture indoors", () => {
    expect(canPlace(map, [], [], "chair_wood", 1, 1, 0)).toEqual(ok);
    expect(canPlace(map, [], [], "rug", 1, 2, 0)).toEqual(ok);
    expect(canPlace(map, [], [], "rug", 3, 2, 0).ok).toBe(false); // would run into the wall
  });

  it("rejects non-furniture and unknown items", () => {
    expect(canPlace(map, [], [], "turnip", 1, 1, 0).ok).toBe(false);
    expect(canPlace(map, [], [], "nope", 1, 1, 0).ok).toBe(false);
  });

  it("floor items must be indoors, outdoor items outdoors", () => {
    expect(canPlace(map, [], [], "chair_wood", 2, 6, 0).ok).toBe(false);
    expect(canPlace(map, [], [], "fence", 2, 6, 0)).toEqual(ok);
    expect(canPlace(map, [], [], "fence", 2, 2, 0).ok).toBe(false);
    expect(canPlace(map, [], [], "scarecrow", 3, 5, 0)).toEqual(ok);
  });

  it("whole footprint must be inside the floor area / clear of walls", () => {
    expect(canPlace(map, [], [], "table_wood", 5, 1, 0)).toEqual(ok);
    expect(canPlace(map, [], [], "table_wood", 6, 1, 0).ok).toBe(false); // second tile on wall
    expect(canPlace(map, [], [], "table_wood", 6, 1, 1)).toEqual(ok); // rotated vertical fits
    expect(canPlace(map, [], [], "bed_simple", 1, 3, 0).ok).toBe(false); // runs into wall row 4
  });

  it("out of bounds and non-integer positions", () => {
    expect(canPlace(map, [], [], "fence", -1, 5, 0).ok).toBe(false);
    expect(canPlace(map, [], [], "fence", 10, 5, 0).ok).toBe(false);
    expect(canPlace(map, [], [], "fence", 2.5, 5, 0).ok).toBe(false);
  });

  it("collides with props", () => {
    expect(canPlace(map, [], [], "fence", 1, 7, 0).ok).toBe(false);
    expect(canPlace(map, [], [], "fence", 2, 7, 0)).toEqual(ok);
  });

  it("collides with other objects, except the one being moved", () => {
    const objects: PlacedObject[] = [{ id: "t1", item: "table_wood", x: 2, y: 2, rotation: 0 }];
    expect(canPlace(map, objects, [], "chair_wood", 3, 2, 0).ok).toBe(false);
    expect(canPlace(map, objects, [], "chair_wood", 4, 2, 0)).toEqual(ok);
    expect(canPlace(map, objects, [], "table_wood", 3, 2, 0, { ignoreId: "t1" })).toEqual(ok);
    // a rotated object occupies its rotated footprint
    const vertical: PlacedObject[] = [{ id: "b", item: "bed_simple", x: 1, y: 1, rotation: 0 }];
    expect(canPlace(map, vertical, [], "chair_wood", 1, 2, 0).ok).toBe(false);
    expect(canPlace(map, vertical, [], "chair_wood", 2, 1, 0)).toEqual(ok);
  });

  it("rejects farm tiles", () => {
    const farm = [{ x: 6, y: 6, crop: null, plantedAt: null, wateredDays: 0, lastWateredDay: null }];
    expect(canPlace(map, [], farm, "fence", 6, 6, 0).ok).toBe(false);
    expect(canPlace(map, [], farm, "fence", 7, 6, 0)).toEqual(ok);
  });

  it("rejects tiles where someone is standing", () => {
    expect(canPlace(map, [], [], "chair_wood", 2, 2, 0, { occupied: [{ x: 2.5, y: 2.5 }] }).ok).toBe(false);
    // body overlapping from the next tile
    expect(canPlace(map, [], [], "chair_wood", 2, 2, 0, { occupied: [{ x: 3.2, y: 2.5 }] }).ok).toBe(false);
    expect(canPlace(map, [], [], "chair_wood", 2, 2, 0, { occupied: [{ x: 4.5, y: 2.5 }] })).toEqual(ok);
  });

  it("keeps exits and spawn points clear (1-tile margin)", () => {
    expect(canPlace(map, [], [], "fence", 8, 1, 0).ok).toBe(false); // next to the exit
    expect(canPlace(map, [], [], "fence", 8, 7, 0).ok).toBe(false); // next to the spawn
    expect(canPlace(map, [], [], "fence", 8, 6, 0).ok).toBe(false); // diagonal to the spawn
    expect(canPlace(map, [], [], "fence", 2, 6, 0)).toEqual(ok);
  });

  it("returns a reason string", () => {
    const r = canPlace(map, [], [], "chair_wood", 2, 6, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });
});

describe("doorways and rugs", () => {
  // A room whose floor runs right up to the spawn point and the exit in its south wall.
  const room = makeMap(["#######", "#wwwww#", "#wwwww#", "#wwwww#", "###w###"], {
    floorArea: [{ x: 1, y: 1, w: 5, h: 3 }],
    spawns: { default: { x: 3.5, y: 3.5 } },
    exits: [{ x: 3, y: 4, w: 1, h: 1, to: "home", spawn: "from_home_in" }],
  });
  it("says to keep the way out clear on the door tile itself", () => {
    expect(canPlace(room, [], [], "chair_wood", 3, 4, 0)).toEqual({ ok: false, reason: "Keep the way out clear." });
  });
  it("lets a rug lie by the door and the spawn (it never blocks anyone)", () => {
    expect(canPlace(room, [], [], "rug", 1, 2, 0)).toEqual(ok);
    expect(canPlace(room, [], [], "chair_wood", 3, 2, 0)).toEqual({ ok: false, reason: "Keep the doorway clear." });
  });
});
