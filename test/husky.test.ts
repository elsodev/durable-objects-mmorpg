import { describe, expect, it } from "vitest";
import { adoptRefusal, bondWith, emptyAnimals, FEED_PTS, feedPtsOf, PET_PTS, petPtsOf, sanitizeAnimals, VILLAGE_ANIMALS, villageAnimal } from "../src/shared/animals";
import { WORLD_DAY_MS } from "../src/shared/calendar";
import { buildCollision, canStand } from "../src/shared/engine";
import { ANIMAL_SPEED, animalGrid, animalStart, newAnimalMind, pickRunAway, RUN_ACT, RUN_MAX, RUN_MIN, RUN_SPEED, stepAnimal } from "../src/shared/engine/animals";
import { getMap } from "../src/shared/maps";
import { mulberry32 } from "../src/shared/maps/rng";
import { boltLine, rollsAway, rollsSnatch } from "../src/shared/mischief";
import { ROAM_HAUNTS, ROAM_SLOT_MS, roamZoneAt, zoneAnimals, zoneHasAnimals } from "../src/shared/roam";
import { SHARED_ZONES, type EntityState, type Inventory, type SharedZoneId } from "../src/shared/types";
import { AnimalHerd } from "../src/worker/game/animalHerd";
import { adoptAnimal, feedAnimal, petAnimal } from "../src/worker/game/animalCare";
import { syncZoneHerd } from "../src/worker/game/zoneHerd";
import { yardAnimals } from "../src/worker/home/ranch";

const DAY = WORLD_DAY_MS;
const T0 = 1000 * DAY + 5000;
const happy = villageAnimal("happy")!;
const fixed = (v: number) => () => v;

describe("Happy the husky: mischief", () => {
  it("is a dog with a husky sprite, and the only mischievous animal", () => {
    expect(happy).toMatchObject({ name: "Happy", species: "dog", sprite: "dog_husky" });
    expect(VILLAGE_ANIMALS.filter((a) => a.mischief).map((a) => a.id)).toEqual(["happy"]);
  });

  it("bolts on a roll under 0.8 in the village and under 0.3 at home", () => {
    expect(rollsAway(happy, false, fixed(0))).toBe(true);
    expect(rollsAway(happy, false, fixed(0.79))).toBe(true);
    expect(rollsAway(happy, false, fixed(0.8))).toBe(false);
    expect(rollsAway(happy, true, fixed(0.29))).toBe(true);
    expect(rollsAway(happy, true, fixed(0.3))).toBe(false);
    // Nobody else ever bolts or snatches.
    for (const a of VILLAGE_ANIMALS.filter((x) => x.id !== "happy")) {
      expect(rollsAway(a, false, fixed(0))).toBe(false);
      expect(rollsSnatch(a, false, fixed(0))).toBe(false);
    }
  });

  it("runs away from about 80% of pets over many tries", () => {
    const rand = mulberry32(42);
    let ran = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) if (rollsAway(happy, false, rand)) ran++;
    expect(ran / N).toBeGreaterThan(0.78);
    expect(ran / N).toBeLessThan(0.82);
  });

  it("a getaway gives no affection and leaves today's pet to try again", () => {
    const s = emptyAnimals();
    const r = petAnimal(s, happy, "a:happy", T0, false, fixed(0.5));
    expect(r).toMatchObject({ ok: true, delta: 0, ran: true });
    expect(r.ok && r.text).toContain("Happy");
    expect(s.bonds.happy?.pts ?? 0).toBe(0);
    expect(s.bonds.happy?.petDay ?? 0).toBe(0);
    // Caught him: the 20% pet counts, at Happy's lower rate.
    const ok = petAnimal(s, happy, "a:happy", T0 + 1000, false, fixed(0.9));
    expect(ok).toMatchObject({ ok: true, delta: 5 });
    expect(ok.ok && ok.ran).toBeFalsy();
    expect(petAnimal(s, happy, "a:happy", T0 + 2000, false, fixed(0.9))).toMatchObject({ ok: true, delta: 0 });
  });

  it("is the hardest dog to befriend: less per pet and per meal than any other", () => {
    for (const d of VILLAGE_ANIMALS.filter((a) => a.species === "dog" && a.id !== "happy")) {
      expect(petPtsOf(happy)).toBeLessThan(petPtsOf(d));
      for (const t of ["loved", "liked", "ok"] as const) expect(feedPtsOf(happy)[t]).toBeLessThan(feedPtsOf(d)[t]);
    }
    expect(petPtsOf(happy)).toBeLessThan(PET_PTS);
    expect(feedPtsOf(happy).loved).toBeLessThan(FEED_PTS.loved);
  });

  it("a snatched meal is used up and still counts, at Happy's rate", () => {
    const s = emptyAnimals();
    const inv: Inventory = { slots: [{ item: "pet_treat", qty: 2 }, null, null] } as Inventory;
    const r = feedAnimal(s, inv, 0, happy, "a:happy", T0, false, fixed(0.1));
    expect(r).toMatchObject({ ok: true, delta: 15, ran: true });
    expect(inv.slots[0]?.qty).toBe(1);
    const calm = feedAnimal(s, inv, 0, happy, "a:happy", T0 + DAY, false, fixed(0.9));
    expect(calm).toMatchObject({ ok: true, delta: 15 });
    expect(calm.ok && calm.ran).toBeFalsy();
  });

  it("picks a getaway line from the roll", () => {
    expect(boltLine("Happy", 0)).toBe("Happy bolts off with a cheeky yip!");
    expect(boltLine("Happy", 0.999)).toMatch(/^Happy /);
  });
});

