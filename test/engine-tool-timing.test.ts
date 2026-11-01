import { describe, expect, it } from "vitest";
import { impactDelayMs, SWING_TOTAL_MS, TOOL_TIMING, toolTiming } from "../src/shared/engine/toolTiming";

describe("tool timing", () => {
  it("lands overhead swings later facing down than sideways or up", () => {
    for (const tool of ["hoe", "pickaxe", "axe"] as const) {
      expect(toolTiming(tool, "down")).toEqual({ impactMs: 230, totalMs: SWING_TOTAL_MS });
      expect(toolTiming(tool, "left")!.impactMs).toBe(180);
      expect(toolTiming(tool, "right")!.impactMs).toBe(180);
      expect(toolTiming(tool, "up")!.impactMs).toBe(180);
    }
  });
  it("tips the watering can at 175 ms whatever the facing", () => {
    for (const f of ["down", "up", "left", "right"] as const) expect(toolTiming("water", f)!.impactMs).toBe(175);
  });
  it("lands mid-swing, and the swing is about 475 ms", () => {
    expect(SWING_TOTAL_MS).toBe(475);
    for (const row of Object.values(TOOL_TIMING)) {
      expect(row.down).toBeLessThan(row.total);
      expect(row.side).toBeLessThan(row.total);
    }
  });
  it("applies non-swings at once", () => {
    expect(toolTiming("seed", "down")).toBeNull();
    expect(toolTiming(undefined, "down")).toBeNull();
    expect(toolTiming("constructor", "down")).toBeNull();
    expect(impactDelayMs("seed", "down")).toBe(0);
    expect(impactDelayMs("hoe", "down")).toBe(230);
  });
});
