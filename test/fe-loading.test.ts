import { describe, expect, it } from "vitest";
import { LOAD_STEPS, loadLabel, loadProgress, zoneLoadLabel, type LoadStep } from "../src/client/ui/loading-logic";

describe("loading screen logic", () => {
  it("counts finished steps in any order", () => {
    expect(loadProgress(new Set())).toBe(0);
    expect(loadProgress(new Set<LoadStep>(["audio"]))).toBe(1 / LOAD_STEPS.length);
    expect(loadProgress(new Set(LOAD_STEPS.map((s) => s.id)))).toBe(1);
  });

  it("names the first step still running", () => {
    expect(loadLabel(new Set())).toBe(LOAD_STEPS[0]!.label);
    // Art done before the renderer is impossible, but the label still reports the renderer.
    expect(loadLabel(new Set<LoadStep>(["art"]))).toBe(LOAD_STEPS[0]!.label);
    expect(loadLabel(new Set<LoadStep>(["renderer", "art"]))).toBe(LOAD_STEPS[2]!.label);
    expect(loadLabel(new Set(LOAD_STEPS.map((s) => s.id)))).toBe("Here we go!");
  });

  it("says where a zone change is going", () => {
    expect(zoneLoadLabel("Riverside")).toBe("Heading to Riverside…");
    expect(zoneLoadLabel("  ")).toBe("On the way…");
    expect(zoneLoadLabel(null)).toBe("On the way…");
  });
});