describe("Happy the husky: adoption", () => {
  it("adopts at full hearts and then roams your yard", () => {
    const s = emptyAnimals();
    expect(adoptRefusal(s, "happy")).toBe("notYet");
    bondWith(s, "happy").pts = 100;
    expect(adoptAnimal(s, happy, "a:happy", T0)).toMatchObject({ ok: true });
    expect(s.pets).toEqual(["happy"]);
    expect(sanitizeAnimals(JSON.parse(JSON.stringify(s))).pets).toEqual(["happy"]);
    const yard = yardAnimals(s, null);
    expect(yard).toEqual([expect.objectContaining({ id: "pet_happy", name: "Happy", sprite: "dog_husky", species: "dog" })]);
  });

  it("an adopted Happy still bolts sometimes at home, but less", () => {
    const rand = mulberry32(7);
    let ran = 0;
    for (let i = 0; i < 5000; i++) if (rollsAway(happy, true, rand)) ran++;
    expect(ran / 5000).toBeGreaterThan(0.27);
    expect(ran / 5000).toBeLessThan(0.33);
  });
});

describe("Happy the husky: roaming", () => {
  const slots = Array.from({ length: 2000 }, (_, i) => i * ROAM_SLOT_MS + T0);

  it("is in exactly one zone at a time, the same answer every time", () => {
    for (const t of slots) {
      const where = SHARED_ZONES.filter((z) => zoneAnimals(z, t).some((a) => a.id === "happy"));
      expect(where.length).toBe(1);
      expect(where[0]).toBe(roamZoneAt(happy, t));
      expect(roamZoneAt(happy, t)).toBe(roamZoneAt(happy, t));
    }
  });

  it("stays put within a slot and visits both the village and the quarry", () => {
    const base = Math.floor(T0 / ROAM_SLOT_MS) * ROAM_SLOT_MS;
    const z = roamZoneAt(happy, base);
    for (let dt = 0; dt < ROAM_SLOT_MS; dt += 60_000) expect(roamZoneAt(happy, base + dt)).toBe(z);
    const seen = slots.map((t) => roamZoneAt(happy, t));
    const village = seen.filter((z) => z === "village").length / seen.length;
    expect(new Set(seen)).toEqual(new Set(["village", "quarry"]));
    expect(village).toBeGreaterThan(0.5);
    expect(village).toBeLessThan(0.7);
    // Not a strict back-and-forth: sometimes two slots in a row in the same place.
    expect(seen.some((z, i) => i > 0 && seen[i - 1] === z)).toBe(true);
  });

  it("keeps the regulars in the village and nobody in other zones", () => {
    for (const t of slots.slice(0, 50)) {
      const v = zoneAnimals("village", t).map((a) => a.id);
      for (const id of ["mochi", "pepper", "biscuit", "patch"]) expect(v).toContain(id);
      expect(zoneAnimals("quarry", t).every((a) => a.id === "happy")).toBe(true);
      expect(zoneAnimals("riverside", t)).toEqual([]);
    }
    expect(zoneHasAnimals("village") && zoneHasAnimals("quarry")).toBe(true);
    expect(zoneHasAnimals("riverside") || zoneHasAnimals("caves")).toBe(false);
  });

  it("each haunt has a standable home and wide room to roam", () => {
    for (const [zone, h] of Object.entries(ROAM_HAUNTS) as [SharedZoneId, { home: { x: number; y: number }; radius: number }][]) {
      const map = getMap(zone);
      const grid = animalGrid(buildCollision(map), map.exits);
      expect(canStand(grid, h.home.x, h.home.y), zone).toBe(true);
      expect(h.radius, zone).toBeGreaterThanOrEqual(10);
    }
  });

  it("the herd follows the clock and says when Happy comes and goes", () => {
    const map = getMap("quarry");
    const grid = buildCollision(map);
    const herd = new AnimalHerd(() => grid, map.exits, mulberry32(3));
    const inQuarry = slots.find((t) => roamZoneAt(happy, t) === "quarry")!;
    const away = [inQuarry + ROAM_SLOT_MS, inQuarry + 2 * ROAM_SLOT_MS, inQuarry + 3 * ROAM_SLOT_MS].find((t) => roamZoneAt(happy, t) === "village")!;
    expect(syncZoneHerd(herd, "quarry", inQuarry, false)).toEqual([]);
    expect(herd.get("a:happy")).toBeDefined();
    expect(syncZoneHerd(herd, "quarry", inQuarry + 1000)).toEqual([]);
    expect(syncZoneHerd(herd, "quarry", away)).toEqual(["Happy trots off toward the village."]);
    expect(herd.size).toBe(0);
    expect(syncZoneHerd(herd, "quarry", inQuarry)).toEqual(["Happy bounds in from the village!"]);
  });
});

