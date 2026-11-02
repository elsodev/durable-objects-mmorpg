import { describe, expect, it } from "vitest";
import {
  ADOPT_PTS,
  adopt,
  adoptRefusal,
  bondWith,
  emptyAnimals,
  feedBond,
  heartsOf,
  MAX_ANIMAL_HEARTS,
  MAX_EGGS,
  MAX_PETS,
  petBond,
  sanitizeAnimals,
  VILLAGE_ANIMALS,
  villageAnimal,
} from "../src/shared/animals";
import { WORLD_DAY_MS } from "../src/shared/calendar";
import { adoptAnimal, feedAnimal, petAnimal } from "../src/worker/game/animalCare";
import type { Inventory } from "../src/shared/types";

const DAY = WORLD_DAY_MS;
const T0 = 1000 * DAY + 5000;

describe("affection", () => {
  it("counts one pet and one meal per world day", () => {
    const b = { pts: 0, petDay: 0, fedDay: 0 };
    expect(petBond(b, T0)).toEqual({ delta: 10, counted: true });
    expect(petBond(b, T0 + 1000)).toEqual({ delta: 0, counted: false });
    expect(petBond(b, T0 + DAY)).toEqual({ delta: 10, counted: true });
    expect(feedBond(b, "cat", "fish_trout", T0)).toEqual({ delta: 30, counted: true, taste: "loved" });
    expect(feedBond(b, "cat", "fish_trout", T0 + 1)?.delta).toBe(0);
    expect(b.pts).toBe(50);
  });

  it("knows what cats and dogs like, and refuses what isn't food", () => {
    const b = () => ({ pts: 0, petDay: 0, fedDay: 0 });
    expect(feedBond(b(), "dog", "pet_treat", T0)?.taste).toBe("loved");
    expect(feedBond(b(), "cat", "pet_treat", T0)?.taste).toBe("liked");
    expect(feedBond(b(), "dog", "egg", T0)?.taste).toBe("liked");
    expect(feedBond(b(), "cat", "turnip", T0)?.taste).toBe("ok");
    expect(feedBond(b(), "dog", "stone", T0)).toBeNull();
    expect(feedBond(b(), "cat", "hoe", T0)).toBeNull();
  });

  it("caps affection and turns it into hearts", () => {
    const b = { pts: 95, petDay: 0, fedDay: 0 };
    expect(petBond(b, T0).delta).toBe(5);
    expect(b.pts).toBe(100);
    expect(heartsOf(0)).toBe(0);
    expect(heartsOf(39)).toBe(1);
    expect(heartsOf(100)).toBe(MAX_ANIMAL_HEARTS);
  });

  it("reaches adoption in 3 to 5 days of daily care, depending on the food", () => {
    const b = { pts: 0, petDay: 0, fedDay: 0 };
    let days = 0;
    while (b.pts < ADOPT_PTS) {
      petBond(b, T0 + days * DAY);
      feedBond(b, "dog", "pet_treat", T0 + days * DAY);
      days++;
    }
    expect(days).toBe(3);
    const c = { pts: 0, petDay: 0, fedDay: 0 };
    days = 0;
    while (c.pts < ADOPT_PTS) {
      petBond(c, T0 + days * DAY);
      feedBond(c, "cat", "turnip", T0 + days * DAY);
      days++;
    }
    expect(days).toBe(5);
  });
});

describe("adoption", () => {
  it("needs full affection, once per animal, up to MAX_PETS", () => {
    const s = emptyAnimals();
    expect(adoptRefusal(s, "nobody")).toBe("unknown");
    bondWith(s, "mochi").pts = ADOPT_PTS - 1;
    expect(adoptRefusal(s, "mochi")).toBe("notYet");
    expect(adopt(s, "mochi")).toBe(false);
    bondWith(s, "mochi").pts = ADOPT_PTS;
    expect(adoptRefusal(s, "mochi")).toBeNull();
    expect(adopt(s, "mochi")).toBe(true);
    expect(adoptRefusal(s, "mochi")).toBe("already");
    expect(s.pets).toEqual(["mochi"]);
    expect(MAX_PETS).toBe(VILLAGE_ANIMALS.length);
  });

  it("adopting gives a copy: the village animal is still there for others", () => {
    const mine = emptyAnimals();
    const theirs = emptyAnimals();
    bondWith(mine, "biscuit").pts = ADOPT_PTS;
    const r = adoptAnimal(mine, villageAnimal("biscuit")!, "a:biscuit", T0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.view.adopted).toBe(true);
    expect(adoptRefusal(theirs, "biscuit")).toBe("notYet");
    expect(adoptAnimal(theirs, villageAnimal("biscuit")!, "a:biscuit", T0)).toMatchObject({ ok: false });
  });
});

describe("care with the bag", () => {
  const def = villageAnimal("pepper")!;
  it("feeding takes exactly one item, and nothing when refused", () => {
    const inv: Inventory = { coins: 0, slots: [{ item: "fish_trout", qty: 2 }, { item: "stone", qty: 3 }] };
    const s = emptyAnimals();
    const ok = feedAnimal(s, inv, 0, def, "a:pepper", T0);
    expect(ok).toMatchObject({ ok: true, delta: 30 });
    expect(inv.slots[0]).toEqual({ item: "fish_trout", qty: 1 });
    expect(feedAnimal(s, inv, 1, def, "a:pepper", T0)).toMatchObject({ ok: false });
    expect(inv.slots[1]).toEqual({ item: "stone", qty: 3 });
    expect(feedAnimal(s, inv, 5, def, "a:pepper", T0)).toMatchObject({ ok: false });
  });

  it("petting always succeeds; the card reports today's care", () => {
    const s = emptyAnimals();
    const r = petAnimal(s, def, "a:pepper", T0);
    expect(r).toMatchObject({ ok: true, delta: 10 });
    if (r.ok) expect(r.view).toMatchObject({ pettedToday: true, fedToday: false, hearts: 0, maxHearts: 5, canAdopt: false });
    expect(petAnimal(s, def, "a:pepper", T0 + 10)).toMatchObject({ ok: true, delta: 0 });
  });
});

describe("sanitizeAnimals", () => {
  it("survives junk and drops unknown or out-of-range entries", () => {
    expect(sanitizeAnimals(null)).toEqual(emptyAnimals());
    expect(sanitizeAnimals([1, 2])).toEqual(emptyAnimals());
    const s = sanitizeAnimals({
      bonds: { mochi: { pts: 999, petDay: 3, fedDay: "x" }, ghost: { pts: 5 } },
      pets: ["mochi", "mochi", "ghost"],
      barn: "yes",
      chickens: [{ id: "hen_1", sprite: "chicken_white", day: 2, laid: 0, petDay: 0 }, { id: "<b>", sprite: "chicken_white" }, { id: "hen_2", sprite: "dragon" }],
      eggs: Array.from({ length: 40 }, (_, i) => ({ id: `egg_${i}`, x: 5, y: 5 })),
      seq: -4,
    });
    expect(s.bonds).toEqual({ mochi: { pts: 0, petDay: 3, fedDay: 0 } });
    expect(s.pets).toEqual(["mochi"]);
    expect(s.barn).toBe(false);
    expect(s.chickens.map((c) => c.id)).toEqual(["hen_1"]);
    expect(s.eggs.length).toBe(MAX_EGGS);
    expect(s.seq).toBe(0);
  });
});
