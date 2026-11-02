import { describe, expect, it } from "vitest";
import {
  counterAhead,
  counterOrderRefusal,
  MEAL_MS,
  mealOver,
  mealStage,
  PLATE_LINGER_MS,
  seatedAtCounter,
  serveMeal,
  serveRefusal,
} from "../src/shared/counterMeal";
import { getMap } from "../src/shared/maps";
import { deriveSeats } from "../src/shared/maps/interiors/rules";
import type { EntityState } from "../src/shared/types";
import { BITE_CYCLE_MS, leanOffset, mealBitesAt, mealBitesBetween, mealMotion } from "../src/client/render/counter-meal-logic";

const inn = getMap("int_inn");
const seats = deriveSeats(inn);
const stools = seats.filter((s) => inn.props.find((p) => p.id === s.id)?.type === "bar_stool");
const chairs = seats.filter((s) => inn.props.find((p) => p.id === s.id)?.type !== "bar_stool");
const sitting: Pick<EntityState, "act" | "meal"> = { act: { k: "sit", at: 0 } };

describe("counter seats", () => {
  it("every inn bar stool faces a bar counter, and no dining chair does", () => {
    expect(stools.length).toBeGreaterThanOrEqual(3);
    for (const s of stools) expect(counterAhead(s, inn.props)?.type, s.id).toBe("bar_counter");
    for (const c of chairs) expect(counterAhead(c, inn.props), c.id).toBeNull();
  });

  it("only someone sitting on a stool at that very counter is seated at it", () => {
    const stool = stools[0]!;
    const counter = counterAhead(stool, inn.props)!;
    const other = inn.props.find((p) => p.type === "bar_counter" && p.id !== counter.id)!;
    expect(seatedAtCounter(stool, sitting, counter.id, inn.props)).toBe(true);
    // Standing (no seat, or not in the sit act) doesn't count.
    expect(seatedAtCounter(undefined, sitting, counter.id, inn.props)).toBe(false);
    expect(seatedAtCounter(stool, {}, counter.id, inn.props)).toBe(false);
    expect(seatedAtCounter(stool, { act: { k: "eat", at: 0 } }, counter.id, inn.props)).toBe(false);
    // A stool at the other counter, or a dining chair, isn't at this one.
    expect(seatedAtCounter(stool, sitting, other.id, inn.props)).toBe(false);
    expect(seatedAtCounter(chairs[0]!, sitting, counter.id, inn.props)).toBe(false);
  });

  it("serves a plate onto the counter tile in front of the stool, not anywhere else", () => {
    const stool = stools[0]!;
    const meal = serveMeal(stool, inn.props, "inn_stew", 1000)!;
    expect(meal).toEqual({ item: "inn_stew", at: 1000, x: stool.x + 0.5, y: stool.y - 1 + 0.5, seat: stool.id });
    const counter = counterAhead(stool, inn.props)!;
    expect(meal.x).toBeGreaterThanOrEqual(counter.x);
    expect(meal.x).toBeLessThan(counter.x + counter.w);
    expect(Math.floor(meal.y)).toBe(counter.y);
    expect(serveMeal(chairs[0]!, inn.props, "inn_stew", 1000)).toBeNull();
  });

  it("the counter in front of each stool is clear of tabletop clutter, so the plate shows", () => {
    for (const s of stools) {
      const m = serveMeal(s, inn.props, "inn_stew", 0)!;
      const clutter = inn.props.filter((p) => p.walkable && p.x === Math.floor(m.x) && p.y === Math.floor(m.y));
      expect(clutter, s.id).toEqual([]);
    }
  });

  it("refuses a second plate until the first is eaten and cleared, and anyone standing", () => {
    expect(serveRefusal({}, 0)).toMatch(/sit/i);
    expect(serveRefusal(sitting, 0)).toBeNull();
    const meal = serveMeal(stools[0]!, inn.props, "inn_stew", 1000)!;
    expect(serveRefusal({ ...sitting, meal }, 1000 + MEAL_MS)).toMatch(/finish/i);
    expect(mealOver(meal, 1000 + MEAL_MS + PLATE_LINGER_MS - 1)).toBe(false);
    expect(mealOver(meal, 1000 + MEAL_MS + PLATE_LINGER_MS)).toBe(true);
    expect(serveRefusal({ ...sitting, meal }, 1000 + MEAL_MS + PLATE_LINGER_MS)).toBeNull();
  });

  it("the meal's stages: eating, then the empty plate lingers, then it's gone", () => {
    expect(mealStage(0)).toEqual({ eating: true, bites: 0, shown: true });
    expect(mealStage(MEAL_MS - 1).eating).toBe(true);
    expect(mealStage(MEAL_MS)).toEqual({ eating: false, bites: 3, shown: true });
    expect(mealStage(MEAL_MS + PLATE_LINGER_MS).shown).toBe(false);
    expect(mealStage(Number.NaN).shown).toBe(false);
  });
});

describe("eating at the counter (client timeline)", () => {
  it("takes one bite per cycle, all within the server's meal time", () => {
    expect(mealBitesAt(0)).toBe(0);
    expect(mealBitesAt(BITE_CYCLE_MS)).toBe(1);
    expect(mealBitesAt(MEAL_MS)).toBe(3);
    expect(mealBitesAt(MEAL_MS * 5)).toBe(3);
    expect(mealBitesBetween(-1, MEAL_MS)).toBe(3);
    expect(mealBitesBetween(BITE_CYCLE_MS, BITE_CYCLE_MS + 1)).toBe(0);
  });

  it("leans in and lifts a morsel to the mouth before each bite, then sits back", () => {
    const reach = mealMotion(BITE_CYCLE_MS * 0.2);
    expect(reach.lean).toBeGreaterThan(0);
    expect(reach.morsel).toBeGreaterThan(0);
    expect(reach.morsel).toBeLessThan(1);
    const atMouth = mealMotion(BITE_CYCLE_MS * 0.4);
    expect(atMouth.lean).toBe(1);
    const chew = mealMotion(BITE_CYCLE_MS * 0.9);
    expect(chew.lean).toBe(0);
    expect(chew.morsel).toBeNull();
    expect(mealMotion(MEAL_MS + 1)).toMatchObject({ eating: false, lean: 0, morsel: null, bites: 3 });
  });

  it("leans toward the counter the seat faces", () => {
    expect(leanOffset("up", 1)).toEqual({ dx: 0, dy: -3 });
    expect(leanOffset("down", 0.5)).toEqual({ dx: 0, dy: 1.5 });
    expect(leanOffset("left", 1).dx).toBeLessThan(0);
    expect(leanOffset("right", 1).dx).toBeGreaterThan(0);
  });
});

describe("ordering from a stool", () => {
  it("is refused, before any coins are taken, when it couldn't be eaten now", () => {
    const meal = serveMeal(stools[0]!, inn.props, "inn_stew", 1000)!;
    expect(counterOrderRefusal({}, 5000, -Infinity, 40)).toMatch(/sit/i);
    expect(counterOrderRefusal({ ...sitting, meal }, 1500, -Infinity, 40)).toMatch(/finish/i);
    expect(counterOrderRefusal(sitting, 1500, 1000, 40)).toMatch(/chewing/i);
    expect(counterOrderRefusal(sitting, 50_000, 1000, 0)).toMatch(/hungry/i);
    expect(counterOrderRefusal(sitting, 50_000, 1000, 40)).toBeNull();
  });
});
