import { describe, expect, it } from "vitest";
import { heartStates, hotbarSlots, isTypingTarget, pingLevel, shortcutFor } from "../src/client/ui/hud-logic";
import { setUiSoundPlayer, uiSound } from "../src/client/ui/sound";

describe("heartStates", () => {
  it("uses one heart per 2 hp", () => {
    expect(heartStates(10, 10)).toEqual(["full", "full", "full", "full", "full"]);
    expect(heartStates(5, 10)).toEqual(["full", "full", "half", "empty", "empty"]);
    expect(heartStates(0, 10)).toEqual(Array(5).fill("empty"));
  });
  it("clamps and scales large pools onto 10 hearts", () => {
    expect(heartStates(-3, 10).every((h) => h === "empty")).toBe(true);
    expect(heartStates(99, 6)).toEqual(["full", "full", "full"]);
    const big = heartStates(50, 100);
    expect(big).toHaveLength(10);
    expect(big.filter((h) => h === "full")).toHaveLength(5);
  });
  it("handles bad input", () => {
    expect(heartStates(5, 0)).toEqual([]);
    expect(heartStates(NaN, 4)).toEqual(["empty", "empty"]);
  });
});

describe("hotbarSlots", () => {
  it("returns 8 entries with nulls for missing or empty", () => {
    const s = hotbarSlots({ coins: 0, slots: [{ item: "hoe", qty: 1 }, { item: "turnip", qty: 0 }] });
    expect(s).toHaveLength(8);
    expect(s[0]).toEqual({ item: "hoe", qty: 1 });
    expect(s[1]).toBeNull();
    expect(hotbarSlots(null).every((x) => x === null)).toBe(true);
  });
});

describe("shortcuts", () => {
  it("maps I/G/Escape", () => {
    expect(shortcutFor({ key: "i" }, false)).toBe("inventory");
    expect(shortcutFor({ key: "G" }, false)).toBe("goals");
    expect(shortcutFor({ key: "Escape" }, false)).toBe("escape");
    expect(shortcutFor({ key: "w" }, false)).toBeNull();
  });
  it("ignores typing, modifiers and repeats", () => {
    expect(shortcutFor({ key: "i" }, true)).toBeNull();
    expect(shortcutFor({ key: "i", target: { tagName: "input" } }, false)).toBeNull();
    expect(shortcutFor({ key: "i", target: { tagName: "DIV", isContentEditable: true } }, false)).toBeNull();
    expect(shortcutFor({ key: "i", ctrlKey: true }, false)).toBeNull();
    expect(shortcutFor({ key: "g", repeat: true }, false)).toBeNull();
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
  });
});

describe("pingLevel", () => {
  it("buckets latency", () => {
    expect(pingLevel(40)).toBe("good");
    expect(pingLevel(200)).toBe("ok");
    expect(pingLevel(500)).toBe("bad");
  });
});

describe("uiSound", () => {
  it("is a no-op until a player is set, and swallows player errors", () => {
    expect(() => uiSound("click")).not.toThrow();
    const played: string[] = [];
    setUiSoundPlayer((k) => played.push(k));
    uiSound("open");
    uiSound("custom_key");
    expect(played).toEqual(["open", "custom_key"]);
    setUiSoundPlayer(() => {
      throw new Error("boom");
    });
    expect(() => uiSound("hover")).not.toThrow();
  });
});
