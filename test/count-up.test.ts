import { describe, expect, it } from "vitest";
import { countUpMs, countUpValue } from "../src/client/ui/count-up-logic";

describe("day-end coin count-up", () => {
  it("starts at zero and lands exactly on the total", () => {
    const d = countUpMs(75);
    expect(countUpValue(75, 0, d)).toBe(0);
    expect(countUpValue(75, d, d)).toBe(75);
    expect(countUpValue(75, d + 500, d)).toBe(75);
  });
  it("only ever counts up, and fast early on", () => {
    const d = countUpMs(500);
    let last = 0;
    for (let ms = 0; ms <= d; ms += 16) {
      const v = countUpValue(500, ms, d);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(countUpValue(500, d / 3, d)).toBeGreaterThan(250);
  });
  it("keeps the count short and skips it for nothing earned", () => {
    expect(countUpMs(0)).toBe(0);
    expect(countUpMs(25)).toBeLessThan(countUpMs(300));
    expect(countUpMs(100000)).toBe(1400);
  });
  it("counts a loss down towards the negative total", () => {
    const d = countUpMs(-40);
    expect(countUpValue(-40, d / 2, d)).toBeLessThan(0);
    expect(countUpValue(-40, d, d)).toBe(-40);
  });
});
