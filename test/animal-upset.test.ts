import { describe, expect, it } from "vitest";
import { getMap } from "../src/shared/maps";
import { buildCollision, setBlocked, type CollisionGrid } from "../src/shared/engine";
import { animalGrid, FLEE_MIN, pickFlee, RUN_ACT, WARY_MS } from "../src/shared/engine/animals";
import { mulberry32 } from "../src/shared/maps/rng";
import { emptyAnimals, heartsOf, HEART_PTS, MAX_AFFECTION, newAnimalBond, VILLAGE_ANIMALS, villageAnimal } from "../src/shared/animals";
import { HIT_COOLDOWN_MS, HIT_PTS, HitCooldown, hurtBond, upsetEmote, upsetLine } from "../src/shared/animalUpset";
import { swordAnimal, swordHen } from "../src/worker/game/animalCare";
import { AnimalHerd } from "../src/worker/game/animalHerd";
import { animalLoveSfx } from "../src/client/audio/audio-logic";
import { swingsAtAnimals } from "../src/client/game/actions";
import { starterInventory } from "../src/shared/items";
import { BUBBLES, EMOTES, isEmote } from "../src/shared/emotes";
import { EMOTE_PIXELS, emotePixelProblems } from "../src/client/art/emote-pixels";
import type { Vec2 } from "../src/shared/types";

function openGrid(w = 40, h = 40): CollisionGrid {
  const g: CollisionGrid = { width: w, height: h, cells: new Uint8Array(w * h) };
  // A wall round the edge, like a map's border.
  setBlocked(g, 0, 0, w, 1, true);
  setBlocked(g, 0, h - 1, w, 1, true);
  setBlocked(g, 0, 0, 1, h, true);
  setBlocked(g, w - 1, 0, 1, h, true);
  return g;
}

const end = (path: Vec2[]): Vec2 => path[path.length - 1]!;
const d = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

describe("hurtBond", () => {
  it("takes one heart per hit", () => {
    expect(HIT_PTS).toBe(HEART_PTS);
    const b = { ...newAnimalBond(), pts: 60 };
    const r = hurtBond(b);
    expect(r).toEqual({ delta: -20, before: 60, after: 40 });
    expect(b.pts).toBe(40);
    expect(heartsOf(b.pts)).toBe(heartsOf(60) - 1);
  });

  it("never goes below zero", () => {
    const b = { ...newAnimalBond(), pts: 7 };
    expect(hurtBond(b)).toEqual({ delta: -7, before: 7, after: 0 });
    expect(hurtBond(b)).toEqual({ delta: 0, before: 0, after: 0 });
    expect(b.pts).toBe(0);
  });

  it("leaves today's pet and meal alone, and clamps a bad value", () => {
    const b = { pts: MAX_AFFECTION + 50, petDay: 9, fedDay: 9 };
    hurtBond(b, HIT_PTS);
    expect(b).toEqual({ pts: MAX_AFFECTION - HIT_PTS, petDay: 9, fedDay: 9 });
    expect(hurtBond(b, -10).delta).toBe(0);
  });
});

describe("swordAnimal", () => {
  it("lowers the bond in the save and says who is upset", () => {
    const save = emptyAnimals();
    save.bonds.biscuit = { pts: 45, petDay: 0, fedDay: 0 };
    const out = swordAnimal(save, villageAnimal("biscuit")!, "a:biscuit", 0);
    expect(out.delta).toBe(-20);
    expect(save.bonds.biscuit!.pts).toBe(25);
    expect(out.view.pts).toBe(25);
    expect(out.view.hearts).toBe(1);
    expect(out.emote).toBe("angry");
    expect(out.text).toBe("Biscuit is upset with you.");
  });

  it("frightens cats and hens instead", () => {
    const save = emptyAnimals();
    const cat = swordAnimal(save, villageAnimal("mochi")!, "a:mochi", 0);
    expect(cat.emote).toBe("scared");
    expect(cat.delta).toBe(0);
    expect(cat.text).toBe("Mochi is scared of you.");
    const hen = swordHen({ id: "h1", sprite: "chicken_white", day: 1, laid: 0, petDay: 0 }, "a:hen_h1", 0);
    expect(hen.emote).toBe("scared");
    expect(hen.delta).toBe(0);
  });

  it("picks a temper per species", () => {
    expect(upsetEmote("dog")).toBe("angry");
    expect(upsetEmote("cat")).toBe("scared");
    expect(upsetEmote("chicken")).toBe("scared");
    expect(upsetLine("Patch", "angry")).toBe("Patch is upset with you.");
  });
});

