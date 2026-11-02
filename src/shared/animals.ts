// Friendly animals: the village cats and dogs, the pets you adopt from them, and their care rules.
// Pure data and rules only; ZoneRoom and HomeRoom apply them, the client shows AnimalView.
//
// Each player has their own affection with each village animal, kept in their save (AnimalSave),
// so zones and the home can both read and change it. Petting counts once per world day, and so
// does feeding; at ADOPT_PTS the player may adopt the animal. The village animal stays in the
// village for everyone else: adopting gives you your own copy of it, which lives in your yard.
import { getItem } from "./items";
import type { ItemId, Vec2 } from "./types";
import { worldDay } from "./calendar";

export type Species = "cat" | "dog" | "chicken";

/** A cat or dog that lives in the village and can be adopted. */
export interface VillageAnimal {
  id: string;
  name: string;
  species: "cat" | "dog";
  /** Catalog sprite key (`<species>_<coat>`). */
  sprite: string;
  /** Where it hangs about (tile centre) and how far it strays from there. */
  home: Vec2;
  radius: number;
  /** One line for the animal card. */
  blurb: string;
}

export const VILLAGE_ANIMALS: readonly VillageAnimal[] = [
  { id: "mochi", name: "Mochi", species: "cat", sprite: "cat_ginger", home: { x: 27.5, y: 26.5 }, radius: 5, blurb: "A ginger tabby who naps by the fountain." },
  { id: "pepper", name: "Pepper", species: "cat", sprite: "cat_grey", home: { x: 5.5, y: 15.5 }, radius: 4, blurb: "A grey cat with white socks. Shy at first." },
  { id: "biscuit", name: "Biscuit", species: "dog", sprite: "dog_golden", home: { x: 20.5, y: 40.5 }, radius: 6, blurb: "A golden dog who greets everyone on the green." },
  { id: "patch", name: "Patch", species: "dog", sprite: "dog_patch", home: { x: 57.5, y: 32.5 }, radius: 4, blurb: "A brown-and-white dog with one spotted ear." },
];

export function villageAnimal(id: unknown): VillageAnimal | undefined {
  return VILLAGE_ANIMALS.find((a) => a.id === id);
}

/** Entity id prefix of every friendly animal ("a:mochi", "a:pet_mochi", "a:hen_3"). */
export const ANIMAL_PREFIX = "a:";

// ---------------------------------------------------------------- affection

/** Affection points: the cap, and what adoption needs (shown as hearts, HEART_PTS each). */
export const MAX_AFFECTION = 100;
export const ADOPT_PTS = 100;
export const HEART_PTS = 20;
export const MAX_ANIMAL_HEARTS = MAX_AFFECTION / HEART_PTS;
/** Petting counts once per world day. */
export const PET_PTS = 10;
export type FoodTaste = "loved" | "liked" | "ok";
/** Feeding counts once per world day; what it is worth depends on the food. */
export const FEED_PTS: Readonly<Record<FoodTaste, number>> = { loved: 30, liked: 20, ok: 10 };
/** How many pets one home keeps. */
export const MAX_PETS = VILLAGE_ANIMALS.length;
/** How close (tiles) you stand to pet or feed an animal. */
export const ANIMAL_REACH = 2;
/**
 * The server accepts pet, feed and adopt from this far: the card stays open this far out (the
 * animal may wander a step while you choose), and closes beyond it.
 */
export const ANIMAL_CARE_REACH = 4;

/** Favourite foods; anything else edible is just "ok", and inedible things are refused. */
const TASTES: Readonly<Record<"cat" | "dog", Partial<Record<ItemId, FoodTaste>>>> = {
  cat: { fish_trout: "loved", pet_treat: "liked", egg: "liked" },
  dog: { pet_treat: "loved", egg: "liked", fish_trout: "liked" },
};

/** How a cat or dog takes a food, or null when it won't eat it. */
export function foodTaste(species: "cat" | "dog", item: ItemId): FoodTaste | null {
  const t = TASTES[species][item];
  if (t) return t;
  return getItem(item)?.eat ? "ok" : null;
}

