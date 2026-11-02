// Breakable rocks of one map (zone caves, home yard): broken state, collision, respawn timers,
// and which ore each rock holds this spawn (caves rocks may come back as silver, gold or diamond).
import type { MapData, Vec2 } from "../../shared/types";
import { setBlocked, type CollisionGrid } from "../../shared/engine";
import { rockOreAt } from "../../shared/engine/rockOres";
import { DEFAULT_DROP_RATES, type DropRates } from "../../shared/engine/dropRate";
import { ROCK_RESPAWN_MS, type Ore } from "./rocks";

export interface Rock {
  id: string;
  x: number;
  y: number;
  ore: Ore;
  /** JSON maps: this rock's own odds of coming back rarer. */
  odds?: { silver: number; gold: number; diamond: number };
}

export class RockField {
  /** Rocks as the map places them (`ore` is the base ore; see oreOf for this spawn's). */
  readonly rocks: Rock[];
  /** Broken rock id -> respawn time (ms epoch). */
  readonly broken = new Map<string, number>();
  /** Rock id -> times it has broken; seeds its next drops so a retry can't reroll them. */
  readonly spawns = new Map<string, number>();

  /**
   * `scope` seeds the ore rolls (zone id, or the home owner); `rates` scale the chance of rarer
   * ores. Both stay fixed for the life of the field, so a rock's ore never changes under a player.
   */
  constructor(
    map: MapData,
    private readonly scope = "",
    private readonly rates: Readonly<DropRates> = DEFAULT_DROP_RATES,
  ) {
    this.rocks = map.rocks ?? [];
  }

  /** The ore `rock` holds on its current spawn. */
  oreOf(rock: { id: string; ore: Ore }): Ore {
    return rockOreAt(rock, this.scope, this.spawnOf(rock.id), this.rates);
  }

  /** Rocks whose current ore differs from the map's (for clients, which only know the map). */
  oreOverrides(): Record<string, Ore> {
    const out: Record<string, Ore> = {};
    for (const r of this.rocks) {
      const ore = this.oreOf(r);
      if (ore !== r.ore) out[r.id] = ore;
    }
    return out;
  }

  /** Loads stored state and returns the unbroken rocks (for buildCollision). */
  load(stored: Record<string, number> | undefined, spawns?: unknown): Rock[] {
    this.broken.clear();
    this.spawns.clear();
    for (const [id, at] of Object.entries(stored ?? {})) {
      if (typeof at === "number" && this.rocks.some((r) => r.id === id)) this.broken.set(id, at);
    }
    if (spawns && typeof spawns === "object") {
      for (const [id, n] of Object.entries(spawns as Record<string, unknown>)) {
        if (typeof n === "number" && Number.isInteger(n) && n > 0 && this.rocks.some((r) => r.id === id)) this.spawns.set(id, n);
      }
    }
    return this.unbroken();
  }

  /** How many times `id` has broken so far (its current spawn number). */
  spawnOf(id: string): number {
    return this.spawns.get(id) ?? 0;
  }

  spawnRecord(): Record<string, number> {
    return Object.fromEntries(this.spawns);
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

  /** A rock by id with this spawn's ore (null for unknown ids). */
  byId(id: string): Rock | null {
    const r = this.rocks.find((k) => k.id === id);
    return r ? { ...r, ore: this.oreOf(r) } : null;
  }

  /** The unbroken rock on a tile, with this spawn's ore. */
  at(tx: number, ty: number): Rock | null {
    const r = this.rocks.find((k) => k.x === tx && k.y === ty && !this.broken.has(k.id));
    return r ? { ...r, ore: this.oreOf(r) } : null;
  }

  breakRock(rock: Pick<Rock, "id" | "x" | "y">, grid: CollisionGrid, now: number): void {
    this.broken.set(rock.id, now + ROCK_RESPAWN_MS);
    this.spawns.set(rock.id, this.spawnOf(rock.id) + 1);
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
