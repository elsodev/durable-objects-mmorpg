import { describe, expect, it } from "vitest";
import { gaugeFill, gaugeLabel, holdsWater } from "../src/client/ui/water-gauge-logic";

describe("watering can gauge", () => {
  it("only the watering can carries it", () => {
    expect(holdsWater("watering_can")).toBe(true);
    expect(holdsWater("hoe")).toBe(false);
    expect(gaugeFill("hoe", { water: 10, max: 20 })).toBeNull();
  });

  it("is hidden until the level is known", () => {
    expect(gaugeFill("watering_can", null)).toBeNull();
    expect(gaugeFill("watering_can", { water: 5, max: 0 })).toBeNull();
  });

  it("fills by the share of water left, clamped", () => {
    expect(gaugeFill("watering_can", { water: 20, max: 20 })).toBe(1);
    expect(gaugeFill("watering_can", { water: 5, max: 20 })).toBe(0.25);
    expect(gaugeFill("watering_can", { water: 0, max: 20 })).toBe(0);
    expect(gaugeFill("watering_can", { water: 30, max: 20 })).toBe(1);
    expect(gaugeFill("watering_can", { water: -3, max: 20 })).toBe(0);
  });

  it("labels an empty can with where to refill", () => {
    expect(gaugeLabel({ water: 12, max: 20 })).toBe("Water 12/20");
    expect(gaugeLabel({ water: 0, max: 20 })).toMatch(/refill/);
  });
});
