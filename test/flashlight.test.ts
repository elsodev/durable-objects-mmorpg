import { describe, expect, it } from "vitest";
import { FLASHLIGHT, hasFlashlight } from "../src/shared/flashlight";
import { getItem } from "../src/shared/items";
import { isHoldable } from "../src/shared/held";
import { MONSTER_STATS, rollMonsterDrops } from "../src/shared/engine/monsters";
import { CHEST_BONUS } from "../src/worker/game/chestField";
import { isRareDrop } from "../src/shared/engine/dropRate";
import { ambientLook, AMBIENT } from "../src/client/render/effects-sim";
import catalog from "../src/client/public/assets/lpc/catalog.json";

describe("flashlight", () => {
  it("is a rare carried tool, never swung or held in the hand", () => {
    const def = getItem(FLASHLIGHT)!;
    expect(def.kind).toBe("tool");
    expect(def.tool).toBeUndefined();
    expect(def.stack).toBe(1);
    expect(isRareDrop(FLASHLIGHT)).toBe(true);
    expect(isHoldable(FLASHLIGHT)).toBe(false);
    expect((catalog.icons as Record<string, unknown>)[FLASHLIGHT]).toBeTruthy();
  });

  it("counts from any bag slot, not just the hotbar", () => {
    const slots = Array.from({ length: 24 }, () => null) as ({ item: string; qty: number } | null)[];
    expect(hasFlashlight({ coins: 0, slots })).toBe(false);
    slots[20] = { item: FLASHLIGHT, qty: 1 };
    expect(hasFlashlight({ coins: 0, slots })).toBe(true);
    expect(hasFlashlight(null)).toBe(false);
  });

  it("drops rarely from every cave monster and from chests", () => {
    for (const m of Object.values(MONSTER_STATS)) {
      const d = m.drops.find((x) => x.item === FLASHLIGHT);
      expect(d?.chance).toBeGreaterThan(0);
      expect(d!.chance!).toBeLessThan(0.02);
    }
    expect(CHEST_BONUS.find((b) => b.item === FLASHLIGHT)?.chance).toBeGreaterThan(0);
    // A roll of 0 passes every chance check, so the flashlight is among the drops.
    expect(rollMonsterDrops("rock_crab", () => 0).some((d) => d.item === FLASHLIGHT)).toBe(true);
    expect(rollMonsterDrops("rock_crab", () => 0.999).some((d) => d.item === FLASHLIGHT)).toBe(false);
  });

  it("lights the whole cave and nothing else", () => {
    expect(ambientLook("cave", true)).toBe("caveLit");
    expect(ambientLook("cave", false)).toBe("cave");
    expect(ambientLook("day", true)).toBe("day");
    expect(ambientLook("indoor", true)).toBe("indoor");
    expect(AMBIENT.caveLit.light).toBe(0);
    expect(AMBIENT.caveLit.tint).toBeGreaterThan(AMBIENT.cave.tint);
  });
});
