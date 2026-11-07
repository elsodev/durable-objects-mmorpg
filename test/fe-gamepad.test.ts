import { describe, expect, it } from "vitest";
import { initialPadOn, padPlacement, stickDir } from "../src/client/ui/gamepad-logic";
import { combineDir } from "../src/client/game/input";
import { GESTURE_KEYS, TOUCH_CONTROL_GROUPS } from "../src/client/ui/tutorial-logic";
import { placeholderFor } from "../src/client/ui/chat-format";

describe("on-screen controller D-pad", () => {
  it("is still inside the dead zone", () => {
    expect(stickDir(0, 0, 10)).toEqual({ dx: 0, dy: 0 });
    expect(stickDir(6, -6, 10)).toEqual({ dx: 0, dy: 0 });
    expect(stickDir(Number.NaN, 3, 10)).toEqual({ dx: 0, dy: 0 });
  });

  it("walks straight when the thumb is a little off an axis", () => {
    expect(stickDir(50, 12, 10)).toEqual({ dx: 1, dy: 0 });
    expect(stickDir(-50, -12, 10)).toEqual({ dx: -1, dy: 0 });
    expect(stickDir(8, -50, 10)).toEqual({ dx: 0, dy: -1 });
    expect(stickDir(-8, 50, 10)).toEqual({ dx: 0, dy: 1 });
  });

  it("goes diagonally between the axes (screen y points down)", () => {
    expect(stickDir(40, 40, 10)).toEqual({ dx: 1, dy: 1 });
    expect(stickDir(-40, 40, 10)).toEqual({ dx: -1, dy: 1 });
    expect(stickDir(-40, -40, 10)).toEqual({ dx: -1, dy: -1 });
    expect(stickDir(40, -40, 10)).toEqual({ dx: 1, dy: -1 });
  });

  it("sits under the world on a portrait phone and in the corners otherwise", () => {
    expect(padPlacement(390, 664)).toBe("below");
    expect(padPlacement(750, 342)).toBe("sides");
    expect(padPlacement(1024, 1100)).toBe("sides");
  });

  it("starts off unless the player left it on, and survives blocked storage", () => {
    expect(initialPadOn(() => null)).toBe(false);
    expect(initialPadOn(() => "0")).toBe(false);
    expect(initialPadOn(() => "1")).toBe(true);
    expect(
      initialPadOn(() => {
        throw new Error("SecurityError");
      }),
    ).toBe(false);
  });
});

describe("keys and the pad together", () => {
  it("keys win while held", () => {
    expect(combineDir({ dx: 1, dy: 0 }, { dx: -1, dy: 1, dash: true })).toEqual({ dx: 1, dy: 0 });
  });

  it("the pad counts with no key held, Run included", () => {
    expect(combineDir({ dx: 0, dy: 0 }, { dx: -1, dy: 1 })).toEqual({ dx: -1, dy: 1 });
    expect(combineDir({ dx: 0, dy: 0 }, { dx: 0, dy: -1, dash: true })).toEqual({ dx: 0, dy: -1, dash: true });
    expect(combineDir({ dx: 0, dy: 0 }, { dx: 0, dy: 0, dash: true })).toEqual({ dx: 0, dy: 0 });
  });
});

describe("touch wording", () => {
  it("the touch controls card names the pad buttons and gestures", () => {
    const keys = TOUCH_CONTROL_GROUPS.flatMap((g) => g.rows.flatMap((r) => r.keys));
    for (const k of ["tap", "hold", "A", "B", "Q"]) expect(keys).toContain(k);
    for (const k of ["tap", "hold", "pad"]) expect(GESTURE_KEYS.has(k)).toBe(true);
    // No keyboard keys on a touch card.
    expect(keys).not.toContain("Space");
    expect(keys).not.toContain("Enter");
  });

  it("the chat box doesn't mention Enter on a touch screen", () => {
    expect(placeholderFor("all", false, true)).not.toMatch(/Enter/);
    expect(placeholderFor("world", false, true)).not.toMatch(/Enter/);
    expect(placeholderFor("all", false)).toMatch(/Enter/);
  });
});