/** One player's affection with one animal (a village animal, or their own pet). */
export interface AnimalBond {
  pts: number;
  /** World day it was last petted / fed with points (0 = never). */
  petDay: number;
  fedDay: number;
}

export function newAnimalBond(): AnimalBond {
  return { pts: 0, petDay: 0, fedDay: 0 };
}

export interface CareResult {
  /** Points gained (0 when today's pet or meal already counted). */
  delta: number;
  /** The first pet / meal of the day, which counts. */
  counted: boolean;
  taste?: FoodTaste;
}

/** A pet: always welcome (the love emote shows), but only the day's first one counts. */
export function petBond(b: AnimalBond, now: number): CareResult {
  const day = worldDay(now);
  if (b.petDay === day) return { delta: 0, counted: false };
  b.petDay = day;
  const before = b.pts;
  b.pts = Math.min(MAX_AFFECTION, b.pts + PET_PTS);
  return { delta: b.pts - before, counted: true };
}

/**
 * A meal: null when the animal won't eat it (nothing is used up). Only the day's first meal
 * counts; later ones are still eaten and loved, they just add nothing.
 */
export function feedBond(b: AnimalBond, species: "cat" | "dog", item: ItemId, now: number): CareResult | null {
  const taste = foodTaste(species, item);
  if (!taste) return null;
  const day = worldDay(now);
  if (b.fedDay === day) return { delta: 0, counted: false, taste };
  b.fedDay = day;
  const before = b.pts;
  b.pts = Math.min(MAX_AFFECTION, b.pts + FEED_PTS[taste]);
  return { delta: b.pts - before, counted: true, taste };
}

export function heartsOf(pts: number): number {
  return Math.min(MAX_ANIMAL_HEARTS, Math.floor(pts / HEART_PTS));
}

// ---------------------------------------------------------------- the save

/** A hen in the barn. `day` is the home day she arrived (0 until the home first sees her). */
export interface Chicken {
  id: string;
  sprite: string;
  day: number;
  /** Last home day she laid an egg (0 = never). */
  laid: number;
  /** World day she was last petted. */
  petDay: number;
}

/** An egg lying in the yard, waiting to be picked up. */
export interface Egg {
  id: string;
  x: number;
  y: number;
}

/** Everything about animals in one player's save. */
export interface AnimalSave {
  /** Affection with each village animal (also the bond with your own copy once adopted). */
  bonds: Record<string, AnimalBond>;
  /** Village animal ids you adopted: your copy of each lives in your yard. */
  pets: string[];
  barn: boolean;
  chickens: Chicken[];
  eggs: Egg[];
  /** Next id for chickens and eggs. */
  seq: number;
}

export function emptyAnimals(): AnimalSave {
  return { bonds: {}, pets: [], barn: false, chickens: [], eggs: [], seq: 0 };
}

const int = (v: unknown, min: number, max: number, dflt = min): number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : dflt;
const ID = /^[a-z0-9_]{1,24}$/;
/** Generous caps: a bad save can't grow these without bound. */
export const MAX_EGGS = 24;
const MAX_CHICKENS = 16;

