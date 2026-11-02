// Dashing on the client: Shift with a direction, the worn-out notices and farm lock, and the dash
// look (faster stride, lean, bob, dust puffs) from render/dash-logic.ts.
import { describe, expect, it } from "vitest";
import { DASH_SPEED, FARM_LOCKED_NOTICE, PLAYER_SPEED } from "../src/shared/engine";
import { createEnergy } from "../src/client/game/energy";
import { dashDir } from "../src/client/game/input";
import { DASH_LOOK, dashBob, dashLean, dustAt, dustSpot, isFootStrike, strideFrame, strideRate } from "../src/client/render/dash-logic";

describe("dash input", () => {
  it("Shift counts only with a direction held", () => {
    expect(dashDir(["KeyD"], true)).toEqual({ dx: 1, dy: 0, dash: true });
    expect(dashDir(["ArrowUp"], true)).toEqual({ dx: 0, dy: -1, dash: true });
    expect(dashDir([], true)).toEqual({ dx: 0, dy: 0 });
    expect(dashDir(["KeyA"], false)).toEqual({ dx: -1, dy: 0 });
  });
});

describe("client energy", () => {
  it("the client energy explains Shift and stops farm swings while worn out", () => {
    const notes: string[] = [];
    const limits: { tired: boolean; canDash: boolean }[] = [];
    const en = createEnergy({ predictor: { setLimits: (l) => limits.push(l) }, notice: (t) => notes.push(t) });
    en.dashPressed(0);
    expect(notes).toEqual([]);
    en.setExhausted(true);
    expect(limits.at(-1)).toEqual({ tired: true, canDash: true });
    en.dashPressed(0);
    en.dashPressed(100); // throttled
    expect(notes.length).toBe(1);
    expect(en.blocksUse({ ok: true, effect: "till" }, true)).toBe(true);
    expect(en.blocksUse({ ok: true, effect: "hitRock" }, true)).toBe(false);
    expect(notes.at(-1)).toBe(FARM_LOCKED_NOTICE);
    en.setVisiting(true);
    expect(limits.at(-1)).toEqual({ tired: false, canDash: false });
    expect(en.exhausted).toBe(false);
  });
});

describe("dash look (render/dash-logic)", () => {
  it("runs the walk cycle faster without the standing frame, and slower when worn out", () => {
    expect(strideRate("dash")).toBeGreaterThan(1);
    expect(strideRate("tired")).toBe(0.5);
    expect(strideRate(undefined)).toBe(1);
    const run = Array.from({ length: 16 }, (_, i) => strideFrame(i, 9, "dash"));
    expect(run).not.toContain(0);
    expect(new Set(run).size).toBe(8);
    expect(strideFrame(9, 9, undefined)).toBe(0);
    // Same stride length as the walk: frames per tile stay within 15%.
    const walkFramesPerTile = 9 / PLAYER_SPEED;
    const dashFramesPerTile = (9 * DASH_LOOK.fpsMult) / DASH_SPEED;
    expect(Math.abs(dashFramesPerTile / walkFramesPerTile - 1)).toBeLessThan(0.15);
  });

  it("leans into the run sideways only, and bobs between the foot strikes", () => {
    expect(dashLean("right")).toBeLessThan(0);
    expect(dashLean("left")).toBeGreaterThan(0);
    expect(dashLean("up")).toBe(0);
    expect(dashLean("down")).toBe(0);
    expect([1, 5].map((f) => isFootStrike(f, 9))).toEqual([true, true]);
    expect([0, 2, 3, 4, 6, 7, 8].some((f) => isFootStrike(f, 9))).toBe(false);
    expect(dashBob(1, 9)).toBe(0);
    expect(dashBob(5, 9)).toBe(0);
    expect(dashBob(3, 9)).toBe(DASH_LOOK.bob);
    expect(dashBob(7, 9)).toBe(DASH_LOOK.bob);
  });

  it("puffs start by the feet, alternate sides, rise and fade out", () => {
    for (const f of ["up", "left", "down", "right"] as const) {
      const a = dustSpot(f, 0);
      const b = dustSpot(f, 1);
      expect(a).not.toEqual(b);
      expect(Math.abs(a.x)).toBeLessThanOrEqual(8);
      expect(Math.abs(a.y)).toBeLessThanOrEqual(3);
    }
    expect(dustSpot("right", 0).x).toBeLessThan(0);
    expect(dustSpot("left", 0).x).toBeGreaterThan(0);
    const start = dustAt(0)!;
    const late = dustAt(DASH_LOOK.dustLifeMs - 1)!;
    expect(start.frame).toBe(0);
    expect(late.frame).toBe(DASH_LOOK.dustFrames - 1);
    expect(late.alpha).toBeLessThan(start.alpha);
    expect(late.rise).toBeGreaterThan(start.rise);
    expect(dustAt(DASH_LOOK.dustLifeMs)).toBeNull();
  });
});