describe("Happy the husky: getaways", () => {
  for (const zone of ["village", "quarry"] as const) {
    it(`always runs to a walkable spot in bounds, away from you (${zone})`, () => {
      const map = getMap(zone);
      const base = buildCollision(map);
      const grid = animalGrid(base, map.exits);
      const h = ROAM_HAUNTS[zone]!;
      const rand = mulberry32(99);
      let tries = 0;
      let away = 0;
      for (let i = 0; i < 300; i++) {
        const at = animalStart({ x: Math.floor(h.home.x + (rand() - 0.5) * 2 * h.radius) + 0.5, y: Math.floor(h.home.y + (rand() - 0.5) * 2 * h.radius) + 0.5 }, grid);
        if (!canStand(grid, at.x, at.y)) continue;
        const from = { x: at.x + (rand() - 0.5) * 3, y: at.y + (rand() - 0.5) * 3 };
        const path = pickRunAway(at, from, grid, rand);
        if (!path) continue;
        tries++;
        const end = path[path.length - 1]!;
        expect(end.x).toBeGreaterThan(0);
        expect(end.y).toBeGreaterThan(0);
        expect(end.x).toBeLessThan(map.width);
        expect(end.y).toBeLessThan(map.height);
        for (const p of path) expect(canStand(grid, p.x, p.y), `${zone} ${p.x},${p.y}`).toBe(true);
        const d = Math.hypot(end.x - at.x, end.y - at.y);
        expect(d).toBeGreaterThanOrEqual(RUN_MIN - 1);
        expect(d).toBeLessThanOrEqual(RUN_MAX + 1);
        if (Math.hypot(end.x - from.x, end.y - from.y) > Math.hypot(at.x - from.x, at.y - from.y)) away++;
      }
      expect(tries).toBeGreaterThan(200);
      expect(away / tries).toBeGreaterThan(0.8);
    });
  }

  it("sprints faster than a walk, shows the run act, then settles", () => {
    const map = getMap("village");
    const grid = buildCollision(map);
    const herd = new AnimalHerd(() => grid, map.exits, mulberry32(5));
    const h = ROAM_HAUNTS.village!;
    herd.add({ id: "happy", name: "Happy", sprite: "dog_husky", species: "dog", home: h.home, radius: h.radius }, 0);
    const a = herd.get("a:happy")!;
    const me = { x: a.entity.x + 1, y: a.entity.y };
    expect(herd.runAway("a:happy", me, 0)).toBe(true);
    expect(a.entity.act?.k).toBe(RUN_ACT);
    let fastest = 0;
    let now = 0;
    const g = animalGrid(grid, map.exits);
    while (a.entity.act?.k === RUN_ACT && now < 10_000) {
      const before = { x: a.entity.x, y: a.entity.y };
      now += 100;
      herd.tick(100, now);
      fastest = Math.max(fastest, Math.hypot(a.entity.x - before.x, a.entity.y - before.y) * 10);
      expect(canStand(g, a.entity.x, a.entity.y)).toBe(true);
    }
    expect(a.entity.act?.k).not.toBe(RUN_ACT);
    expect(fastest).toBeGreaterThan(ANIMAL_SPEED.dog * 1.5);
    expect(fastest).toBeLessThanOrEqual(RUN_SPEED + 1e-6);
    expect(Math.hypot(a.entity.x - me.x, a.entity.y - me.y)).toBeGreaterThan(RUN_MIN - 2);
  });

  it("a plain wander after a getaway is back at walking pace", () => {
    const map = getMap("village");
    const grid = animalGrid(buildCollision(map), map.exits);
    const h = ROAM_HAUNTS.village!;
    const at = animalStart(h.home, grid);
    const e: EntityState = { id: "a:happy", kind: "animal", name: "Happy", sprite: "dog_husky", x: at.x, y: at.y, facing: "down", moving: false };
    const rand = mulberry32(11);
    const m = newAnimalMind("dog", h.home, h.radius, 0, rand);
    // A leftover sprint speed never carries into an ordinary wander.
    m.speed = RUN_SPEED;
    for (let now = 0; now < 60_000; now += 100) {
      const before = { x: e.x, y: e.y };
      stepAnimal(e, m, grid, 100, now, rand);
      expect(Math.hypot(e.x - before.x, e.y - before.y)).toBeLessThanOrEqual(ANIMAL_SPEED.dog * 0.1 + 1e-9);
    }
  });
});
