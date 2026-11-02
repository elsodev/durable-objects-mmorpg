// Friendly animal AI: wander near home, pause, sit, nap and react to a pet. Pure and
// deterministic given `now` and `rand`; the same code moves the village animals (ZoneRoom) and the
// pets and hens at home (HomeRoom). Never blocks anyone and never fights.
import type { EntityState, Facing, MapExit, Vec2 } from "../types";
import type { Species } from "../animals";
import { canStand, setBlocked, type CollisionGrid } from "./collision";
import { stepToward } from "./movement";
import { findPath } from "./path";
import { dist, facingFor } from "./geometry";

/**
 * "rest" sits (cats and dogs) or pecks the ground (hens); "nap" curls up asleep; "love" is a pet;
 * "scratch" (cats) scratches behind an ear; "play" (cats) bats a ball of yarn; "sniff" (dogs) noses
 * the grass.
 */
export type AnimalMode = "idle" | "walk" | "rest" | "nap" | "love" | "scratch" | "play" | "sniff";
/** EntityState.act kinds the client draws as animal poses (never "sit", which seats people). */
export const ANIMAL_ACTS = { rest: "rest", nap: "nap", love: "love", scratch: "scratch", play: "play", sniff: "sniff" } as const;
/** Idle poses an animal picks between walks (the act key and its pause range below). */
type IdlePose = "rest" | "nap" | "scratch" | "play" | "sniff";

export interface AnimalMind {
  species: Species;
  home: Vec2;
  radius: number;
  mode: AnimalMode;
  /** When the current pause, rest, nap or reaction ends (ms). */
  until: number;
  path: Vec2[];
  /** Walking: last time it made progress, to give up when stuck. */
  movedAt: number;
}

/** Walk speed in tiles per second: unhurried, well below a player's. */
export const ANIMAL_SPEED: Readonly<Record<Species, number>> = { cat: 1.5, dog: 1.9, chicken: 1.0 };
/** How long a pet's reaction holds the animal still (it faces you and shows the love emote). */
export const LOVE_MS = 2500;
/** Give up a walk that hasn't moved for this long (someone dropped furniture in the way). */
const STUCK_MS = 1500;
/** Paths longer than this are not worth the walk. */
const MAX_PATH = 24;

/** [min, max] ms of each pause; chosen with `rand` so animals don't move in step. */
const PAUSE: Readonly<Record<Exclude<AnimalMode, "walk" | "love">, [number, number]>> = {
  idle: [1200, 4000],
  rest: [5000, 12000],
  nap: [12000, 30000],
  scratch: [1600, 3200],
  play: [3000, 6000],
  sniff: [2000, 4500],
};
/** After a pause: the chance of each idle pose (the rest of the time it walks on). Hens peck. */
const NEXT: Readonly<Record<Species, Partial<Record<IdlePose, number>>>> = {
  cat: { rest: 0.2, nap: 0.15, scratch: 0.12, play: 0.13 },
  dog: { rest: 0.2, nap: 0.1, sniff: 0.25 },
  chicken: { rest: 0.35 },
};

/** Which idle pose `roll` (0..1) lands on for this species, or null to walk. */
export function idlePoseFor(species: Species, roll: number): IdlePose | null {
  let acc = 0;
  for (const [pose, p] of Object.entries(NEXT[species]) as [IdlePose, number][]) {
    acc += p;
    if (roll < acc) return pose;
  }
  return null;
}

export function newAnimalMind(species: Species, home: Vec2, radius: number, now: number, rand: () => number): AnimalMind {
  return { species, home: { ...home }, radius, mode: "idle", until: now + span(PAUSE.idle, rand), path: [], movedAt: now };
}

const span = ([a, b]: [number, number], rand: () => number): number => a + Math.floor(rand() * (b - a));

/**
 * A copy of `grid` with exits (and doorways) blocked: animals wander but never walk out of the
 * map or into a building.
 */
export function animalGrid(grid: CollisionGrid, exits: readonly MapExit[]): CollisionGrid {
  const g: CollisionGrid = { width: grid.width, height: grid.height, cells: new Uint8Array(grid.cells) };
  for (const e of exits) setBlocked(g, e.x - 1, e.y - 1, e.w + 2, e.h + 2, true);
  return g;
}

/** A random standable tile centre within `radius` of home that a path reaches, or null. */
export function pickWanderTarget(m: AnimalMind, from: Vec2, grid: CollisionGrid, rand: () => number): Vec2[] | null {
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * m.radius;
    const t = { x: Math.floor(m.home.x + Math.cos(a) * r) + 0.5, y: Math.floor(m.home.y + Math.sin(a) * r) + 0.5 };
    if (!canStand(grid, t.x, t.y) || dist(t, from) < 1) continue;
    const path = findPath(grid, from, t);
    if (path && path.length > 0 && path.length <= MAX_PATH) return path;
  }
  return null;
}

function settle(e: EntityState, m: AnimalMind, mode: Exclude<AnimalMode, "walk" | "love">, now: number, rand: () => number): void {
  m.mode = mode;
  m.path = [];
  m.until = now + span(PAUSE[mode], rand);
  e.moving = false;
  if (mode === "idle") delete e.act;
  else e.act = { k: ANIMAL_ACTS[mode], at: now };
}

/**
 * Advances one animal by `dt` ms. Returns true when it moved or changed pose (so the tick knows
 * something is going on). An animal standing where it can't (a placed object) hops home.
 */
export function stepAnimal(e: EntityState, m: AnimalMind, grid: CollisionGrid, dt: number, now: number, rand: () => number): boolean {
  if (m.mode !== "walk") {
    if (now < m.until) return false;
    // Pause over: walk somewhere, or settle into a rest or a nap.
    const pose = m.mode === "idle" ? idlePoseFor(m.species, rand()) : null;
    if (pose) return settle(e, m, pose, now, rand), true;
    const path = pickWanderTarget(m, e, grid, rand);
    if (!path) return settle(e, m, "idle", now, rand), true;
    delete e.act;
    m.mode = "walk";
    m.path = path;
    m.movedAt = now;
  }
  const wp = m.path[0];
  if (!wp) return settle(e, m, "idle", now, rand), true;
  const r = stepToward(e, wp, ANIMAL_SPEED[m.species], dt, grid);
  e.facing = r.facing;
  e.moving = r.moving;
  if (r.moving) {
    e.x = r.x;
    e.y = r.y;
    m.movedAt = now;
  }
  if (r.arrived) m.path.shift();
  if (m.path.length === 0 || now - m.movedAt > STUCK_MS) settle(e, m, "idle", now, rand);
  return true;
}

/** A pet or a meal: stop, face the player and hold a happy pose for LOVE_MS. */
export function reactToLove(e: EntityState, m: AnimalMind, toward: Vec2, now: number): void {
  m.mode = "love";
  m.path = [];
  m.until = now + LOVE_MS;
  e.moving = false;
  e.facing = facingFor(toward.x - e.x, toward.y - e.y, e.facing);
  e.act = { k: ANIMAL_ACTS.love, at: now };
}

/** Where an animal starts: its home if it can stand there, else the nearest standable spot around. */
export function animalStart(home: Vec2, grid: CollisionGrid): Vec2 {
  if (canStand(grid, home.x, home.y)) return { ...home };
  for (let r = 1; r <= 6; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const p = { x: Math.floor(home.x) + dx + 0.5, y: Math.floor(home.y) + dy + 0.5 };
        if (canStand(grid, p.x, p.y)) return p;
      }
  return { ...home };
}

export type { Facing };
