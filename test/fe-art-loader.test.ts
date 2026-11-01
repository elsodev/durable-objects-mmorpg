import { describe, expect, it } from "vitest";
import {
  asRect,
  collectFiles,
  furnitureView,
  viewAnchorPx,
  hashXY,
  isSafePath,
  normAnchor,
  overlayAnchor,
  pickVariant,
  rectFits,
  rowRects,
  shadowRect,
} from "../src/client/art/slice";

describe("hashXY / pickVariant", () => {
  it("is deterministic and spreads", () => {
    expect(hashXY(3, 7)).toBe(hashXY(3, 7));
    expect(hashXY(3, 7)).not.toBe(hashXY(7, 3));
    const seen = new Set<number>();
    for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) seen.add(pickVariant(hashXY(x, y), 4));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });
  it("mostly picks the base tile", () => {
    let base = 0;
    for (let i = 0; i < 2000; i++) if (pickVariant(hashXY(i, i * 3 + 1), 5) === 0) base++;
    expect(base / 2000).toBeGreaterThan(0.5);
    expect(base / 2000).toBeLessThan(0.7);
  });
  it("handles no variants", () => {
    expect(pickVariant(12345, 0)).toBe(0);
  });
});

describe("rect parsing", () => {
  it("accepts valid tuples only", () => {
    expect(asRect([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(asRect([1, 2, 0, 4])).toBeNull();
    expect(asRect([1, 2, 3])).toBeNull();
    expect(asRect("x")).toBeNull();
    expect(asRect([-1, 0, 3, 3])).toBeNull();
  });
  it("checks bounds", () => {
    expect(rectFits([0, 0, 32, 32], 32, 32)).toBe(true);
    expect(rectFits([16, 0, 32, 32], 32, 32)).toBe(false);
  });
  it("normalises anchors", () => {
    expect(normAnchor([32, 60], 64, 64)).toEqual({ x: 0.5, y: 60 / 64 });
    expect(normAnchor(undefined, 64, 64)).toEqual({ x: 0.5, y: 1 });
  });
  it("builds animation rows with column offsets", () => {
    expect(rowRects({ row: 2, frames: 2 }, 64, 64)).toEqual([
      [0, 128, 64, 64],
      [64, 128, 64, 64],
    ]);
    expect(rowRects({ row: 1, col: 4, frames: 1 }, 64, 64)).toEqual([[256, 64, 64, 64]]);
    expect(rowRects(undefined, 64, 64)).toEqual([]);
  });
});

describe("furniture views", () => {
  const chair = { file: "a.png", rect: [3, 128, 26, 32], variants: { left: [32, 128, 32, 32], back: [192, 128, 32, 32] } } as const;
  it("maps rotations and mirrors left for right", () => {
    const e = chair as unknown as Parameters<typeof furnitureView>[0];
    expect(furnitureView(e, 0)).toEqual({ rect: [3, 128, 26, 32], mirror: false });
    expect(furnitureView(e, 1)?.rect).toEqual([32, 128, 32, 32]);
    expect(furnitureView(e, 2)?.rect).toEqual([192, 128, 32, 32]);
    expect(furnitureView(e, 3)).toEqual({ rect: [32, 128, 32, 32], mirror: true });
    expect(furnitureView({ file: "b.png", rect: [0, 0, 8, 8] }, 3)).toEqual({ rect: [0, 0, 8, 8], mirror: true });
  });
});

describe("overlay anchor", () => {
  it("lines up the market stall counter with the stall", () => {
    const a = overlayAnchor([1, 0, 91, 81], [45, 79], [18, 40, 62, 41]);
    // anchor point in sheet px must be identical for both sprites
    expect(18 + a.x * 62).toBeCloseTo(1 + 45);
    expect(40 + a.y * 41).toBeCloseTo(0 + 79);
  });
});

describe("catalog scanning", () => {
  it("collects safe files across sections and finds shadows", () => {
    const cat = {
      characters: { p: { file: "characters/p.png" } },
      props: { a: { file: "props/x.png" }, b: { file: "../evil.png" } },
      shadows: { file: "props/shadow.png", rects: { small: [2, 2, 18, 7] }, large: [100, 2, 60, 20] },
      missing: { x: "y" },
    };
    expect(collectFiles(cat as never).sort()).toEqual(["characters/p.png", "props/shadow.png", "props/x.png"]);
    expect(shadowRect(cat as never, "small")).toEqual([2, 2, 18, 7]);
    expect(shadowRect(cat as never, "large")).toEqual([100, 2, 60, 20]);
    expect(shadowRect(cat as never, "tree")).toBeNull();
    expect(isSafePath("/abs.png")).toBe(false);
  });
});

describe("viewAnchorPx", () => {
  it("keeps the front anchor for same-size views", () => {
    expect(viewAnchorPx([0, 0, 52, 88], [26, 87], [52, 0, 52, 88])).toEqual([26, 87]);
  });
  it("keeps the offset from the bottom centre for differently sized views", () => {
    // A 1x2 bed's 74x64 side view stands on the same feet point as its 52x88 front view.
    expect(viewAnchorPx([0, 0, 52, 88], [26, 87], [104, 0, 74, 64])).toEqual([37, 63]);
    expect(viewAnchorPx([0, 0, 52, 88], null, [104, 0, 74, 64])).toEqual([37, 64]);
  });
});