describe("HitCooldown", () => {
  it("counts one hit per key per cooldown", () => {
    const c = new HitCooldown();
    expect(c.allow("u1:a:mochi", 1000)).toBe(true);
    expect(c.allow("u1:a:mochi", 1000 + HIT_COOLDOWN_MS - 1)).toBe(false);
    // Another player, or another animal, isn't held up.
    expect(c.allow("u2:a:mochi", 1500)).toBe(true);
    expect(c.allow("u1:a:pepper", 1500)).toBe(true);
    expect(c.allow("u1:a:mochi", 1000 + HIT_COOLDOWN_MS)).toBe(true);
  });

  it("spam-swinging for ten seconds costs at most three hearts", () => {
    const c = new HitCooldown();
    const b = { ...newAnimalBond(), pts: MAX_AFFECTION };
    for (let t = 0; t < 10_000; t += 250) if (c.allow("u:a", t)) hurtBond(b);
    expect(b.pts).toBe(MAX_AFFECTION - 3 * HIT_PTS);
  });

  it("forgets stale keys so the map stays small", () => {
    const c = new HitCooldown(100);
    for (let i = 0; i < 1000; i++) c.allow(`k${i}`, i * 200);
    expect((c as unknown as { last: Map<string, number> }).last.size).toBeLessThan(300);
  });
});

describe("pickFlee", () => {
  it("runs away from the attacker, whichever side they swing from", () => {
    const grid = openGrid();
    const at = { x: 20.5, y: 20.5 };
    for (const from of [
      { x: 19.5, y: 20.5 },
      { x: 21.5, y: 20.5 },
      { x: 20.5, y: 19.2 },
      { x: 20.5, y: 21.8 },
      { x: 19.4, y: 19.4 },
    ]) {
      for (let seed = 1; seed <= 20; seed++) {
        const path = pickFlee(at, from, grid, mulberry32(seed));
        expect(path).not.toBeNull();
        const t = end(path!);
        expect(d(t, from)).toBeGreaterThan(d(at, from) + 2);
        // Within a right angle of straight away from the attacker: never past them.
        const ax = at.x - from.x;
        const ay = at.y - from.y;
        expect((t.x - at.x) * ax + (t.y - at.y) * ay).toBeGreaterThan(0);
      }
    }
  });

  it("goes a good way when there is room", () => {
    const grid = openGrid();
    const path = pickFlee({ x: 20.5, y: 20.5 }, { x: 19.5, y: 20.5 }, grid, mulberry32(3))!;
    expect(d(end(path), { x: 20.5, y: 20.5 })).toBeGreaterThanOrEqual(FLEE_MIN - 1);
  });

  it("cornered against a wall it slips sideways, still not toward the attacker", () => {
    const grid = openGrid();
    const at = { x: 37.5, y: 20.5 };
    const from = { x: 36.5, y: 20.5 };
    for (let seed = 1; seed <= 10; seed++) {
      const path = pickFlee(at, from, grid, mulberry32(seed));
      if (!path) continue;
      expect(d(end(path), from)).toBeGreaterThan(d(at, from));
    }
  });

  it("works on the real village grid for every village animal", () => {
    const village = getMap("village");
    const grid = animalGrid(buildCollision(village), village.exits);
    for (const a of VILLAGE_ANIMALS) {
      const from = { x: a.home.x - 1, y: a.home.y };
      const path = pickFlee(a.home, from, grid, mulberry32(a.id.length));
      if (!path) continue;
      expect(d(end(path), from), a.id).toBeGreaterThan(d(a.home, from));
    }
  });
});

