// Tracks what was last broadcast per entity so each tick only carries changes.
import type { EntityState } from "../../shared/types";

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Copy with positions rounded so float noise doesn't count as a change and frames stay small. */
export function snapshotEntity(e: EntityState): EntityState {
  const s: EntityState = {
    id: e.id,
    kind: e.kind,
    name: e.name,
    sprite: e.sprite,
    x: round(e.x),
    y: round(e.y),
    facing: e.facing,
    moving: e.moving,
  };
  if (e.hp !== undefined) s.hp = e.hp;
  if (e.maxHp !== undefined) s.maxHp = e.maxHp;
  if (e.status !== undefined) s.status = e.status;
  if (e.look !== undefined) s.look = e.look;
  if (e.act !== undefined) s.act = e.act;
  if (e.held !== undefined) s.held = e.held;
  return s;
}

export class EntityDiffer {
  private last = new Map<string, string>();

  /** Compares the current entity set with the last call; returns changed/new and removed. */
  diff(entities: Iterable<EntityState>): { upd: EntityState[]; del: string[] } {
    const upd: EntityState[] = [];
    const seen = new Set<string>();
    for (const e of entities) {
      const snap = snapshotEntity(e);
      const key = JSON.stringify(snap);
      seen.add(e.id);
      if (this.last.get(e.id) !== key) {
        this.last.set(e.id, key);
        upd.push(snap);
      }
    }
    const del: string[] = [];
    for (const id of this.last.keys()) {
      if (!seen.has(id)) {
        del.push(id);
        this.last.delete(id);
      }
    }
    return { upd, del };
  }

  reset(): void {
    this.last.clear();
  }
}
