import { describe, expect, it } from "vitest";
import { getMap } from "../src/shared/maps";
import { buildCollision, canStand } from "../src/shared/engine";
import { animalGrid, animalStart, idlePoseFor, LOVE_MS, newAnimalMind, reactToLove, stepAnimal } from "../src/shared/engine/animals";
import { mulberry32 } from "../src/shared/maps/rng";
import { VILLAGE_ANIMALS } from "../src/shared/animals";
import { AnimalHerd } from "../src/worker/game/animalHerd";
import { PET_HOME, PET_RADIUS } from "../src/worker/home/ranch";
import type { EntityState } from "../src/shared/types";

const DT = 100;

function inExit(map: ReturnType<typeof getMap>, x: number, y: number): boolean {
  return map.exits.some((e) => x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h);
}

describe("animal wandering", () => {
  const village = getMap("village");
  const base = buildCollision(village);
  const grid = animalGrid(base, village.exits);

  it("every village animal starts on a standable tile near home", () => {
    for (const a of VILLAGE_ANIMALS) {
      const at = animalStart(a.home, grid);
      expect(canStand(grid, at.x, at.y), a.id).toBe(true);
      expect(Math.hypot(at.x - a.home.x, at.y - a.home.y), a.id).toBeLessThan(3);
    }
  });

  // Ten simulated minutes for each animal (Happy roams widely): room for a busy machine.
  it("walks for ten minutes without entering walls, water or exits, facing the way it moves", () => {
    for (const a of VILLAGE_ANIMALS) {
      const rand = mulberry32(a.id.length * 7919);
      const at = animalStart(a.home, grid);
      const e: EntityState = { id: `a:${a.id}`, kind: "animal", name: a.name, sprite: a.sprite, x: at.x, y: at.y, facing: "down", moving: false };
      const m = newAnimalMind(a.species, a.home, a.radius, 0, rand);
      const modes = new Set<string>();
      let travelled = 0;
      let far = 0;
      for (let now = 0; now < 10 * 60_000; now += DT) {
        const before = { x: e.x, y: e.y };
        stepAnimal(e, m, grid, DT, now, rand);
        modes.add(m.mode);
        const dx = e.x - before.x;
        const dy = e.y - before.y;
        travelled += Math.hypot(dx, dy);
        far = Math.max(far, Math.hypot(e.x - a.home.x, e.y - a.home.y));
        expect(canStand(base, e.x, e.y), `${a.id} at ${e.x},${e.y}`).toBe(true);
        expect(inExit(village, Math.floor(e.x), Math.floor(e.y)), a.id).toBe(false);
        // No moonwalking: the facing follows the bigger part of the step.
        if (Math.abs(dx) > Math.abs(dy) * 1.5) expect(e.facing, a.id).toBe(dx > 0 ? "right" : "left");
        if (Math.abs(dy) > Math.abs(dx) * 1.5) expect(e.facing, a.id).toBe(dy > 0 ? "down" : "up");
        // Never faster than its walk speed.
        expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(0.2 + 1e-9);
      }
      expect(travelled, a.id).toBeGreaterThan(20);
      expect(far, a.id).toBeLessThan(a.radius + 6);
      expect(modes.has("walk") && modes.has("rest"), a.id).toBe(true);
      // Cats also scratch and play; dogs sniff about.
      if (a.species === "cat") expect(modes.has("scratch") || modes.has("play"), a.id).toBe(true);
      if (a.species === "dog") expect(modes.has("sniff"), a.id).toBe(true);
    }
  }, 30_000); // long simulation; slow when the machine is busy

  it("picks idle poses by species: only cats scratch and play, only dogs sniff, hens never nap", () => {
    const seen = (sp: "cat" | "dog" | "chicken") => new Set(Array.from({ length: 100 }, (_, i) => idlePoseFor(sp, i / 100)));
    expect([...seen("cat")].sort()).toEqual(["nap", "play", "rest", "scratch", null].sort());
    expect([...seen("dog")].sort()).toEqual(["nap", "rest", "sniff", null].sort());
    expect([...seen("chicken")].sort()).toEqual(["rest", null].sort());
  });

  it("a pet stops the animal, turns it to you and holds the love pose", () => {
    const a = VILLAGE_ANIMALS[0]!;
    const rand = mulberry32(3);
    const e: EntityState = { id: "a:x", kind: "animal", name: "", sprite: a.sprite, x: a.home.x, y: a.home.y, facing: "down", moving: true };
    const m = newAnimalMind(a.species, a.home, a.radius, 0, rand);
    reactToLove(e, m, { x: a.home.x - 1.5, y: a.home.y + 0.2 }, 1000);
    expect(e.facing).toBe("left");
    expect(e.moving).toBe(false);
    expect(e.act?.k).toBe("love");
    expect(stepAnimal(e, m, grid, DT, 1000 + LOVE_MS - 1, rand)).toBe(false);
    expect(e.act?.k).toBe("love");
  });

  it("the home herd keeps pets in the yard and out of the road's exit", () => {
    const home = getMap("home");
    const homeGrid = buildCollision(home);
    const herd = new AnimalHerd(() => homeGrid, home.exits, mulberry32(9));
    herd.sync([{ id: "pet_mochi", name: "Mochi", sprite: "cat_ginger", species: "cat", home: PET_HOME, radius: PET_RADIUS }], 0);
    expect(herd.size).toBe(1);
    for (let now = 0; now < 5 * 60_000; now += DT) {
      herd.tick(DT, now);
      const p = herd.entities()[0]!;
      expect(canStand(homeGrid, p.x, p.y)).toBe(true);
      expect(inExit(home, Math.floor(p.x), Math.floor(p.y))).toBe(false);
    }
    herd.sync([], 0);
    expect(herd.size).toBe(0);
  });
});
