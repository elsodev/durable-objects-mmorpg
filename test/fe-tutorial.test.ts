import { describe, expect, it } from "vitest";
import { actionForCode, dirFromKeys, slotForCode } from "../src/client/game/input";
import { shortcutFor } from "../src/client/ui/hud-logic";
import { CONTROL_GROUPS, markTutorialSeen, tutorialKey, tutorialSeen, type KeyValueStore } from "../src/client/ui/tutorial-logic";

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

/** Key caps the card shows, with the text of their row. */
const shown = (key: string) =>
  CONTROL_GROUPS.flatMap((g) => g.rows)
    .filter((r) => r.keys.includes(key))
    .map((r) => r.text);

describe("tutorial seen flag", () => {
  it("is remembered per account", () => {
    const s = memory();
    expect(tutorialSeen(s, "u1")).toBe(false);
    markTutorialSeen(s, "u1");
    expect(tutorialSeen(s, "u1")).toBe(true);
    expect(tutorialSeen(s, "u2")).toBe(false);
    expect(s.data.get(tutorialKey("u1"))).toBe("1");
  });

  it("never throws when storage is blocked, and doesn't nag then", () => {
    const broken: KeyValueStore = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("QuotaExceeded");
      },
    };
    expect(tutorialSeen(broken, "u1")).toBe(true);
    expect(() => markTutorialSeen(broken, "u1")).not.toThrow();
    expect(tutorialSeen(null, "u1")).toBe(true);
  });
});

describe("tutorial matches the real key bindings", () => {
  const key = (k: string) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: null });

  it("movement keys", () => {
    expect(dirFromKeys(["KeyW"])).toEqual({ dx: 0, dy: -1 });
    expect(dirFromKeys(["KeyD"])).toEqual({ dx: 1, dy: 0 });
    expect(dirFromKeys(["ArrowLeft"])).toEqual({ dx: -1, dy: 0 });
    for (const k of ["W", "A", "S", "D"]) expect(shown(k).join()).toMatch(/Walk/);
  });

  it("tool, interact, gift and build keys", () => {
    expect(actionForCode("Space")).toBe("use");
    expect(actionForCode("KeyE")).toBe("use");
    expect(shown("Space").join()).toMatch(/E works too/);
    expect(actionForCode("KeyF")).toBe("interact");
    expect(shown("F").join()).toMatch(/Talk/);
    expect(actionForCode("KeyQ")).toBe("gift");
    expect(shown("Q").join()).toMatch(/gift/);
    expect(actionForCode("KeyB")).toBe("build");
    expect(actionForCode("KeyR")).toBe("rotate");
    expect(shown("B").join()).toMatch(/R rotates/);
    // T is edit mode (game/edit-mode.ts reads it itself), so it must not be a game action.
    expect(actionForCode("KeyT")).toBeNull();
    expect(shown("T").join()).toMatch(/Edit your house/);
    expect(actionForCode("Enter")).toBe("chat");
    expect(shown("Enter")).toEqual(["Chat"]);
    expect(actionForCode("Escape")).toBe("cancel");
    expect(shown("Esc").length).toBe(1);
  });

  it("hotbar and menu keys", () => {
    expect(slotForCode("Digit1")).toBe(0);
    expect(slotForCode("Digit8")).toBe(7);
    expect(slotForCode("Digit9")).toBeNull();
    expect(shown("1").length).toBe(1);
    expect(shown("8").length).toBe(1);
    expect(shortcutFor(key("i"), false)).toBe("inventory");
    expect(shortcutFor(key("g"), false)).toBe("goals");
    expect(shortcutFor(key("o"), false)).toBe("friends");
    expect(shown("I")).toEqual(["Bag"]);
    expect(shown("G")).toEqual(["Village goals"]);
    expect(shown("O")).toEqual(["Friends"]);
  });
});