describe("AnimalHerd.flee and inArc", () => {
  it("only animals in front of the swing are in the arc, and a flee sprints then settles", () => {
    const grid = openGrid();
    const herd = new AnimalHerd(() => grid, [], mulberry32(5));
    herd.add({ id: "biscuit", name: "Biscuit", sprite: "dog_golden", species: "dog", home: { x: 20.5, y: 20.5 }, radius: 3 }, 0);
    const dog = herd.get("a:biscuit")!.entity;
    dog.x = 20.5;
    dog.y = 20.5;
    const me = { x: 19.3, y: 20.5 };
    expect(herd.inArc(me, "right").map((a) => a.entity.id)).toEqual(["a:biscuit"]);
    expect(herd.inArc(me, "left")).toEqual([]);
    expect(herd.inArc({ x: 10, y: 10 }, "right")).toEqual([]);

    expect(herd.flee("a:biscuit", me, 0)).toBe(true);
    expect(dog.act?.k).toBe(RUN_ACT);
    const start = d(dog, me);
    let now = 0;
    for (; now < 6000 && dog.act?.k === RUN_ACT; now += 100) herd.tick(100, now);
    expect(dog.act?.k).not.toBe(RUN_ACT);
    // A few seconds of running, well away from the swinger.
    expect(now).toBeGreaterThanOrEqual(1000);
    expect(d(dog, me)).toBeGreaterThan(start + 3);
    // Alert until the fright wears off: no nap, rest or stroll back toward the swinger.
    const stop = { x: dog.x, y: dog.y };
    for (; now < WARY_MS; now += 100) {
      herd.tick(100, now);
      expect(dog.act).toBeUndefined();
      expect(dog).toMatchObject(stop);
    }
    // Then back to ordinary wandering near home.
    for (; now < 120_000; now += 100) herd.tick(100, now);
    expect(d(dog, { x: 20.5, y: 20.5 })).toBeLessThanOrEqual(3.5);
  });

  it("a flee step never stands in a wall", () => {
    const grid = openGrid(12, 12);
    const m = new AnimalHerd(() => grid, [], mulberry32(9));
    const e = m.add({ id: "mochi", name: "Mochi", sprite: "cat_ginger", species: "cat", home: { x: 9.5, y: 6.5 }, radius: 2 }, 0);
    e.x = 9.5;
    e.y = 6.5;
    m.flee(e.id, { x: 8.5, y: 6.5 }, 0);
    for (let now = 0; now < 4000; now += 100) {
      m.tick(100, now);
      expect(e.x).toBeGreaterThan(1);
      expect(e.x).toBeLessThan(11);
    }
  });
});

describe("the upset bubble and sound", () => {
  it("scared is a server-only bubble with its own pixel art", () => {
    expect(BUBBLES).toContain("scared");
    expect(EMOTES as readonly string[]).not.toContain("scared");
    expect(isEmote("scared")).toBe(false);
    expect(EMOTE_PIXELS.scared).toHaveLength(12);
    expect(emotePixelProblems()).toEqual([]);
  });

  it("dogs bark crossly, cats meow and hens cluck in fright", () => {
    expect(animalLoveSfx("dog_golden", "angry")).toBe("dog_bark");
    expect(animalLoveSfx("dog_husky", "angry")).toBe("dog_bark");
    expect(animalLoveSfx("cat_ginger", "scared")).toBe("cat_meow");
    expect(animalLoveSfx("chicken_white", "scared")).toBe("hen_cluck");
    expect(animalLoveSfx("slime", "angry")).toBeNull();
  });
});

describe("clicking an animal", () => {
  it("swings with a sword in hand, pets with anything else", () => {
    const inv = starterInventory();
    const sword = inv.slots.findIndex((x) => x?.item === "sword_wood");
    const hoe = inv.slots.findIndex((x) => x?.item === "hoe");
    expect(swingsAtAnimals(inv, sword)).toBe(true);
    expect(swingsAtAnimals(inv, hoe)).toBe(false);
    expect(swingsAtAnimals(inv, 7)).toBe(false);
  });
});
