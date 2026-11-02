import { describe, expect, it } from "vitest";
import { getMap } from "../src/shared/maps";
import { BUILDING_DOORS } from "../src/shared/maps/interiors";
import { INTERIOR_ZONES } from "../src/shared/types";
import { doorHintAt } from "../src/client/render/door-hint";

const village = getMap("village");

describe("door hints", () => {
  it.each(INTERIOR_ZONES)("%s shows an exit hint by the door only", (zone) => {
    const map = getMap(zone);
    const e = map.exits[0]!;
    expect(doorHintAt(map, { x: e.x + 0.5, y: e.y - 0.5 })?.text).toBe("Exit to Village");
    expect(doorHintAt(map, { x: e.x + 0.5, y: 3.5 })).toBeNull();
  });

  it("names the building when you stand at its door in the village", () => {
    for (const d of BUILDING_DOORS) {
      const s = village.spawns[`from_${d.zone}`]!;
      const hint = doorHintAt(village, { x: s.x, y: s.y - 1 });
      expect(hint?.text).toBe(`Enter ${d.name}`);
      expect(hint).toMatchObject({ x: d.door.x + 0.5, y: d.door.y });
    }
    expect(doorHintAt(village, village.spawns.default!)).toBeNull();
    expect(doorHintAt(getMap("riverside"), getMap("riverside").spawns.default!)).toBeNull();
  });

  it("invites you into the cave mouth and shows the way back out", () => {
    const quarry = getMap("quarry");
    const caves = getMap("caves");
    expect(doorHintAt(quarry, quarry.spawns.from_caves!)?.text).toBe("Enter the Caves");
    expect(doorHintAt(quarry, quarry.spawns.from_village!)).toBeNull();
    const out = caves.exits.find((e) => e.to === "quarry")!;
    expect(doorHintAt(caves, { x: out.x + 1, y: out.y - 0.5 })?.text).toBe("Exit to Quarry");
  });

  it("shows a cave ladder's own label", () => {
    const caves = getMap("caves");
    const hole = caves.exits.find((e) => e.to === "caves_2_left")!;
    expect(doorHintAt(caves, caves.spawns.from_caves_2_left!)).toMatchObject({ text: "↓ Depth 2: West Hollows", y: hole.y });
    const deep = getMap("caves_3_top");
    expect(doorHintAt(deep, deep.spawns.from_caves_2_top!)?.text).toBe("↑ Climb back up");
  });

  it("hangs the plate below a passage off the top edge of the map", () => {
    const map = { ...getMap("caves"), exits: [{ x: 10, y: 0, w: 2, h: 1, to: "caves_2_top" as const, spawn: "from_caves", label: "Up there" }] };
    const hint = doorHintAt(map, { x: 11, y: 2.5 })!;
    expect(hint).toMatchObject({ text: "Up there", below: true });
    expect(hint.y).toBeGreaterThan(1);
  });
});
