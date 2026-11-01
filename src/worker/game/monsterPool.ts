// Monsters of one zone: spawned from MapData.monsters, stepped every tick, respawn after death.
import type { EntityState, MapData, Vec2 } from "../../shared/types";
import {
  canStand,
  dist,
  MONSTER_RESPAWN_MS,
  MONSTER_STATS,
  rollDrops,
  stepMonster,
  type CollisionGrid,
  type MonsterState,
} from "../../shared/engine";

/** Sword hits land on monsters this close to the targeted tile centre. */
export const HIT_RADIUS = 1.1;

function spawnPoint(home: Vec2, radius: number, grid: CollisionGrid, rand: () => number): Vec2 {
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * radius;
    const p = { x: home.x + Math.cos(a) * r, y: home.y + Math.sin(a) * r };
    if (canStand(grid, p.x, p.y)) return p;
  }
  return { ...home };
}

export class MonsterPool {
  readonly list: MonsterState[] = [];

  constructor(map: MapData, private readonly grid: CollisionGrid, private readonly rand: () => number) {
    let n = 0;
    for (const s of map.monsters) {
      for (let i = 0; i < s.count; i++) {
        const home = { x: s.x, y: s.y };
        const p = spawnPoint(home, s.radius, grid, rand);
        const hp = MONSTER_STATS[s.type].hp;
        this.list.push({
          id: `m:${++n}`,
          kind: "monster",
          type: s.type,
          name: s.type.replace("_", " "),
          sprite: s.type,
          x: p.x,
          y: p.y,
          facing: "down",
          moving: false,
          hp,
          maxHp: hp,
          home,
          radius: s.radius,
          targetId: null,
          cooldownMs: 0,
          respawnAt: null,
          wanderTarget: null,
        });
      }
    }
  }

  alive(): MonsterState[] {
    return this.list.filter((m) => m.respawnAt === null);
  }

  /** Steps AI and handles respawns. Returns bites to apply to players. */
  tick(players: EntityState[], dtMs: number, now: number): { playerId: string; damage: number }[] {
    const hits: { playerId: string; damage: number }[] = [];
    for (const m of this.list) {
      if (m.respawnAt !== null) {
        if (now >= m.respawnAt) this.respawn(m);
        continue;
      }
      const r = stepMonster(m, players, this.grid, dtMs, now, this.rand);
      if (r.hit) hits.push(r.hit);
    }
    return hits;
  }

  /** Monster nearest to the target tile centre within HIT_RADIUS. */
  targetAt(tx: number, ty: number): MonsterState | null {
    const c = { x: tx + 0.5, y: ty + 0.5 };
    let best: MonsterState | null = null;
    let bd = HIT_RADIUS;
    for (const m of this.list) {
      if (m.respawnAt !== null) continue;
      const d = dist(m, c);
      if (d <= bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  /** Applies damage; returns drops if this hit killed it, else null. */
  hit(m: MonsterState, damage: number, now: number): { item: string; qty: number }[] | null {
    m.hp = Math.max(0, (m.hp ?? 0) - damage);
    if (m.hp > 0) return null;
    m.respawnAt = now + MONSTER_RESPAWN_MS;
    m.moving = false;
    m.targetId = null;
    return rollDrops(m.type, this.rand);
  }

  private respawn(m: MonsterState): void {
    const p = spawnPoint(m.home, m.radius, this.grid, this.rand);
    Object.assign(m, {
      x: p.x,
      y: p.y,
      hp: m.maxHp,
      respawnAt: null,
      targetId: null,
      cooldownMs: 0,
      wanderTarget: null,
      moving: false,
    });
  }
}
