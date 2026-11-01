// Combat rules shared by the server (authoritative) and the client (prediction, feedback):
// damage rolls, the sword's swing arc, knockback slides, invincibility windows and loot shares.
// Pure: callers pass `now` and `rand`.
import type { Facing, Vec2 } from "../types";
import { canStand, type CollisionGrid } from "./collision";
import type { WeaponStats } from "./toolRules";

/** After a hit the player can't be hurt again for this long. */
export const PLAYER_IFRAME_MS = 1200;
/** After a hit a monster can't be hit again for this long (one swing can't hit it twice). */
export const MONSTER_IFRAME_MS = 250;
/** A monster touching a player this close (feet to feet, tiles) bites. */
export const CONTACT_RANGE = 0.7;
/** Sword sweep: a sector this wide (radians, total) and deep (tiles), centred on your facing. */
export const SWING_ARC_RAD = (120 * Math.PI) / 180;
export const SWING_RADIUS = 1.6;
/** Monsters this close count as inside the arc whatever the angle (they overlap you). */
export const SWING_POINT_BLANK = 0.45;
/** Knockback speed halves every this many ms. */
export const KNOCKBACK_HALF_LIFE_MS = 100;
/** Slides slower than this (tiles/ms) have stopped. */
const KB_STOP = 0.00005;
/** Incoming damage to players varies by up to this fraction either way. */
export const HURT_JITTER = 1 / 8;
/** Screen shake per point of damage taken, and its cap. */
export const SHAKE_MS_PER_DAMAGE = 15;
export const SHAKE_MS_MAX = 300;
/** Players who dealt at least this share of a monster's max HP each get their own loot roll. */
export const LOOT_SHARE = 0.15;

export interface HitRoll {
  dmg: number;
  crit: boolean;
  miss: boolean;
}

/**
 * One weapon hit on a monster: rand(min..max), a crit multiplies it, defense comes off, at least
 * 1 lands. `missChance` (0..1) can turn it into a miss for 0.
 */
export function rollHit(w: Pick<WeaponStats, "min" | "max" | "critChance" | "critMult">, defense: number, missChance: number, rand: () => number): HitRoll {
  if (missChance > 0 && rand() < missChance) return { dmg: 0, crit: false, miss: true };
  const lo = Math.min(w.min, w.max);
  const hi = Math.max(w.min, w.max);
  let dmg = lo + Math.floor(rand() * (hi - lo + 1));
  const crit = rand() < w.critChance;
  if (crit) dmg = Math.round(dmg * w.critMult);
  return { dmg: Math.max(1, dmg - Math.max(0, defense)), crit, miss: false };
}

/** Unit vector of a facing (tile space: +y is down). */
export function facingVector(f: Facing): Vec2 {
  switch (f) {
    case "up":
      return { x: 0, y: -1 };
    case "down":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
  }
}

/** True when `target` is inside the sword sector swung from `origin` toward `facing`. */
export function inSwingArc(origin: Vec2, facing: Facing, target: Vec2, radius = SWING_RADIUS, arcRad = SWING_ARC_RAD): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const d = Math.hypot(dx, dy);
  if (d > radius) return false;
  if (d <= SWING_POINT_BLANK) return true;
  const f = facingVector(facing);
  const cos = (dx * f.x + dy * f.y) / d;
  return cos >= Math.cos(arcRad / 2) - 1e-9;
}

/** A knockback in flight: velocity in tiles per ms. */
export interface Knockback {
  vx: number;
  vy: number;
}

/**
 * Velocity that slides a monster `distance` tiles in total, straight away from `from`. On top
 * of each other the push goes along `fallback` (the attacker's facing).
 */
export function knockbackFrom(from: Vec2, to: Vec2, distance: number, fallback: Facing = "down", halfLife = KNOCKBACK_HALF_LIFE_MS): Knockback {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) {
    const f = facingVector(fallback);
    dx = f.x;
    dy = f.y;
  } else {
    dx /= d;
    dy /= d;
  }
  // Exponential decay: total distance = v0 * halfLife / ln 2.
  const v0 = (distance * Math.LN2) / halfLife;
  return { vx: dx * v0, vy: dy * v0 };
}

/** Distance a slide still covers from now on (tiles), for previews and tests. */
export function knockbackRemaining(kb: Knockback, halfLife = KNOCKBACK_HALF_LIFE_MS): number {
  return (Math.hypot(kb.vx, kb.vy) * halfLife) / Math.LN2;
}

/** Fraction of a slide's distance covered `t` ms after it started (0..1). */
export function knockbackProgress(t: number, halfLife = KNOCKBACK_HALF_LIFE_MS): number {
  return t <= 0 ? 0 : 1 - Math.pow(0.5, t / halfLife);
}

/**
 * Advances a slide by `dtMs`: moves `pos` (exactly integrated), decays the velocity and stops an
 * axis at walls. `glider`: only the map edge stops it (bats fly over walls). Returns the
 * knockback still in flight, or null once it has stopped.
 */
export function stepKnockback(
  pos: Vec2,
  kb: Knockback,
  dtMs: number,
  grid: CollisionGrid,
  glider = false,
  halfLife = KNOCKBACK_HALF_LIFE_MS,
): Knockback | null {
  const decay = Math.pow(0.5, dtMs / halfLife);
  const travel = (1 - decay) * (halfLife / Math.LN2);
  let { vx, vy } = kb;
  const open = (x: number, y: number) =>
    glider ? x >= 0.5 && y >= 0.5 && x <= grid.width - 0.5 && y <= grid.height - 0.5 : canStand(grid, x, y);
  const nx = pos.x + vx * travel;
  if (open(nx, pos.y)) pos.x = nx;
  else vx = 0;
  const ny = pos.y + vy * travel;
  if (open(pos.x, ny)) pos.y = ny;
  else vy = 0;
  vx *= decay;
  vy *= decay;
  return Math.hypot(vx, vy) < KB_STOP ? null : { vx, vy };
}

/** A player's incoming damage after jitter, at least 1. */
export function hurtAmount(base: number, rand: () => number): number {
  const j = 1 + (rand() * 2 - 1) * HURT_JITTER;
  return Math.max(1, Math.round(base * j));
}

/**
 * Lands a hit on someone with an invincibility window. Returns the damage dealt, or 0 when
 * they are still invincible (nothing changes then).
 */
export function hurtWithIframes(v: { hp?: number; maxHp?: number; iframeUntil: number }, dmg: number, now: number, iframeMs = PLAYER_IFRAME_MS): number {
  if (now < v.iframeUntil || dmg <= 0) return 0;
  const max = v.maxHp ?? 100;
  v.hp = Math.max(0, (v.hp ?? max) - dmg);
  v.iframeUntil = now + iframeMs;
  return dmg;
}

/** Screen shake length for a hurt player. */
export function hurtShakeMs(dmg: number): number {
  return Math.min(SHAKE_MS_MAX, Math.max(0, dmg) * SHAKE_MS_PER_DAMAGE);
}

/**
 * Who gets their own loot roll for a kill: everyone who dealt at least LOOT_SHARE of the max HP,
 * plus whoever landed the killing blow. Order: most damage first.
 */
export function lootShares(damageBy: Readonly<Record<string, number>>, maxHp: number, killer: string | null, share = LOOT_SHARE): string[] {
  const need = Math.max(1, maxHp) * share;
  const out = Object.entries(damageBy)
    .filter(([, d]) => d >= need - 1e-9)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  if (killer && !out.includes(killer)) out.push(killer);
  return out;
}
