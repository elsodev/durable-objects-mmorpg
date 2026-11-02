// Monsters of one zone: player-scaled spawn groups (shared/spawns.ts), AI every tick, weapon
// strikes with rolls, knockback and i-frames, and per-player loot shares on a kill.
import type { EntityState, Facing, MapData, MonsterSpawn, SharedZoneId, Vec2 } from "../../shared/types";
import {
  dist,
  inSwingArc,
  knockbackFrom,
  lootShares,
  MONSTER_IFRAME_MS,
  MONSTER_STATS,
  levelStats,
  newMonster,
  outsideSafeAreas,
  pickSpawnPoint,
  provoke,
  respawnDelayMs,
  rollHit,
  safeSpots,
  spawnTarget,
  stepMonster,
  zoneMonsterCap,
  type CollisionGrid,
  type Knockback,
  type MonsterState,
} from "../../shared/engine";
import type { WeaponStats } from "../../shared/engine/toolRules";
import {
  defaultTuning,
  DESPAWN_IDLE_MS,
  SPAWN_CHECK_MS,
  SPAWN_NEAR_MARGIN,
  SPAWN_TRIES,
  SPAWN_TUNING,
  type SpawnTuning,
} from "../../shared/spawns";

/** Tool hits land on the monster nearest the aimed tile centre within this. */
export const HIT_RADIUS = 1.1;

interface Group {
  spec: MonsterSpawn;
  tune: SpawnTuning;
  nextSpawnAt: number;
  /** Players near it at the last check (scales the refill after a death). */
  near: number;
}

/** One monster hit by one swing. */
export interface StrikeHit {
  m: MonsterState;
  dmg: number;
  crit: boolean;
  miss: boolean;
  kb: Knockback | null;
  /** Set when this hit killed it: entity ids of the players who get a loot roll. */
  killedFor?: string[];
}

export class MonsterPool {
  readonly list: MonsterState[] = [];
  private readonly groups: Group[];
  private seq = 0;
  private nextCheck = 0;
  /** Spawn points and exits: nothing appears near them (SPAWN_SAFE_RADIUS). */
  private readonly safe: Vec2[];
  /** Live monsters this zone may hold at once (zoneMonsterCap). */
  readonly cap: number;

  constructor(
    map: MapData,
    private readonly grid: CollisionGrid,
    private readonly rand: () => number,
    zone?: SharedZoneId,
    now = 0,
  ) {
    this.safe = safeSpots(map);
    this.cap = zoneMonsterCap(zone);
    const table = zone ? SPAWN_TUNING[zone] : undefined;
    this.groups = map.monsters.map((spec, i) => ({ spec, tune: table?.[i] ?? spec.tuning ?? defaultTuning(spec.count), nextSpawnAt: 0, near: 1 }));
    // A waking zone starts at its base numbers (nobody is in yet).
    this.groups.forEach((g, i) => {
      for (let n = 0; n < g.tune.base; n++) this.spawnIn(g, i, [], now, true);
    });
  }

  alive(): MonsterState[] {
    return this.list;
  }

  /** Live monsters a group currently wants with these players around. */
  targetFor(i: number, players: readonly Vec2[]): number {
    const g = this.groups[i];
    return g ? spawnTarget(g.tune, this.playersNear(g, players)) : 0;
  }

  countIn(i: number): number {
    return this.list.reduce((n, m) => n + (m.group === i ? 1 : 0), 0);
  }

  /** Steps AI and the spawn groups. Returns bites to apply to players. */
  tick(players: EntityState[], dtMs: number, now: number): { playerId: string; damage: number; from: string }[] {
    const hits: { playerId: string; damage: number; from: string }[] = [];
    for (const m of this.list) {
      const r = stepMonster(m, players, this.grid, dtMs, now, this.rand);
      if (r.hit) hits.push({ ...r.hit, from: m.id });
    }
    if (now >= this.nextCheck) {
      this.nextCheck = now + SPAWN_CHECK_MS;
      this.refill(players, now);
    }
    return hits;
  }

  private playersNear(g: Group, players: readonly Vec2[]): number {
    const r = g.spec.radius + SPAWN_NEAR_MARGIN;
    return players.reduce((n, p) => n + (dist(p, g.spec) <= r ? 1 : 0), 0);
  }

  /** One spawn per group per check while below target; one quiet extra despawns when above. */
  private refill(players: EntityState[], now: number): void {
    const live = players.filter((p) => p.kind === "player");
    this.groups.forEach((g, i) => {
      const near = this.playersNear(g, live);
      g.near = near;
      const target = spawnTarget(g.tune, near);
      const count = this.countIn(i);
      if (count < target && now >= g.nextSpawnAt && this.list.length < this.cap) {
        if (this.spawnIn(g, i, live, now, false)) g.nextSpawnAt = now + respawnDelayMs(g.tune, near, count + 1, target);
      } else if (count > target) {
        const quiet = this.list.findIndex(
          (m) => m.group === i && (m.mode === "idle" || m.mode === "wander" || m.mode === "dormant") && now - m.lastCombatAt >= DESPAWN_IDLE_MS,
        );
        if (quiet >= 0) this.list.splice(quiet, 1);
      }
    });
  }

