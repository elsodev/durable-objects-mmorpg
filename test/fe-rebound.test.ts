import { describe, expect, it } from "vitest";
import catalog from "../src/client/public/assets/lpc/catalog.json";
import { repeatsNotice } from "../src/client/ui/dialogs-logic";
import { REBOUND_FRAME_MS, REBOUND_FRAMES, REBOUND_RECOIL, REBOUND_TOOLS, reboundFrame, reboundRecoil, reboundTool, toolContactPoint } from "../src/client/render/hit-fx-logic";

describe("rebound spark", () => {
  it("plays each frame once, then ends", () => {
    expect(reboundFrame(0)).toBe(0);
    expect(reboundFrame(REBOUND_FRAME_MS)).toBe(1);
    expect(reboundFrame(REBOUND_FRAME_MS * REBOUND_FRAMES - 1)).toBe(REBOUND_FRAMES - 1);
    expect(reboundFrame(REBOUND_FRAME_MS * REBOUND_FRAMES)).toBe(-1);
  });

  it("jolts the swinger away from what they hit", () => {
    const r = reboundRecoil({ x: 5, y: 5 }, { x: 6, y: 5 });
    expect(r.x).toBeCloseTo(-REBOUND_RECOIL);
    expect(r.y).toBeCloseTo(0);
    const up = reboundRecoil({ x: 5, y: 5 }, { x: 5, y: 3 });
    expect(up.y).toBeGreaterThan(0);
    expect(Math.hypot(up.x, up.y)).toBeCloseTo(REBOUND_RECOIL);
  });
});

describe("repeated notices", () => {
  it("treats the same text, or the same text with a warning added, as a repeat", () => {
    expect(repeatsNotice("Clang.", "Clang.")).toBe(true);
    expect(repeatsNotice("Clang.", "Clang. You're tired.")).toBe(true);
    expect(repeatsNotice("Clang.", "Too far away.")).toBe(false);
    expect(repeatsNotice("", "Clang.")).toBe(false);
  });
});

describe("tool contact point", () => {
  it("sits in front of the swinger at arm height", () => {
    const me = { x: 10, y: 10 };
    expect(toolContactPoint(me, "up").y).toBeLessThan(me.y - 1.3);
    expect(toolContactPoint(me, "left").x).toBeLessThan(me.x);
    expect(toolContactPoint(me, "right").x).toBeGreaterThan(me.x);
    expect(toolContactPoint(me, "down").y).toBeGreaterThan(me.y - 0.55);
  });
});

describe("rebound sheet per tool", () => {
  it("uses the tool's own sheet for every tier of axe, pickaxe, hoe and sword", () => {
    for (const [item, tool] of [["axe", "axe"], ["pickaxe", "pickaxe"], ["hoe", "hoe"], ["sword_wood", "sword"]] as const) {
      expect(reboundTool(item), item).toBe(tool);
    }
    expect(reboundTool("watering_can")).toBeNull();
    expect(reboundTool(null)).toBeNull();
    expect(reboundTool("x", () => "sword")).toBe("sword");
  });

  it("has a catalog sheet with four 32 px frames for each tool, all centred", () => {
    const cat = catalog as unknown as { props: Record<string, { frames: number[][]; anchor: number[] }> };
    for (const tool of [...REBOUND_TOOLS, null]) {
      const e = cat.props[tool ? `fx_rebound_${tool}` : "fx_rebound"];
      expect(e, String(tool)).toBeTruthy();
      expect(e.frames).toHaveLength(REBOUND_FRAMES);
      expect(e.anchor).toEqual([16, 16]);
      for (const f of e.frames) expect(f.slice(2)).toEqual([32, 32]);
    }
  });
});
