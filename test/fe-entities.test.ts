import { describe, expect, it } from "vitest";
import { bobOffset, hitScore, phaseOf, profileFor, squashFactor, walkFrame } from "../src/client/render/entityProfile";

describe("entity profiles", () => {
  it("falls back to the humanoid profile for unknown keys", () => {
    expect(profileFor("player_3")).toBe(profileFor("villager_old"));
    expect(profileFor("bat").hover).toBeGreaterThan(0);
    expect(profileFor("bat").animateIdle).toBe(true);
  });

  it("every profile casts a shadow", () => {
    for (const k of ["player_1", "smith", "slime", "bat", "rock_crab"]) expect(profileFor(k).shadow).toBeGreaterThan(0);
  });

  it("steps walk frames at the profile fps and loops", () => {
    expect(walkFrame(0, 9, 4)).toBe(0);
    expect(walkFrame(1000 / 9 + 1, 9, 4)).toBe(1);
    expect(walkFrame((4 * 1000) / 9 + 1, 9, 4)).toBe(0);
    expect(walkFrame(500, 9, 0)).toBe(0);
  });

  it("humanoids never bob, slimes hop only while moving, bats always float", () => {
    expect(bobOffset(profileFor("player_1"), 123, true)).toBe(0);
    const slime = profileFor("slime");
    expect(bobOffset(slime, 100, false)).toBe(0);
    expect(bobOffset(slime, 100, true)).toBeGreaterThanOrEqual(0);
    const bat = profileFor("bat");
    expect(Math.abs(bobOffset(bat, 150, false))).toBeLessThanOrEqual(bat.bobAmp);
    expect(squashFactor(profileFor("smith"), 50, true)).toBe(1);
  });

  it("phase is stable and in range", () => {
    expect(phaseOf("m:1")).toBe(phaseOf("m:1"));
    expect(phaseOf("m:1")).not.toBe(phaseOf("m:2"));
    expect(phaseOf("m:1")).toBeGreaterThanOrEqual(0);
    expect(phaseOf("m:1")).toBeLessThan(1);
  });

  it("hit box covers the body above the feet", () => {
    const p = profileFor("villager_old");
    const at = { x: 5.5, y: 8.5 };
    expect(hitScore(at, p, { x: 5.5, y: 7.8 })).toBeGreaterThanOrEqual(0);
    expect(hitScore(at, p, { x: 5.5, y: 9.5 })).toBe(-1);
    expect(hitScore(at, p, { x: 6.5, y: 8 })).toBe(-1);
    // nearer the body centre scores better
    expect(hitScore(at, p, { x: 5.5, y: 7.7 })).toBeLessThan(hitScore(at, p, { x: 5.8, y: 8.6 }));
  });
});
