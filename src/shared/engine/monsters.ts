// Monster stats, drop tables and the per-type AI state machine. Pure: the caller owns time
// (`now`) and randomness (`rand`). Everything is driven by dtMs, so it runs fine at 10 Hz.
import type { EntityState, ItemId, Vec2 } from "../types";
import { canStand, type CollisionGrid } from "./collision";
import { CONTACT_RANGE, stepKnockback, type Knockback } from "./combat";
import { dist, facingFor } from "./geometry";
import { stepToward } from "./movement";
import { rollSeedDrop } from "../seeds";
import { isCaveZone, RARE_MONSTER_FURNITURE } from "../furnitureItems";
import type { Drop } from "./toolRules";
import { DEFAULT_DROP_RATES, isRareDrop, rollDrop, type DropRates } from "./dropRate";

export type MonsterType = "slime" | "bat" | "rock_crab";

/**
 * dormant: asleep until a player comes close (bats). idle/wander: at home. chase: after a
 * target. windup: crouching before a leap (slimes). leap: flying at the target. home: leashed
 * back, healing on the way.
 */
export type MonsterMode = "dormant" | "idle" | "wander" | "chase" | "windup" | "leap" | "home";

export interface MonsterState extends EntityState {
  kind: "monster";
  type: MonsterType;
  home: Vec2;
  radius: number;
  /** Spawn group index in MapData.monsters. */
  group: number;
  targetId: string | null;
  wanderTarget: Vec2 | null;
  mode: MonsterMode;
  /** When the current timed mode (windup, leap, coast) ends. */
  modeUntil: number;
  /** Knockback slide in flight; AI and bites wait for it. */
  kb: Knockback | null;
  /** Leap velocity (slimes), decays like a knockback but bites on contact. */
  leap: Knockback | null;
  /** No hits land before this. */
  iframeUntil: number;
  /** Hit by this player: chase them (ignoring sight range) until aggroUntil. */
  aggroId: string | null;
  aggroUntil: number;
  /** Damage dealt by each player entity id (loot shares). Cleared when it heals back home. */
  damageBy: Record<string, number>;
  lastJumpAt: number;
  /** Last time it hit, was hit or chased (despawn waits for quiet). */
  lastCombatAt: number;
  /** Bats: flight heading (radians). */
  heading: number;
  /** Bats: steering resumes after this (they coast after being hit). */
  coastUntil: number;
  /** Depth level (deeper caves); absent means 1. */
  level?: number;
}

export interface MonsterStats {
  hp: number;
  speed: number;
  damage: number;
  aggroRange: number;
  /** Comes off every hit (at least 1 still lands). */
  defense: number;
  /** Chance a weapon hit misses outright. */
  missChance: number;
  /** Flies over walls (only the map edge stops it). */
  glider: boolean;
  /** Independent rolls; the same item twice adds up. */
  drops: Drop[];
}

/** slime: weak and slow, hops. bat: fast, fragile, flies, hard to hit. rock_crab: tanky, armoured. */
export const MONSTER_STATS: Record<MonsterType, MonsterStats> = {
  slime: {
    hp: 20,
    speed: 1.2,
    damage: 4,
    aggroRange: 4.5,
    defense: 1,
    missChance: 0,
    glider: false,
    drops: [
      { item: "slime_gel", min: 1, max: 1, chance: 0.75 },
      { item: "slime_gel", min: 1, max: 1, chance: 0.05 },
      { item: "herb_mint", min: 1, max: 1, chance: 0.1 },
      { item: "gem_crystal", min: 1, max: 1, chance: 0.01 },
      { item: "flashlight", min: 1, max: 1, chance: 0.004 },
    ],
  },
  bat: {
    hp: 12,
    speed: 3,
    damage: 5,
    aggroRange: 6,
    defense: 0,
    missChance: 0.1,
    glider: true,
    drops: [
      { item: "bat_wing", min: 1, max: 1, chance: 0.9 },
      { item: "bat_wing", min: 1, max: 1, chance: 0.35 },
      { item: "gem_crystal", min: 1, max: 1, chance: 0.02 },
      { item: "flashlight", min: 1, max: 1, chance: 0.006 },
    ],
  },
  rock_crab: {
    hp: 50,
    speed: 1.0,
    damage: 9,
    aggroRange: 3.5,
    defense: 3,
    missChance: 0,
    glider: false,
    drops: [
      { item: "crab_shell", min: 1, max: 1, chance: 0.6 },
      { item: "ore_iron", min: 1, max: 2, chance: 0.3 },
      { item: "stone", min: 1, max: 3, chance: 0.5 },
      { item: "gem_crystal", min: 1, max: 1, chance: 0.08 },
      { item: "flashlight", min: 1, max: 1, chance: 0.012 },
    ],
  },
};

