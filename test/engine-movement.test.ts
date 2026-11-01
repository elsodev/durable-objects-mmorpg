import { describe, expect, it } from "vitest";
import {
  buildCollision,
  canStand,
  dist,
  exitAt,
  facingTile,
  findPath,
  isBlocked,
  moveGoal,
  setBlocked,
  stepDirection,
  stepToward,
} from "../src/shared/engine";
import { makeMap, openMap } from "./engine-fixtures";

describe("buildCollision", () => {
  it("blocks walls, water, props, rocks and non-walkable furniture", () => {
    const map = makeMap(
      [
        "#########", //
        "#.......#",
        "#..~....#",
        "#.......#",
        "#########",
      ],
      { props: [{ id: "p", type: "well", x: 5, y: 1, w: 2, h: 1 }], rocks: [{ id: "r", x: 1, y: 3, ore: "stone" }] },
    );
    const g = buildCollision(map, {
      objects: [
        { id: "a", item: "chair_wood", x: 2, y: 1, rotation: 0 },
        { id: "b", item: "rug", x: 6, y: 2, rotation: 0 },
      ],
    });
    expect(isBlocked(g, 0, 0)).toBe(true);
    expect(isBlocked(g, 3, 2)).toBe(true); // water
    expect(isBlocked(g, 5, 1) && isBlocked(g, 6, 1)).toBe(true); // prop
    expect(isBlocked(g, 1, 3)).toBe(true); // rock (all map rocks when extra.rocks omitted)
    expect(isBlocked(g, 2, 1)).toBe(true); // chair
    expect(isBlocked(g, 6, 2) || isBlocked(g, 7, 3)).toBe(false); // rug is walkable
    expect(isBlocked(g, 1, 1)).toBe(false);
    expect(isBlocked(g, -1, 1) || !isBlocked(g, 99, 1)).toBe(true); // out of bounds blocks
  });

  it("uses extra.rocks as the unbroken list", () => {
    const map = openMap(6, 6, { rocks: [{ id: "r", x: 2, y: 2, ore: "copper" }] });
    expect(isBlocked(buildCollision(map, { rocks: [] }), 2, 2)).toBe(false);
  });

  it("setBlocked clears and clips to bounds", () => {
    const g = buildCollision(openMap(5, 5));
    setBlocked(g, 3, 3, 5, 5, true);
    expect(isBlocked(g, 3, 3)).toBe(true);
    setBlocked(g, 0, 0, 2, 2, false);
    expect(isBlocked(g, 0, 0)).toBe(false);
  });
});

describe("canStand", () => {
  const g = buildCollision(openMap(5, 5));
  it("fits at tile centres and flush against walls", () => {
    expect(canStand(g, 1.5, 1.5)).toBe(true);
    expect(canStand(g, 1.3, 1.5)).toBe(true); // left edge exactly on wall boundary
    expect(canStand(g, 1.29, 1.5)).toBe(false);
    expect(canStand(g, 3.7, 1.5)).toBe(true);
    expect(canStand(g, 3.71, 1.5)).toBe(false);
    expect(canStand(g, NaN, 1)).toBe(false);
  });
});

