import { describe, expect, it } from "vitest";
import { gainText, heartProgress, heartRow, progressText, todayText } from "../src/client/ui/bonds-logic";
import { chestFor, lidFrame, LID_FRAME_MS } from "../src/client/render/chests";
import type { BondView } from "../src/shared/hearts";

const view = (over: Partial<BondView> = {}): BondView => ({ npc: "rue", name: "Rue", hearts: 3, into: 20, need: 80, talkLeft: 25, pending: 0, ...over });

describe("friendship UI helpers", () => {
  it("draws ten heart slots", () => {
    expect(heartRow(3)).toEqual(["full", "full", "full", ...Array(7).fill("empty")]);
    expect(heartRow(-2).every((h) => h === "empty")).toBe(true);
    expect(heartRow(14).every((h) => h === "full")).toBe(true);
  });

  it("shows progress into the next heart", () => {
    expect(heartProgress(view())).toBe(0.25);
    expect(heartProgress(view({ hearts: 10, into: 0, need: 0 }))).toBe(1);
    expect(progressText(view())).toBe("20 / 80 to the next heart");
    expect(progressText(view({ need: 0 }))).toBe("Best friends!");
    expect(todayText(view({ talkLeft: 0 }))).toMatch(/plenty/);
  });

  it("floats the gain", () => {
    expect(gainText(25)).toBe("+25 ♥");
    expect(gainText(-25)).toBe("-25 ♥");
    expect(gainText(0)).toBeNull();
  });
});

describe("cave chests (client)", () => {
  it("plays the lid closed -> ajar -> open", () => {
    expect(lidFrame(0)).toBe(0);
    expect(lidFrame(LID_FRAME_MS)).toBe(1);
    expect(lidFrame(LID_FRAME_MS * 2)).toBe(2);
    expect(lidFrame(10_000)).toBe(2);
  });

  it("picks the chest you face, else the nearest in reach", () => {
    const list = [
      { id: "a", x: 5, y: 5, opened: false },
      { id: "b", x: 8, y: 5, opened: false },
    ];
    expect(chestFor(list, { x: 7.5, y: 6.5 }, { x: 5, y: 5 }, 2)?.id).toBe("a");
    expect(chestFor(list, { x: 8.5, y: 6.6 }, { x: 8, y: 7 }, 2)?.id).toBe("b");
    expect(chestFor(list, { x: 12, y: 12 }, { x: 12, y: 13 }, 2)).toBeNull();
  });
});