  private spawnIn(g: Group, i: number, players: readonly Vec2[], now: number, initial: boolean): boolean {
    const home = { x: g.spec.x, y: g.spec.y };
    const safe = (q: Vec2) => outsideSafeAreas(q, this.safe);
    const p =
      pickSpawnPoint(home, g.spec.radius, this.grid, players, initial ? 0 : g.tune.minPlayerDist, this.rand, SPAWN_TRIES, safe) ??
      (initial ? home : null);
    if (!p) return false;
    this.list.push(newMonster(`m:${++this.seq}`, g.spec.type, p, home, g.spec.radius, i, now, g.spec.level));
    return true;
  }

  /** Monster nearest to the target tile centre within HIT_RADIUS. */
  targetAt(tx: number, ty: number): MonsterState | null {
    const c = { x: tx + 0.5, y: ty + 0.5 };
    let best: MonsterState | null = null;
    let bd = HIT_RADIUS;
    for (const m of this.list) {
      const d = dist(m, c);
      if (d <= bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  /** Every monster inside a sword sweep from `origin` toward `facing`. */
  inArc(origin: Vec2, facing: Facing): MonsterState[] {
    return this.list.filter((m) => (m.hp ?? 0) > 0 && inSwingArc(origin, facing, m));
  }

  /**
   * Swings `weapon` at `targets` for `attacker` (a player entity): monsters still invincible
   * from an earlier hit are skipped; the rest roll damage, get pushed and turn on the attacker.
   */
  strike(attacker: EntityState, targets: readonly MonsterState[], weapon: WeaponStats, now: number): StrikeHit[] {
    const out: StrikeHit[] = [];
    for (const m of targets) {
      if (now < m.iframeUntil || (m.hp ?? 0) <= 0) continue;
      const stats = MONSTER_STATS[m.type];
      const roll = rollHit(weapon, levelStats(m.type, m.level).defense, stats.missChance, this.rand);
      provoke(m, attacker.id, now);
      if (roll.miss) {
        out.push({ m, dmg: 0, crit: false, miss: true, kb: null });
        continue;
      }
      const dealt = Math.min(roll.dmg, m.hp ?? 0);
      m.hp = (m.hp ?? 0) - roll.dmg;
      m.damageBy[attacker.id] = (m.damageBy[attacker.id] ?? 0) + dealt;
      m.iframeUntil = now + MONSTER_IFRAME_MS;
      const kb = knockbackFrom(attacker, m, weapon.knockback, attacker.facing);
      m.leap = null;
      if (m.mode === "leap" || m.mode === "windup") m.mode = "chase";
      const hit: StrikeHit = { m, dmg: roll.dmg, crit: roll.crit, miss: false, kb };
      if (m.hp <= 0) {
        m.hp = 0;
        m.kb = null;
        hit.killedFor = lootShares(m.damageBy, m.maxHp ?? stats.hp, attacker.id);
        this.remove(m, now);
      } else m.kb = kb;
      out.push(hit);
    }
    return out;
  }

  /** A death frees its group's slot; the group refills after its delay. */
  private remove(m: MonsterState, now: number): void {
    const i = this.list.indexOf(m);
    if (i >= 0) this.list.splice(i, 1);
    const g = this.groups[m.group];
    if (g) g.nextSpawnAt = Math.max(g.nextSpawnAt, now + respawnDelayMs(g.tune, g.near, this.countIn(m.group), spawnTarget(g.tune, g.near)));
  }
}

/** How far an aimed (non-sword) hit reaches, from the attacker's feet, when the swing lands. */
export const AIMED_REACH = 2.5;

/**
 * Who a swing hits when it lands: a sword sweeps the arc in front of the attacker (facing as the
 * swing started); any other tool hits the monster it was aimed at if it is still alive and close.
 */
export function strikeTargets(
  pool: Pick<MonsterPool, "alive" | "inArc">,
  attacker: Vec2,
  facing: Facing,
  weapon: Pick<WeaponStats, "arc">,
  aimedId: string | null,
): MonsterState[] {
  if (weapon.arc) return pool.inArc(attacker, facing);
  const m = aimedId ? pool.alive().find((x) => x.id === aimedId) : undefined;
  return m && (m.hp ?? 0) > 0 && dist(m, attacker) <= AIMED_REACH ? [m] : [];
}
