import { describe, expect, it } from "vitest";
import { blinkVisible, deathSquash, hitLabel, hurtShake, KB_LAG_MS, knockbackDone, knockbackOffset, slimePose } from "../src/client/game/combat-fx-logic";
import { knockbackProgress } from "../src/shared/engine/combat";

describe("combat feedback", () => {
  it("predicts the slide at once and hands back to the server positions", () => {
    const slide = { x: 0.6, y: 0 };
    expect(knockbackOffset(0, slide)).toEqual({ x: 0, y: 0 });
    // Before the lagging positions move, the offset is the whole predicted slide so far.
    expect(knockbackOffset(100, slide).x).toBeCloseTo(0.6 * knockbackProgress(100), 9);
    // Drawn = lagging server + offset = predicted curve.
    const t = KB_LAG_MS + 120;
    expect(knockbackOffset(t, slide).x + 0.6 * knockbackProgress(t - KB_LAG_MS)).toBeCloseTo(0.6 * knockbackProgress(t), 9);
    expect(Math.abs(knockbackOffset(3000, slide).x)).toBeLessThan(1e-4);
    expect(knockbackDone(3000)).toBe(true);
  });

  it("blinks 50 ms on, 50 ms off while invincible", () => {
    expect([0, 49, 50, 99, 100].map((t) => blinkVisible(t, 1200))).toEqual([true, true, false, false, true]);
    expect(blinkVisible(1250, 1200)).toBe(true);
  });

  it("labels hits: numbers, crits and misses", () => {
    expect(hitLabel({ dmg: 7 })).toEqual({ text: "7", kind: "damage" });
    expect(hitLabel({ dmg: 21, crit: true })).toEqual({ text: "21!", kind: "crit" });
    expect(hitLabel({ dmg: 0, miss: true })).toEqual({ text: "Miss", kind: "miss" });
    expect(hurtShake(5).ms).toBe(75);
    expect(hurtShake(40).ms).toBe(300);
  });

  it("squashes on death and crouches before a leap", () => {
    expect(deathSquash(300)).toEqual({ sx: 1.5, sy: 0.25, alpha: 0 });
    expect(slimePose("windup", 400).sy).toBeLessThan(1);
    expect(slimePose("leap", 200).lift).toBeGreaterThan(0.5);
    expect(slimePose("leap", 900).lift).toBe(0);
  });
});
