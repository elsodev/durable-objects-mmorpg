// The friendly animals of one map: the village cats and dogs (ZoneRoom), or the pets and hens in a
// yard (HomeRoom). Server-authoritative wandering on the map's collision grid, ticked with
// everything else; nothing here awaits, so it never holds up the tick. In memory only: after a
// wake the animals start again from home, which nobody can tell apart from a stroll.
import type { Species } from "../../shared/animals";
import { ANIMAL_PREFIX } from "../../shared/animals";
import { canStand, type CollisionGrid } from "../../shared/engine";
import { animalGrid, animalStart, newAnimalMind, reactToLove, stepAnimal, type AnimalMind } from "../../shared/engine/animals";
import type { EntityState, MapExit, Vec2 } from "../../shared/types";

/** The animal grid is rebuilt from the map's grid this often, so felled trees or new furniture count. */
const GRID_REFRESH_MS = 2000;

export interface AnimalSpec {
  /** Without the "a:" prefix (village id, "pet_<id>" or "hen_<n>"). */
  id: string;
  name: string;
  sprite: string;
  species: Species;
  home: Vec2;
  radius: number;
}

interface Member {
  spec: AnimalSpec;
  entity: EntityState;
  mind: AnimalMind;
}

export class AnimalHerd {
  private members = new Map<string, Member>();
  private grid: CollisionGrid | null = null;
  private gridAt = -Infinity;

  constructor(
    private readonly baseGrid: () => CollisionGrid,
    private readonly exits: readonly MapExit[],
    private readonly rand: () => number,
  ) {}

  private walkable(now: number): CollisionGrid {
    if (!this.grid || now - this.gridAt >= GRID_REFRESH_MS) {
      this.grid = animalGrid(this.baseGrid(), this.exits);
      this.gridAt = now;
    }
    return this.grid;
  }

  /** Makes the herd exactly `specs` (new ones appear at home; gone ones leave). */
  sync(specs: readonly AnimalSpec[], now: number): void {
    const want = new Set(specs.map((s) => ANIMAL_PREFIX + s.id));
    for (const id of [...this.members.keys()]) if (!want.has(id)) this.members.delete(id);
    for (const s of specs) if (!this.members.has(ANIMAL_PREFIX + s.id)) this.add(s, now);
  }

  add(spec: AnimalSpec, now: number): EntityState {
    const grid = this.walkable(now);
    // A few tiles' scatter around home, so a herd that arrives together doesn't stack up.
    const near = { x: Math.floor(spec.home.x + (this.rand() - 0.5) * 4) + 0.5, y: Math.floor(spec.home.y + (this.rand() - 0.5) * 3) + 0.5 };
    const at = canStand(grid, near.x, near.y) ? near : animalStart(spec.home, grid);
    const entity: EntityState = {
      id: ANIMAL_PREFIX + spec.id,
      kind: "animal",
      name: spec.name,
      sprite: spec.sprite,
      x: at.x,
      y: at.y,
      facing: "down",
      moving: false,
    };
    this.members.set(entity.id, { spec, entity, mind: newAnimalMind(spec.species, spec.home, spec.radius, now, this.rand) });
    return entity;
  }

  get(entityId: string): { spec: AnimalSpec; entity: EntityState } | undefined {
    return this.members.get(entityId);
  }

  entities(): EntityState[] {
    return [...this.members.values()].map((m) => m.entity);
  }

  get size(): number {
    return this.members.size;
  }

  /** Moves everyone; true when anything moved or changed pose. */
  tick(dt: number, now: number): boolean {
    if (this.members.size === 0) return false;
    const grid = this.walkable(now);
    let changed = false;
    for (const m of this.members.values()) changed = stepAnimal(m.entity, m.mind, grid, dt, now, this.rand) || changed;
    return changed;
  }

  /** The animal stops, turns to `toward` and looks happy for a moment. */
  love(entityId: string, toward: Vec2, now: number): void {
    const m = this.members.get(entityId);
    if (m) reactToLove(m.entity, m.mind, toward, now);
  }
}
