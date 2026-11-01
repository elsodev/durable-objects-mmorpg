// Monster stats + AI tick. Pure: the caller owns time (`now`) and randomness (`rand`).
import type { EntityState, ItemId, Vec2 } from "../types";
import { canStand, type CollisionGrid } from "./collision";
import { dist, facingFor } from "./geometry";
import { stepToward } from "./movement";

export interface MonsterState extends EntityState {
  kind: "monster";
  type: "slime" | "bat" | "rock_crab";
  home: Vec2;
  radius: number;
  targetId: string | null;
  cooldownMs: number;
  respawnAt: number | null; // ms epoch when dead
  wanderTarget: Vec2 | null;
}

export interface MonsterStats {
  hp: number;
  speed: number;
  damage: number;
  aggroRange: number;
  drops: { item: ItemId; qty: number; chance: number }[];
}

/** slime: weak and slow. bat: fast, fragile. rock_crab: tanky, hits hard, short sight. */
export const MONSTER_STATS: Record<MonsterState["type"], MonsterStats> = {
  slime: {
    hp: 20,
    speed: 1.2,
    damage: 4,
    aggroRange: 4,
    drops: [{ item: "slime_gel", qty: 1, chance: 0.8 }],
  },
  bat: {
    hp: 12,
    speed: 3.4,
    damage: 5,
    aggroRange: 6,
    drops: [{ item: "bat_wing", qty: 1, chance: 0.7 }],
  },
  rock_crab: {
    hp: 50,
    speed: 1.0,
    damage: 9,
    aggroRange: 3.5,
    drops: [
      { item: "crab_shell", qty: 1, chance: 0.75 },
      { item: "gem_crystal", qty: 1, chance: 0.1 },
    ],
  },
};

/** A monster bites when the target is this close (tiles). */
export const MONSTER_ATTACK_RANGE = 0.9;
/** Time between bites. */
export const MONSTER_ATTACK_COOLDOWN_MS = 1000;
/** Suggested respawn delay after death (callers set `respawnAt = now + this`). */
export const MONSTER_RESPAWN_MS = 30_000;
/** Wandering is slower than chasing. */
const WANDER_SPEED_FACTOR = 0.5;
/** Average idle time between wander walks. */
const WANDER_IDLE_MS = 2000;

/** Rolls loot for a kill. */
export function rollDrops(type: MonsterState["type"], rand: () => number): { item: ItemId; qty: number }[] {
  return MONSTER_STATS[type].drops.filter((d) => rand() < d.chance).map(({ item, qty }) => ({ item, qty }));
}

/** Random standable point within `radius` of home, or null after a few failed tries. */
function pickWanderPoint(m: MonsterState, grid: CollisionGrid, rand: () => number): Vec2 | null {
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * m.radius;
    const p = { x: m.home.x + Math.cos(a) * r, y: m.home.y + Math.sin(a) * r };
    if (canStand(grid, p.x, p.y)) return p;
  }
  return null;
}

function isAlive(e: EntityState): boolean {
  return e.hp === undefined || e.hp > 0;
}

/**
 * One tick of monster AI: chase nearest player within aggro range (staying within 2x radius of home),
 * otherwise wander. Returns the damage to apply to a player if it attacked this tick.
 * `rand` is a 0..1 RNG so callers control determinism. Mutates `m` (position, facing, moving,
 * targetId, cooldownMs, wanderTarget). Dead monsters (respawnAt set or hp <= 0) do nothing.
 */
export function stepMonster(
  m: MonsterState,
  players: EntityState[],
  grid: CollisionGrid,
  dtMs: number,
  now: number,
  rand: () => number,
): { hit?: { playerId: string; damage: number } } {
  void now; // reserved: AI is currently purely dt-driven
  if (m.respawnAt !== null || (m.hp !== undefined && m.hp <= 0)) {
    m.moving = false;
    return {};
  }
  const stats = MONSTER_STATS[m.type];
  const leash = m.radius * 2;
  m.cooldownMs = Math.max(0, m.cooldownMs - dtMs);

  // Nearest live player in sight that is not too far from home to be worth chasing.
  let target: EntityState | null = null;
  let best = Infinity;
  for (const p of players) {
    if (p.kind !== "player" || !isAlive(p)) continue;
    const d = dist(m, p);
    if (d <= stats.aggroRange && d < best && dist(m.home, p) <= leash + MONSTER_ATTACK_RANGE) {
      best = d;
      target = p;
    }
  }

  if (target) {
    m.targetId = target.id;
    m.wanderTarget = null;
    if (best <= MONSTER_ATTACK_RANGE) {
      m.facing = facingFor(target.x - m.x, target.y - m.y, m.facing);
      m.moving = false;
      if (m.cooldownMs <= 0) {
        m.cooldownMs = MONSTER_ATTACK_COOLDOWN_MS;
        return { hit: { playerId: target.id, damage: stats.damage } };
      }
      return {};
    }
    const r = stepToward(m, target, stats.speed, dtMs, grid);
    m.facing = r.facing;
    // Stay on the leash: refuse steps that would leave it.
    if (dist(r, m.home) <= leash) {
      m.x = r.x;
      m.y = r.y;
      m.moving = r.moving;
    } else {
      m.moving = false;
    }
    return {};
  }

  m.targetId = null;
  // Strayed (e.g. after a chase): walk back home.
  if (dist(m, m.home) > m.radius) m.wanderTarget ??= { ...m.home };
  if (!m.wanderTarget) {
    m.moving = false;
    if (rand() < dtMs / WANDER_IDLE_MS) m.wanderTarget = pickWanderPoint(m, grid, rand);
    return {};
  }
  const r = stepToward(m, m.wanderTarget, stats.speed * WANDER_SPEED_FACTOR, dtMs, grid);
  m.x = r.x;
  m.y = r.y;
  m.facing = r.facing;
  m.moving = r.moving;
  // Arrived or stuck against a wall: idle and pick a new point later.
  if (r.arrived || !r.moving) m.wanderTarget = null;
  return {};
}
