// Player-scaled spawning: how many monsters (or forage) a group wants and where a new one may
// appear. Pure: callers pass `rand`.
import {
  CAVE_DEPTH_MONSTER_CAP,
  RESPAWN_CROWD_SLOWDOWN,
  SPAWN_SAFE_RADIUS,
  ZONE_MONSTER_CAP,
  ZONE_MONSTER_CAPS,
  type ForageRule,
  type SpawnTuning,
} from "../spawns";
import { isCaveDepthZone, type MapData, type SharedZoneId, type Vec2 } from "../types";
import { canStand, type CollisionGrid } from "./collision";
import { dist } from "./geometry";

/** Live target for a group with `players` players near it: base + perPlayer per extra player, capped. */
export function spawnTarget(t: SpawnTuning, players: number): number {
  const extra = Math.ceil(t.perPlayer * Math.max(0, players - 1) - 1e-9);
  return Math.min(t.max, t.base + extra);
}

/**
 * Refill delay for one free slot: busier areas refill faster, but sublinearly; a group that
 * still has `alive` of its `target` up refills slower (RESPAWN_CROWD_SLOWDOWN).
 */
export function respawnDelayMs(t: SpawnTuning, players: number, alive = 0, target = 0): number {
  const full = target > 0 ? Math.min(1, Math.max(0, alive) / target) : 0;
  return (t.respawnMs / Math.sqrt(Math.max(1, players))) * (1 + RESPAWN_CROWD_SLOWDOWN * full);
}

/** The live-monster cap of a zone (spawns.ts explains the numbers). */
export function zoneMonsterCap(zone: SharedZoneId | undefined): number {
  if (!zone) return ZONE_MONSTER_CAP;
  return ZONE_MONSTER_CAPS[zone] ?? (isCaveDepthZone(zone) ? CAVE_DEPTH_MONSTER_CAP : ZONE_MONSTER_CAP);
}

/** Where monsters never appear: a map's spawn points and the centre of each exit. */
export function safeSpots(map: Pick<MapData, "spawns" | "exits">): Vec2[] {
  return [...Object.values(map.spawns), ...map.exits.map((e) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 }))];
}

/** True when `p` is at least SPAWN_SAFE_RADIUS from every safe spot. */
export function outsideSafeAreas(p: Vec2, safe: readonly Vec2[], radius = SPAWN_SAFE_RADIUS): boolean {
  return safe.every((q) => dist(p, q) >= radius);
}

/** True when `p` is at least `min` tiles from every player. */
export function farFromPlayers(p: Vec2, players: readonly Vec2[], min: number): boolean {
  return players.every((q) => dist(p, q) >= min);
}

/**
 * A standable point in the circle (home, radius) at least `minDist` from every player, or null
 * after `tries` misses (the caller retries on a later tick). `ok` adds the caller's own checks.
 */
export function pickSpawnPoint(
  home: Vec2,
  radius: number,
  grid: CollisionGrid,
  players: readonly Vec2[],
  minDist: number,
  rand: () => number,
  tries = 12,
  ok: (p: Vec2) => boolean = () => true,
): Vec2 | null {
  for (let i = 0; i < tries; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * radius;
    const p = { x: home.x + Math.cos(a) * r, y: home.y + Math.sin(a) * r };
    if (canStand(grid, p.x, p.y) && farFromPlayers(p, players, minDist) && ok(p)) return p;
  }
  return null;
}

/** Forage cap for a zone with `players` players. */
export function forageCap(rule: Pick<ForageRule, "base" | "perPlayer" | "max">, players: number): number {
  return Math.min(rule.max, rule.base + rule.perPlayer * Math.max(0, players));
}

/** How many forage items to add now: top up to the cap. */
export function planForage(present: number, cap: number): number {
  return Math.max(0, cap - present);
}

/** Weighted pick from a table, or null when it is empty. */
export function weightedItem<T extends { weight: number }>(table: readonly T[], rand: () => number): T | null {
  const total = table.reduce((n, e) => n + Math.max(0, e.weight), 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const e of table) {
    r -= Math.max(0, e.weight);
    if (r < 0) return e;
  }
  return table[table.length - 1] ?? null;
}
