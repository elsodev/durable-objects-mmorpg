import { describe, expect, it } from "vitest";
import { beginClimb, CLIMB_MS, climbing, climbPoint } from "../src/shared/climb";
import { CLIMB, climbAt } from "../src/client/render/pose-logic";
import { getMap } from "../src/shared/maps";
import type { EntityState, MapExit } from "../src/shared/types";

const hole: MapExit = { x: 5, y: 7, w: 1, h: 1, to: "caves_3_left", spawn: "from_caves_2_left", climb: "down" };
const ladder: MapExit = { x: 9, y: 4, w: 1, h: 1, to: "caves", spawn: "from_caves_2_left", climb: "up" };

describe("climbing a ladder (server side)", () => {
  it("puts the climber over the hole or in front of the ladder, facing the wall, for everyone to see", () => {
    const e: Pick<EntityState, "x" | "y" | "facing" | "moving" | "act"> = { x: 5.2, y: 7.9, facing: "left", moving: true };
    const until = beginClimb(e, hole, 1000);
    expect(until).toBe(1000 + CLIMB_MS);
    expect(e).toMatchObject({ x: 5.5, facing: "up", moving: false, act: { k: "climb_down", at: 1000 } });
    expect(Math.floor(e.y)).toBe(7); // still over the hole's tile
    beginClimb(e, ladder, 2000);
    expect(e.act).toEqual({ k: "climb_up", at: 2000 });
    expect(e.y).toBeGreaterThan(ladder.y + 1); // in front of the ladder's foot, so drawn over it
    expect(climbPoint(ladder).x).toBe(9.5);
  });

  it("plays for a little under a second", () => {
    expect(CLIMB_MS).toBeGreaterThanOrEqual(600);
    expect(CLIMB_MS).toBeLessThanOrEqual(900);
    expect(climbing({ k: "climb_up", at: 0 }, CLIMB_MS - 1)).toBe(true);
    expect(climbing({ k: "lie", at: 0 }, 10)).toBe(false);
    expect(climbing(undefined, 10)).toBe(false);
  });

  it("every cave ladder's climb point stands on open ground", () => {
    for (const z of ["caves", "caves_2_left", "caves_3_top", "caves_4_right"] as const) {
      const map = getMap(z);
      for (const e of map.exits.filter((x) => x.climb)) {
        const p = climbPoint(e);
        const g = map.ground[Math.floor(p.y) * map.width + Math.floor(p.x)];
        expect(g, `${z} -> ${e.to}`).toBe(5); // Ground.Stone
      }
    }
  });
});

describe("climb animation (any look)", () => {
  it("cycles the back-view walk frames, never the standing frame", () => {
    const seen = new Set<number>();
    for (let t = 0; t < CLIMB_MS; t += 20) seen.add(climbAt("climb_down", t, CLIMB_MS, 9).frame);
    expect(seen.has(0)).toBe(false);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    // A look with a single frame still works.
    expect(climbAt("climb_up", 300, CLIMB_MS, 1).frame).toBe(0);
  });

  it("going down sinks below the rim and fades; the name tag follows", () => {
    const start = climbAt("climb_down", 0, CLIMB_MS, 9);
    const end = climbAt("climb_down", CLIMB_MS, CLIMB_MS, 9);
    expect(start).toMatchObject({ dy: 0, alpha: 1, clipY: CLIMB.clipY, head: CLIMB.head });
    expect(end.dy).toBeGreaterThanOrEqual(CLIMB.sink);
    expect(end.alpha).toBe(0);
    expect(end.head).toBeLessThan(start.head);
    for (let t = 0; t + 50 <= CLIMB_MS; t += 50) {
      expect(climbAt("climb_down", t + 50, CLIMB_MS, 9).dy).toBeGreaterThanOrEqual(climbAt("climb_down", t, CLIMB_MS, 9).dy - 1);
    }
  });

  it("going up rises up the ladder, unclipped, and fades at the top", () => {
    const mid = climbAt("climb_up", CLIMB_MS / 2, CLIMB_MS, 9);
    const end = climbAt("climb_up", CLIMB_MS, CLIMB_MS, 9);
    expect(mid.clipY).toBeNull();
    expect(mid.dy).toBeLessThan(0);
    expect(end.dy).toBeLessThanOrEqual(-CLIMB.rise);
    expect(end.alpha).toBe(0);
    expect(end.head).toBeGreaterThan(CLIMB.head);
  });
});