/** Per level above 1: extra share of base hp and bite damage; armour grows every other level. */
export const MONSTER_LEVEL_SCALE = { hp: 0.3, damage: 0.2, defenseEvery: 2 } as const;

/** Stats of a monster at `level` (1 = MONSTER_STATS as written). */
export function levelStats(type: MonsterType, level = 1): Pick<MonsterStats, "hp" | "damage" | "defense"> {
  const base = MONSTER_STATS[type];
  const up = Math.max(0, Math.floor(level) - 1);
  return {
    hp: Math.round(base.hp * (1 + MONSTER_LEVEL_SCALE.hp * up)),
    damage: Math.round(base.damage * (1 + MONSTER_LEVEL_SCALE.damage * up)),
    defense: base.defense + Math.floor(up / MONSTER_LEVEL_SCALE.defenseEvery),
  };
}

/** Gems only come from the deep zones. */
const NO_GEM_ZONES: ReadonlySet<string> = new Set(["riverside"]);

/** AI tuning. */
export const MONSTER_AI = {
  /** Leash: a chase never takes a monster further than this many radii from home. */
  leashRadii: 3,
  /** Aggro on the attacker lasts this long after each hit. */
  aggroMs: 10_000,
  /** Healing per second (fraction of max HP) while walking home off the leash. */
  homeHealPerSec: 0.1,
  wanderSpeed: 0.5,
  wanderIdleMs: 2000,
  slime: {
    /** Minimum gap between leaps. */
    jumpGapMs: 1000,
    /** Chance per ~16.7 ms frame to start a leap once allowed (about 45% a second). */
    jumpChancePerFrame: 0.01,
    windupMs: 800,
    leapMs: 400,
    leapMaxTiles: 3,
    leapHalfLifeMs: 130,
    /** Between leaps a slime only creeps. */
    creepFactor: 0.35,
  },
  bat: {
    wakeRange: 6,
    turnRadPerSec: 1.2,
    minSpeed: 2,
    maxSpeed: 4,
    coastMs: 600,
  },
} as const;

/**
 * Rolls one player's loot for a kill (independent rolls; repeats stack). With `zone`, a seed from
 * that zone's MONSTER_SEED_DROPS (shared/seeds.ts) may come too. Chances scale with
 * DROP_RATE_MONSTER (rare items with DROP_RATE_RARE when set).
 */
export function rollMonsterDrops(
  type: MonsterType,
  rand: () => number,
  zone?: string,
  rates: Readonly<DropRates> = DEFAULT_DROP_RATES,
): { item: ItemId; qty: number }[] {
  const out: { item: ItemId; qty: number }[] = [];
  for (const d of MONSTER_STATS[type].drops) {
    if (zone && NO_GEM_ZONES.has(zone) && d.item === "gem_crystal") continue;
    if (d.chance !== undefined && !rollDrop(d.chance, "monster", rand, rates, isRareDrop(d.item))) continue;
    const qty = d.min + Math.floor(rand() * (d.max - d.min + 1));
    if (qty <= 0) continue;
    const same = out.find((x) => x.item === d.item);
    if (same) same.qty += qty;
    else out.push({ item: d.item, qty });
  }
  const seed = zone ? rollSeedDrop(zone, type, rand, rates) : null;
  if (seed) out.push(seed);
  const piece = zone ? rollRareFurniture(zone, type, rand, rates) : null;
  if (piece) out.push({ item: piece, qty: 1 });
  return out;
}

