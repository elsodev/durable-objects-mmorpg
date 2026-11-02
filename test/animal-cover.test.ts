import { describe, expect, it } from "vitest";
import { VILLAGE_ANIMALS } from "../src/shared/animals";
import { animalGrid, coveredTiles } from "../src/shared/engine/animals";
import { buildCollision, canStand } from "../src/shared/engine";
import { getMap } from "../src/shared/maps";
import type { MapProp } from "../src/shared/types";

describe("animals keep out from under tree tops", () => {
  it("covers the rows above a trunk, a tile each side", () => {
    const tree: MapProp = { id: "t", type: "tree", x: 10, y: 10, w: 1, h: 1 };
    expect(coveredTiles([tree])).toEqual([{ x: 9, y: 8, w: 3, h: 2 }]);
    expect(coveredTiles([{ ...tree, type: "rock_deco" }])).toEqual([]);
  });

  it("no village animal lives under a tree, and none can stand there", () => {
    const map = getMap("village");
    const g = animalGrid(buildCollision(map), map.exits, map.props);
    for (const a of VILLAGE_ANIMALS) expect(canStand(g, a.home.x, a.home.y), a.id).toBe(true);
    for (const r of coveredTiles(map.props)) expect(canStand(g, r.x + 0.5, r.y + 0.5)).toBe(false);
  });
});