describe("stepDirection", () => {
  const g = buildCollision(openMap(10, 10));
  const start = { x: 5.5, y: 5.5, facing: "down" as const };

  it("moves at speed and sets facing", () => {
    const r = stepDirection(start, 1, 0, 4, 250, g);
    expect(r.x).toBeCloseTo(6.5);
    expect(r.y).toBe(5.5);
    expect(r.facing).toBe("right");
    expect(r.moving).toBe(true);
  });

  it("normalises diagonals", () => {
    const r = stepDirection(start, 1, 1, 4, 250, g);
    expect(dist(start, r)).toBeCloseTo(1);
  });

  it("no input → not moving, keeps facing", () => {
    const r = stepDirection(start, 0, 0, 4, 100, g);
    expect(r).toEqual({ x: 5.5, y: 5.5, facing: "down", moving: false });
  });

  it("stops flush against a wall", () => {
    const r = stepDirection(start, 1, 0, 4, 5000, g);
    expect(r.x).toBeCloseTo(9 - 0.3, 5);
    expect(canStand(g, r.x, r.y)).toBe(true);
  });

  it("slides along a wall when moving diagonally", () => {
    const near = { x: 8.6, y: 5.5, facing: "right" as const };
    const r = stepDirection(near, 1, -1, 4, 250, g);
    expect(r.x).toBeCloseTo(8.7, 5); // pinned to the wall
    expect(r.y).toBeLessThan(5.5); // but still sliding up
    expect(r.moving).toBe(true);
  });

  it("reports not moving when pushing straight into a wall", () => {
    const flush = { x: 8.7, y: 5.5, facing: "right" as const };
    const r = stepDirection(flush, 1, 0, 4, 100, g);
    expect(r.moving).toBe(false);
    expect(r.facing).toBe("right");
  });

  it("never tunnels through a 1-tile wall even with a huge dt", () => {
    const map = makeMap(["#######", "#..#..#", "#######"]);
    const gg = buildCollision(map);
    const r = stepDirection({ x: 1.5, y: 1.5, facing: "right" }, 1, 0, 100, 1000, gg);
    expect(r.x).toBeLessThan(3);
  });

  it("nudges around a corner into a doorway", () => {
    // Wall row 3 with a gap at x=4. Player slightly off-centre pushes down.
    const map = makeMap(["#########", "#.......#", "#.......#", "####.####", "#.......#", "#########"]);
    const gg = buildCollision(map);
    let p = { x: 4.25, y: 2.5, facing: "down" as const } as { x: number; y: number; facing: "down" };
    for (let i = 0; i < 20; i++) {
      const r = stepDirection(p, 0, 1, 4.5, 100, gg);
      p = { x: r.x, y: r.y, facing: "down" };
    }
    expect(p.y).toBeGreaterThan(4);
  });
});

describe("stepToward", () => {
  const g = buildCollision(openMap(10, 10));
  it("arrives without overshooting", () => {
    let p = { x: 2.5, y: 2.5, facing: "down" as const } as { x: number; y: number; facing: "down" | "up" | "left" | "right" };
    let arrived = false;
    for (let i = 0; i < 50 && !arrived; i++) {
      const r = stepToward(p, { x: 6.5, y: 2.5 }, 4, 100, g);
      p = r;
      arrived = r.arrived;
    }
    expect(arrived).toBe(true);
    expect(p.x).toBeCloseTo(6.5, 5);
  });
  it("already there", () => {
    const r = stepToward({ x: 2.5, y: 2.5, facing: "up" }, { x: 2.55, y: 2.5 }, 4, 100, g);
    expect(r.arrived).toBe(true);
    expect(r.moving).toBe(false);
  });
  it("faces the target", () => {
    expect(stepToward({ x: 5.5, y: 5.5, facing: "up" }, { x: 5.5, y: 8.5 }, 4, 100, g).facing).toBe("down");
  });
});

describe("moveGoal", () => {
  const g = buildCollision(openMap(10, 10));
  it("pulls a target on a tile edge inside that tile, so arriving lands in it", () => {
    const goal = moveGoal(g, { x: 8, y: 4.5 });
    expect(Math.floor(goal.x)).toBe(8);
    let p = { x: 2.5, y: 4.5, facing: "down" as const } as { x: number; y: number; facing: "down" | "up" | "left" | "right" };
    for (let i = 0; i < 100; i++) {
      const r = stepToward(p, goal, 4, 100, g);
      p = r;
      if (r.arrived) break;
    }
    expect(Math.floor(p.x)).toBe(8);
    expect(exitAt(openMap(10, 10, { exits: [{ x: 8, y: 3, w: 1, h: 4, to: "village", spawn: "from_home" }] }), p.x, p.y)).not.toBeNull();
  });
  it("keeps an interior click as is", () => {
    expect(moveGoal(g, { x: 4.4, y: 5.6 })).toEqual({ x: 4.4, y: 5.6 });
  });
  it("falls back to the tile centre when the inset point would clip a wall", () => {
    const walls = buildCollision(makeMap(["#####", "#...#", "#####"]));
    expect(moveGoal(walls, { x: 2.5, y: 1.05 })).toEqual({ x: 2.5, y: 1.5 });
  });
});

