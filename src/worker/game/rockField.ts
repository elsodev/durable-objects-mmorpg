// Breakable rocks of one map (zone caves, home yard): broken state, collision, respawn timers.
import type { MapData, Vec2 } from "../../shared/types";
import { setBlocked, type CollisionGrid } from "../../shared/engine";
import { ROCK_RESPAWN_MS, type Ore } from "./rocks";

export interface Rock {
  id: string;
  x: number;
  y: number;
  ore: Ore;
}

export class RockField {
  readonly rocks: Rock[];
  /** Broken rock id -> respawn time (ms epoch). */
  readonly broken = new Map<string, number>();

  constructor(map: MapData) {
    this.rocks = map.rocks ?? [];
  }

  /** Loads stored state and returns the unbroken rocks (for buildCollision). */
  load(stored: Record<string, number> | undefined): Rock[] {
    this.broken.clear();
    for (const [id, at] of Object.entries(stored ?? {})) {
      if (typeof at === "number" && this.rocks.some((r) => r.id === id)) this.broken.set(id, at);
    }
    return this.unbroken();
  }

  unbroken(): Rock[] {
    return this.rocks.filter((r) => !this.broken.has(r.id));
  }

  record(): Record<string, number> {
    return Object.fromEntries(this.broken);
  }

  brokenIds(): string[] {
    return [...this.broken.keys()];
  }

  at(tx: number, ty: number): Rock | null {
    return this.rocks.find((r) => r.x === tx && r.y === ty && !this.broken.has(r.id)) ?? null;
  }

  breakRock(rock: Rock, grid: CollisionGrid, now: number): void {
    this.broken.set(rock.id, now + ROCK_RESPAWN_MS);
    setBlocked(grid, rock.x, rock.y, 1, 1, false);
  }

  /**
   * Restores rocks whose timer ran out, except where someone stands (they would get stuck).
   * Returns restored ids.
   */
  respawnDue(grid: CollisionGrid, now: number, occupied: Vec2[]): string[] {
    const out: string[] = [];
    for (const [id, at] of this.broken) {
      if (now < at) continue;
      const r = this.rocks.find((k) => k.id === id);
      if (!r) {
        this.broken.delete(id);
        continue;
      }
      if (occupied.some((p) => Math.abs(p.x - (r.x + 0.5)) < 1 && Math.abs(p.y - (r.y + 0.5)) < 1)) continue;
      this.broken.delete(id);
      setBlocked(grid, r.x, r.y, 1, 1, true);
      out.push(id);
    }
    return out;
  }
}
