import { describe, expect, it } from "vitest";
import { scoldLine } from "../src/worker/npc/scold";

describe("scoldLine", () => {
  it("gives each witness in one crowd a different line", () => {
    const roll = () => 0.99;
    const lines = [0, 1, 2].map((i) => scoldLine(roll, i));
    expect(new Set(lines).size).toBe(3);
  });
});
