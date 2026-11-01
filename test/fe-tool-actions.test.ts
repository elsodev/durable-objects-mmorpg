import { describe, expect, it } from "vitest";
import { actionFrame, actionNameFor } from "../src/client/render/tool-actions";

describe("actionNameFor", () => {
  it("prefers the item the server names", () => {
    expect(actionNameFor({ k: "pickaxe", at: 0, item: "pickaxe_iron" })).toBe("pickaxe_iron");
  });
  it("maps tool kinds to a default item", () => {
    expect(actionNameFor({ k: "water", at: 0 })).toBe("watering_can");
    expect(actionNameFor({ k: "plant", at: 0 })).toBe("harvest");
  });
  it("returns null for actions without art", () => {
    expect(actionNameFor({ k: "dance", at: 0 })).toBeNull();
    expect(actionNameFor({ k: "constructor", at: 0 })).toBeNull();
  });
});

describe("actionFrame", () => {
  it("steps through frames then ends", () => {
    expect(actionFrame(0, 100, 3, false)).toBe(0);
    expect(actionFrame(250, 100, 3, false)).toBe(2);
    expect(actionFrame(300, 100, 3, false)).toBe(-1);
  });
  it("holds the last frame when asked", () => {
    expect(actionFrame(5000, 100, 3, true)).toBe(2);
  });
});
