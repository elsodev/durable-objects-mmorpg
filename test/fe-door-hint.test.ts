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
});