/** Normalises a stored or client-relayed AnimalSave (zones send it back through savePlayer). */
export function sanitizeAnimals(raw: unknown): AnimalSave {
  const out = emptyAnimals();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  if (o.bonds && typeof o.bonds === "object" && !Array.isArray(o.bonds)) {
    for (const [id, v] of Object.entries(o.bonds as Record<string, unknown>)) {
      if (!villageAnimal(id) || !v || typeof v !== "object") continue;
      const b = v as Record<string, unknown>;
      out.bonds[id] = {
        pts: int(b.pts, 0, MAX_AFFECTION),
        petDay: int(b.petDay, 0, 1e7),
        fedDay: int(b.fedDay, 0, 1e7),
      };
    }
  }
  if (Array.isArray(o.pets)) out.pets = [...new Set(o.pets.filter((p): p is string => !!villageAnimal(p)))];
  out.barn = o.barn === true;
  if (Array.isArray(o.chickens)) {
    for (const c of o.chickens.slice(0, MAX_CHICKENS)) {
      if (!c || typeof c !== "object") continue;
      const r = c as Record<string, unknown>;
      if (typeof r.id !== "string" || !ID.test(r.id) || typeof r.sprite !== "string" || !CHICKEN_SPRITES.includes(r.sprite)) continue;
      out.chickens.push({ id: r.id, sprite: r.sprite, day: int(r.day, 0, 1e7), laid: int(r.laid, 0, 1e7), petDay: int(r.petDay, 0, 1e7) });
    }
  }
  if (Array.isArray(o.eggs)) {
    for (const e of o.eggs.slice(0, MAX_EGGS)) {
      if (!e || typeof e !== "object") continue;
      const r = e as Record<string, unknown>;
      if (typeof r.id !== "string" || !ID.test(r.id)) continue;
      if (typeof r.x !== "number" || typeof r.y !== "number" || !Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
      out.eggs.push({ id: r.id, x: Math.min(Math.max(r.x, 0), 1024), y: Math.min(Math.max(r.y, 0), 1024) });
    }
  }
  out.seq = int(o.seq, 0, 1e9);
  return out;
}

/** Chicken looks (catalog sprite keys); a new hen's look comes from her id. */
export const CHICKEN_SPRITES: readonly string[] = ["chicken_white", "chicken_brown"];

/** The bond with a village animal (created on first touch). */
export function bondWith(save: AnimalSave, id: string): AnimalBond {
  return (save.bonds[id] ??= newAnimalBond());
}

export type AdoptRefusal = "unknown" | "already" | "notYet" | "full";

/** Why `id` can't be adopted right now, or null when it can. */
export function adoptRefusal(save: AnimalSave, id: string): AdoptRefusal | null {
  if (!villageAnimal(id)) return "unknown";
  if (save.pets.includes(id)) return "already";
  if ((save.bonds[id]?.pts ?? 0) < ADOPT_PTS) return "notYet";
  if (save.pets.length >= MAX_PETS) return "full";
  return null;
}

/** Adopts `id`; false (nothing changed) when adoptRefusal says no. */
export function adopt(save: AnimalSave, id: string): boolean {
  if (adoptRefusal(save, id)) return false;
  save.pets.push(id);
  return true;
}

// ---------------------------------------------------------------- client view

/** What the animal card shows about one animal, for you. */
export interface AnimalView {
  /** Entity id here. */
  entity: string;
  /** Village animal id (cats and dogs); absent for chickens. */
  animal?: string;
  name: string;
  species: Species;
  blurb?: string;
  hearts: number;
  maxHearts: number;
  pts: number;
  /** Today's pet / meal already counted. */
  pettedToday: boolean;
  fedToday: boolean;
  /** Cats and dogs in the village: whether you can adopt (or did adopt) this one. */
  canAdopt?: boolean;
  adopted?: boolean;
  /** At home: this is your pet (or your hen). */
  yours?: boolean;
}

/** The card for a cat or dog (a village one, or your own copy at home). */
export function animalView(save: AnimalSave, def: VillageAnimal, entity: string, now: number, yours = false): AnimalView {
  const b = save.bonds[def.id] ?? newAnimalBond();
  const day = worldDay(now);
  return {
    entity,
    animal: def.id,
    name: def.name,
    species: def.species,
    blurb: def.blurb,
    hearts: heartsOf(b.pts),
    maxHearts: MAX_ANIMAL_HEARTS,
    pts: b.pts,
    pettedToday: b.petDay === day,
    fedToday: b.fedDay === day,
    canAdopt: adoptRefusal(save, def.id) === null,
    adopted: save.pets.includes(def.id),
    ...(yours ? { yours: true } : {}),
  };
}
