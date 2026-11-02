import { describe, expect, it } from "vitest";
import { CAT_ROWS, catFrame, initialCat, stepCat, stillCat, type CatState } from "../src/client/ui/login-cat-logic";

/** Seeded generator so runs repeat. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("start screen cat", () => {
  const W = 800, SCALE = 3;

  it("walks in the direction it faces with a 4-frame cycle", () => {
    const rand = lcg(1);
    let s: CatState = { x: 100, facing: "right", mode: "walk", left: 10, t: 0 };
    const cols = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const before = s.x;
      s = stepCat(s, 1 / 30, W, SCALE, rand);
      expect(s.x).toBeGreaterThan(before);
      cols.add(catFrame(s).col);
      expect(catFrame(s).row).toBe(CAT_ROWS.walk.right);
    }
    expect(cols.size).toBe(4);
  });

  it("turns round once it has walked off an edge", () => {
    let s: CatState = { x: W + 200, facing: "right", mode: "walk", left: 10, t: 0 };
    s = stepCat(s, 0.016, W, SCALE, lcg(2));
    expect(s.facing).toBe("left");
    s = stepCat({ ...s, x: -400 }, 0.016, W, SCALE, lcg(2));
    expect(s.facing).toBe("right");
  });

  it("stays near the screen and sometimes sits, grooms and changes direction", () => {
    const rand = lcg(7);
    let s = initialCat(W, SCALE, rand);
    const modes = new Set<string>();
    const facings = new Set<string>();
    for (let i = 0; i < 60 * 180; i++) {
      s = stepCat(s, 1 / 60, W, SCALE, rand);
      modes.add(s.mode);
      facings.add(s.facing);
      expect(s.x).toBeGreaterThan(-32 * SCALE * 2);
      expect(s.x).toBeLessThan(W + 32 * SCALE);
      if (s.mode !== "walk") expect(s.x).toBeGreaterThan(0);
    }
    expect(modes).toEqual(new Set(["walk", "sit", "groom"]));
    expect(facings.size).toBe(2);
  });

  it("holds still for reduced motion", () => {
    const s = stillCat(W, SCALE);
    expect(s.mode).toBe("sit");
    expect(stepCat(s, 5, W, SCALE, lcg(3))).toMatchObject({ mode: "sit", x: s.x });
    expect(catFrame(s).col).toBe(0);
  });
});