/**
 * The rare furniture piece a kill in `zone` drops, if any (RARE_MONSTER_FURNITURE: caves only,
 * a fraction of a percent). Counts as a rare drop, so DROP_RATE_RARE scales it when set.
 */
export function rollRareFurniture(
  zone: string,
  type: MonsterType,
  rand: () => number,
  rates: Readonly<DropRates> = DEFAULT_DROP_RATES,
): ItemId | null {
  if (!isCaveZone(zone)) return null;
  const rule = Object.hasOwn(RARE_MONSTER_FURNITURE, type) ? RARE_MONSTER_FURNITURE[type] : undefined;
  return rule && rollDrop(rule.chance, "monster", rand, rates, true) ? rule.item : null;
}

/** A fresh monster at `at`. */
export function newMonster(id: string, type: MonsterType, at: Vec2, home: Vec2, radius: number, group: number, now: number, level = 1): MonsterState {
  const hp = levelStats(type, level).hp;
  return {
    id,
    kind: "monster",
    type,
    name: type.replace("_", " "),
    sprite: type,
    x: at.x,
    y: at.y,
    facing: "down",
    moving: false,
    hp,
    maxHp: hp,
    home: { ...home },
    radius,
    group,
    targetId: null,
    wanderTarget: null,
    mode: type === "bat" ? "dormant" : "idle",
    modeUntil: 0,
    kb: null,
    leap: null,
    iframeUntil: 0,
    aggroId: null,
    aggroUntil: 0,
    damageBy: {},
    lastJumpAt: -Infinity,
    lastCombatAt: now,
    heading: 0,
    coastUntil: 0,
    ...(level > 1 ? { level } : {}),
  };
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

const isAlive = (e: EntityState): boolean => e.hp === undefined || e.hp > 0;
const leashOf = (m: MonsterState) => Math.max(4, m.radius * MONSTER_AI.leashRadii);

/** Called when a player hits the monster: it turns on them and wakes up. */
export function provoke(m: MonsterState, attackerId: string, now: number): void {
  m.aggroId = attackerId;
  m.aggroUntil = now + MONSTER_AI.aggroMs;
  m.lastCombatAt = now;
  if (m.mode === "dormant" || m.mode === "idle" || m.mode === "wander" || m.mode === "home") m.mode = "chase";
  if (m.type === "bat") m.coastUntil = now + MONSTER_AI.bat.coastMs;
  // A hit breaks a crouch: the leap is lost.
  if (m.mode === "windup") m.mode = "chase";
}

/** The player this monster goes after, if any. */
function pickTarget(m: MonsterState, players: readonly EntityState[], now: number): EntityState | null {
  const leash = leashOf(m);
  const reachable = (p: EntityState) => p.kind === "player" && isAlive(p) && dist(m.home, p) <= leash + CONTACT_RANGE;
  if (m.aggroId && now < m.aggroUntil) {
    const p = players.find((q) => q.id === m.aggroId);
    if (p && reachable(p)) return p;
  }
  const stats = MONSTER_STATS[m.type];
  const sight = m.type === "bat" && m.mode === "dormant" ? MONSTER_AI.bat.wakeRange : stats.aggroRange;
  // A bat that has seen you keeps after you while you stay on its leash.
  const keep = m.type === "bat" && m.targetId ? players.find((q) => q.id === m.targetId) : undefined;
  if (keep && reachable(keep)) return keep;
  let best: EntityState | null = null;
  let bd = Infinity;
  for (const p of players) {
    if (!reachable(p)) continue;
    const d = dist(m, p);
    if (d <= sight && d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** Contact bite on whichever live player it touches (the player's i-frames rate-limit it). */
function contact(m: MonsterState, players: readonly EntityState[], now: number): { playerId: string; damage: number } | undefined {
  if (now < m.iframeUntil) return undefined;
  let best: EntityState | null = null;
  let bd = CONTACT_RANGE;
  for (const p of players) {
    if (p.kind !== "player" || !isAlive(p)) continue;
    const d = dist(m, p);
    if (d <= bd) {
      bd = d;
      best = p;
    }
  }
  if (!best) return undefined;
  m.lastCombatAt = now;
  return { playerId: best.id, damage: levelStats(m.type, m.level).damage };
}

function walk(m: MonsterState, to: Vec2, speed: number, dtMs: number, grid: CollisionGrid): boolean {
  const r = stepToward(m, to, speed, dtMs, grid);
  m.x = r.x;
  m.y = r.y;
  m.facing = r.facing;
  m.moving = r.moving;
  return r.arrived || !r.moving;
}

/** Bat flight: turn toward `to` at a limited rate, fly over anything, stay inside the map. */
function fly(m: MonsterState, to: Vec2, dtMs: number, grid: CollisionGrid, now: number, steer = true): void {
  const b = MONSTER_AI.bat;
  const d = dist(m, to);
  if (steer && now >= m.coastUntil) {
    const want = Math.atan2(to.y - m.y, to.x - m.x);
    let diff = want - m.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = (b.turnRadPerSec * dtMs) / 1000;
    // Far off, swing round quicker so it never orbits forever.
    const turn = d > 3 ? maxTurn * 2 : maxTurn;
    m.heading += Math.max(-turn, Math.min(turn, diff));
  }
  const speed = Math.max(b.minSpeed, Math.min(b.maxSpeed, b.maxSpeed - d / 3));
  const step = (speed * dtMs) / 1000;
  m.x = Math.max(0.5, Math.min(grid.width - 0.5, m.x + Math.cos(m.heading) * step));
  m.y = Math.max(0.5, Math.min(grid.height - 0.5, m.y + Math.sin(m.heading) * step));
  m.facing = facingFor(Math.cos(m.heading), Math.sin(m.heading), m.facing);
  m.moving = true;
}

/**
 * One tick of monster AI. Mutates `m`; returns a bite to apply to a player if it touched one.
 * A knockback in flight suppresses everything else.
 */
export function stepMonster(
  m: MonsterState,
  players: readonly EntityState[],
  grid: CollisionGrid,
  dtMs: number,
  now: number,
  rand: () => number,
): { hit?: { playerId: string; damage: number } } {
  if (m.hp !== undefined && m.hp <= 0) {
    m.moving = false;
    return {};
  }
  const stats = MONSTER_STATS[m.type];
  if (m.kb) {
    m.kb = stepKnockback(m, m.kb, dtMs, grid, stats.glider);
    m.moving = false;
    m.leap = null;
    return {};
  }

  // Off the leash: go home, healing as it goes; nothing turns it round until it gets there.
  if (m.mode === "home") {
    const max = m.maxHp ?? stats.hp;
    m.hp = Math.min(max, (m.hp ?? max) + (max * MONSTER_AI.homeHealPerSec * dtMs) / 1000);
    let arrived: boolean;
    if (stats.glider) {
      fly(m, m.home, dtMs, grid, now);
      arrived = dist(m, m.home) < 0.5;
    } else arrived = walk(m, m.home, stats.speed, dtMs, grid) && dist(m, m.home) <= m.radius;
    if (arrived) {
      m.mode = m.type === "bat" ? "dormant" : "idle";
      m.hp = max;
      m.damageBy = {};
      m.targetId = null;
      m.aggroId = null;
      m.moving = false;
    }
    return {};
  }

  if (m.mode === "windup") {
    m.moving = false;
    if (now < m.modeUntil) return {};
    const target = m.targetId ? players.find((p) => p.id === m.targetId) : undefined;
    const ai = MONSTER_AI.slime;
    if (!target) {
      m.mode = "chase";
      return {};
    }
    const d = dist(m, target);
    const len = Math.min(ai.leapMaxTiles, d + 0.3);
    const v0 = (len * Math.LN2) / ai.leapHalfLifeMs;
    m.leap = d > 1e-6 ? { vx: ((target.x - m.x) / d) * v0, vy: ((target.y - m.y) / d) * v0 } : null;
    m.mode = "leap";
    m.modeUntil = now + ai.leapMs;
    m.lastJumpAt = now;
    m.act = { k: "leap", at: now };
    return {};
  }

  if (m.mode === "leap") {
    if (m.leap) m.leap = stepKnockback(m, m.leap, dtMs, grid, false, MONSTER_AI.slime.leapHalfLifeMs);
    m.moving = true;
    const bite = contact(m, players, now);
    if (bite) m.leap = null;
    if (now >= m.modeUntil || !m.leap) m.mode = "chase";
    return bite ? { hit: bite } : {};
  }

  const target = pickTarget(m, players, now);
  const leash = leashOf(m);
  if (!target) {
    // Lost them: strayed past its own camp means the walk home (and the heal).
    if (m.mode === "chase" && dist(m, m.home) > m.radius) {
      m.mode = "home";
      m.targetId = null;
      return {};
    }
    if (m.mode === "chase") m.mode = m.type === "bat" ? "dormant" : "idle";
    m.targetId = null;
    return idle(m, grid, dtMs, rand);
  }

  m.mode = "chase";
  m.targetId = target.id;
  m.wanderTarget = null;
  m.lastCombatAt = now;
  const bite = contact(m, players, now);
  if (bite) {
    m.facing = facingFor(target.x - m.x, target.y - m.y, m.facing);
    if (m.type !== "bat") {
      m.moving = false;
      return { hit: bite };
    }
  }

  if (m.type === "bat") {
    fly(m, target, dtMs, grid, now);
    if (dist(m, m.home) > leash + 2) m.mode = "home";
    return bite ? { hit: bite } : {};
  }

  if (m.type === "slime") {
    const ai = MONSTER_AI.slime;
    const p = 1 - Math.pow(1 - ai.jumpChancePerFrame, dtMs / 16.7);
    if (now - m.lastJumpAt >= ai.jumpGapMs && rand() < p) {
      m.mode = "windup";
      m.modeUntil = now + ai.windupMs;
      m.moving = false;
      m.facing = facingFor(target.x - m.x, target.y - m.y, m.facing);
      m.act = { k: "windup", at: now };
      return {};
    }
    return chaseStep(m, target, stats.speed * ai.creepFactor, dtMs, grid, leash);
  }
  return chaseStep(m, target, stats.speed, dtMs, grid, leash);
}

/** Chasers stop at touching distance instead of walking into you (even while they can't bite). */
const CHASE_STOP = CONTACT_RANGE * 0.85;

function chaseStep(m: MonsterState, target: Vec2, speed: number, dtMs: number, grid: CollisionGrid, leash: number): {} {
  if (dist(m, target) <= CHASE_STOP) {
    m.facing = facingFor(target.x - m.x, target.y - m.y, m.facing);
    m.moving = false;
    return {};
  }
  const r = stepToward(m, target, speed, dtMs, grid);
  m.facing = r.facing;
  if (dist(r, m.home) <= leash) {
    m.x = r.x;
    m.y = r.y;
    m.moving = r.moving;
  } else {
    m.moving = false;
  }
  return {};
}

function idle(m: MonsterState, grid: CollisionGrid, dtMs: number, rand: () => number): {} {
  if (m.mode === "dormant") {
    m.moving = false;
    return {};
  }
  const stats = MONSTER_STATS[m.type];
  if (dist(m, m.home) > m.radius) m.wanderTarget ??= { ...m.home };
  if (!m.wanderTarget) {
    m.moving = false;
    m.mode = "idle";
    if (rand() < dtMs / MONSTER_AI.wanderIdleMs) m.wanderTarget = pickWanderPoint(m, grid, rand);
    return {};
  }
  m.mode = "wander";
  if (walk(m, m.wanderTarget, stats.speed * MONSTER_AI.wanderSpeed, dtMs, grid)) m.wanderTarget = null;
  return {};
}
