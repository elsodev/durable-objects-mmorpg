import { describe, expect, it } from "vitest";
import { getMap, hasMap } from "../src/shared/maps";

const IDS = ["village", "riverside", "quarry", "caves", "home", "home_in"];
import { Ground } from "../src/shared/types";

const WATER_PROPS = new Set(["lilypad", "lilypad_small", "lily_pink", "lily_white", "water_reeds"]);

describe("water plants grow in water", () => {
  it("every lily pad and water reed sits on open water, with water all round", () => {
    const bad: string[] = [];
    for (const id of IDS) {
      if (!hasMap(id)) continue;
      const m = getMap(id as never);
      const water = (x: number, y: number) => x >= 0 && y >= 0 && x < m.width && y < m.height && m.ground[y * m.width + x] === Ground.Water;
      for (const p of m.props) {
        if (!WATER_PROPS.has(p.type)) continue;
        const around = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => water(p.x + dx!, p.y + dy!));
        if (!around) bad.push(`${id} ${p.type} at ${p.x},${p.y}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
