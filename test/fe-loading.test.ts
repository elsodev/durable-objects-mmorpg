import { describe, expect, it } from "vitest";
import { LOAD_STEPS, OUTDATED_LABEL, loadLabel, loadProgress, zoneLoadLabel, zoneProgress, type LoadStep } from "../src/client/ui/loading-logic";

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

describe("zone change bar", () => {
  it("moves forward through the trip", () => {
    const stages = ["leaving", "connected", "arrived", "shown"] as const;
    const values = stages.map(zoneProgress);
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    expect(values[0]!).toBeGreaterThan(0);
    expect(values.at(-1)).toBe(1);
  });

  it("asks for a refresh when the page is out of date", () => {
    expect(OUTDATED_LABEL).toMatch(/refresh/i);
  });
});