describe("findPath", () => {
  const map = makeMap([
    "##########",
    "#........#",
    "#.######.#",
    "#......#.#",
    "######.#.#",
    "#......#.#",
    "##########",
  ]);
  const g = buildCollision(map);

  it("returns tile-centre waypoints excluding start, ending at goal", () => {
    const path = findPath(g, { x: 1.5, y: 1.5 }, { x: 1.2, y: 5.8 })!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toEqual({ x: 1.5, y: 5.5 });
    expect(path[0]).not.toEqual({ x: 1.5, y: 1.5 });
    for (const w of path) {
      expect(w.x % 1).toBe(0.5);
      expect(isBlocked(g, Math.floor(w.x), Math.floor(w.y))).toBe(false);
    }
  });

  it("consecutive waypoints are adjacent and never cut corners", () => {
    const path = [{ x: 1.5, y: 1.5 }, ...findPath(g, { x: 1.5, y: 1.5 }, { x: 8.5, y: 5.5 })!];
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      expect(Math.abs(dx) <= 1 && Math.abs(dy) <= 1).toBe(true);
      if (dx !== 0 && dy !== 0) {
        expect(isBlocked(g, Math.floor(path[i - 1].x + dx), Math.floor(path[i - 1].y))).toBe(false);
        expect(isBlocked(g, Math.floor(path[i - 1].x), Math.floor(path[i - 1].y + dy))).toBe(false);
      }
    }
  });

  it("finds the shortest route in open space (diagonal)", () => {
    const og = buildCollision(openMap(12, 12));
    expect(findPath(og, { x: 1.5, y: 1.5 }, { x: 6.5, y: 6.5 })!.length).toBe(5);
  });

  it("same tile → [], blocked goal → null, unreachable → null", () => {
    expect(findPath(g, { x: 1.5, y: 1.5 }, { x: 1.9, y: 1.1 })).toEqual([]);
    expect(findPath(g, { x: 1.5, y: 1.5 }, { x: 0.5, y: 0.5 })).toBeNull();
    const walled = makeMap(["#####", "#.#.#", "#####"]);
    expect(findPath(buildCollision(walled), { x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 })).toBeNull();
  });

  it("gives up after the expansion budget on huge unreachable searches", () => {
    const rows = ["#".repeat(102)];
    for (let y = 0; y < 100; y++) rows.push("#" + ".".repeat(100) + "#");
    rows.push("#".repeat(102));
    const big = makeMap(rows);
    const bg = buildCollision(big);
    setBlocked(bg, 99, 99, 2, 2, false);
    // enclose the goal at (100,100)
    setBlocked(bg, 99, 99, 1, 1, true);
    setBlocked(bg, 100, 99, 1, 1, true);
    setBlocked(bg, 99, 100, 1, 1, true);
    expect(findPath(bg, { x: 1.5, y: 1.5 }, { x: 100.5, y: 100.5 })).toBeNull();
  });

  it("followed with stepToward reaches the goal", () => {
    const path = findPath(g, { x: 1.5, y: 1.5 }, { x: 8.5, y: 5.5 })!;
    let p = { x: 1.5, y: 1.5, facing: "down" as "down" | "up" | "left" | "right" };
    for (const w of path) {
      for (let i = 0; i < 20; i++) {
        const r = stepToward(p, w, 4.5, 100, g);
        p = r;
        if (r.arrived) break;
      }
    }
    expect(dist(p, { x: 8.5, y: 5.5 })).toBeLessThanOrEqual(0.1);
  });
});

describe("exitAt / facingTile", () => {
  const map = openMap(10, 10, { exits: [{ x: 9, y: 4, w: 1, h: 2, to: "village", spawn: "from_home" }] });
  it("finds exits by tile", () => {
    expect(exitAt(map, 9.2, 5.9)?.to).toBe("village");
    expect(exitAt(map, 8.99, 5)).toBeNull();
    expect(exitAt(map, 9.5, 6.0)).toBeNull();
  });
  it("facingTile", () => {
    expect(facingTile({ x: 3.7, y: 4.2 }, "right")).toEqual({ x: 4, y: 4 });
    expect(facingTile({ x: 3.7, y: 4.2 }, "up")).toEqual({ x: 3, y: 3 });
    expect(facingTile({ x: 3.7, y: 4.2 }, "left")).toEqual({ x: 2, y: 4 });
    expect(facingTile({ x: 3.7, y: 4.2 }, "down")).toEqual({ x: 3, y: 5 });
  });
});
