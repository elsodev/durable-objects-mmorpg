// Treasure chests of one zone (the caves). Each chest spawns on a random open floor tile, every
// player may open it once (loot is rolled per player), and CHEST_RESPAWN_MS after the first
// opening it moves to a new random spot as a fresh chest that everyone may open again.
// Pure state + rules; ZoneRoom persists record() and sends views.
import { canStand, isBlocked, setBlocked, type CollisionGrid } from "../../shared/engine";
import { Ground, type ItemId, type MapData, type Vec2 } from "../../shared/types";
import type { ChestView } from "../../shared/chests";
import { weightedPick } from "../npc/giftTables";
import { DEFAULT_DROP_RATES, isRareDrop, rollDrop, type DropRates } from "../../shared/engine/dropRate";

export const CHEST_RESPAWN_MS = 10 * 60 * 1000;
/** Players remembered per chest spawn (beyond this the oldest openers may open it again). */
const MAX_OPENERS = 500;
const SPAWN_TRIES = 400;
/** Keep chests away from arrival spots and doors, and apart from each other. */
const SPAWN_CLEARANCE = 6;
const EXIT_CLEARANCE = 3;
const CHEST_SPACING = 8;

export interface Chest {
  id: string;
  x: number;
  y: number;
  /** Spawn number of this chest id; bumps on every respawn. */
  gen: number;
  /** User ids that opened this spawn. */
  openedBy: string[];
  /** When this spawn moves on (set by the first opening). */
  respawnAt: number | null;
}

export interface Loot {
  coins: number;
  items: { item: ItemId; qty: number }[];
}

/** The chest's main roll: one of these, by weight (always at least one). */
export const CHEST_TABLE: readonly { value: { item: ItemId; min: number; max: number }; weight: number }[] = [
  { value: { item: "stone", min: 3, max: 6 }, weight: 22 },
  { value: { item: "ore_copper", min: 2, max: 4 }, weight: 26 },
  { value: { item: "ore_iron", min: 1, max: 3 }, weight: 18 },
];

/** Chance of a second roll on CHEST_TABLE (scales with DROP_RATE_CHEST). */
export const CHEST_EXTRA_ROLL = 0.4;

/**
 * Bonus finds, each rolled on its own (DROP_RATE_CHEST, or DROP_RATE_RARE for rare items):
 * "furniture" is a piece from CHEST_FURNITURE.
 */
export const CHEST_BONUS: readonly { item: ItemId | "furniture"; min: number; max: number; chance: number }[] = [
  { item: "ore_silver", min: 1, max: 2, chance: 0.12 },
  { item: "gem_crystal", min: 1, max: 1, chance: 0.12 },
  { item: "furniture", min: 1, max: 1, chance: 0.08 },
  { item: "ore_gold", min: 1, max: 1, chance: 0.03 },
  { item: "gem_diamond", min: 1, max: 1, chance: 0.003 },
];

/** Cave-flavoured furniture a chest may hold. */
export const CHEST_FURNITURE: readonly { value: ItemId; weight: number }[] = [
  { value: "barrel", weight: 5 },
  { value: "crate", weight: 5 },
  { value: "sack", weight: 4 },
  { value: "candle", weight: 4 },
  { value: "ore_crate", weight: 3 },
  { value: "coal_pile", weight: 2 },
  { value: "wall_sconce", weight: 2 },
  { value: "mine_cart", weight: 1 },
  { value: "painting_landscape", weight: 1 },
];

export const CHEST_COINS = { min: 15, max: 60 } as const;

const between = (min: number, max: number, rand: () => number) => min + Math.floor(rand() * (max - min + 1));

/** Rolls one chest's loot for one player. */
/** Loot worth a held-over-the-head moment: furniture, gems and gold (the rare rolls). */
export function isRareLoot(item: ItemId): boolean {
  return isRareDrop(item);
}

export function rollChestLoot(rand: () => number, rates: Readonly<DropRates> = DEFAULT_DROP_RATES): Loot {
  const coins = between(CHEST_COINS.min, CHEST_COINS.max, rand);
  const items: Loot["items"] = [];
  const add = (item: ItemId, qty: number) => {
    const same = items.find((x) => x.item === item);
    if (same) same.qty += qty;
    else items.push({ item, qty });
  };
  const rolls = rollDrop(CHEST_EXTRA_ROLL, "chest", rand, rates) ? 2 : 1;
  for (let i = 0; i < rolls; i++) {
    const r = weightedPick(CHEST_TABLE, rand);
    if (r) add(r.item, between(r.min, r.max, rand));
  }
  for (const b of CHEST_BONUS) {
    const rare = b.item === "furniture" || isRareDrop(b.item);
    if (!rollDrop(b.chance, "chest", rand, rates, rare)) continue;
    const item = b.item === "furniture" ? weightedPick(CHEST_FURNITURE, rand) : b.item;
    if (item) add(item, between(b.min, b.max, rand));
  }
  return { coins, items };
}

export class ChestField {
  readonly chests: Chest[] = [];

  constructor(
    private readonly map: MapData,
    private readonly count: number,
  ) {}

  /**
   * Restores stored chests (dropping any whose tile is no longer open floor) and spawns the rest.
   * Marks every chest tile blocked in `grid`.
   */
  load(stored: unknown, grid: CollisionGrid, rand: () => number): void {
    this.chests.length = 0;
    const list = Array.isArray(stored) ? stored : [];
    for (let i = 0; i < this.count; i++) {
      const id = `chest${i}`;
      const s = list.find((c: unknown) => !!c && typeof c === "object" && (c as Chest).id === id) as Partial<Chest> | undefined;
      const ok = s && Number.isInteger(s.x) && Number.isInteger(s.y) && this.isSpot(grid, s.x!, s.y!, []);
      if (ok) {
        this.chests.push({
          id,
          x: s.x!,
          y: s.y!,
          gen: Number.isInteger(s.gen) ? s.gen! : 0,
          openedBy: Array.isArray(s.openedBy) ? s.openedBy.filter((u): u is string => typeof u === "string").slice(-MAX_OPENERS) : [],
          respawnAt: typeof s.respawnAt === "number" ? s.respawnAt : null,
        });
        setBlocked(grid, s.x!, s.y!, 1, 1, true);
      } else {
        const at = this.pickSpot(grid, rand, []);
        if (!at) continue;
        this.chests.push({ id, ...at, gen: 0, openedBy: [], respawnAt: null });
        setBlocked(grid, at.x, at.y, 1, 1, true);
      }
    }
  }

  record(): Chest[] {
    return this.chests.map((c) => ({ ...c, openedBy: [...c.openedBy] }));
  }

  get(id: string): Chest | undefined {
    return this.chests.find((c) => c.id === id);
  }

  views(userId: string): ChestView[] {
    return this.chests.map((c) => ({ id: c.id, x: c.x, y: c.y, opened: c.openedBy.includes(userId) }));
  }

  /**
   * Opens a chest for a player: false when they already opened this spawn. The first opening
   * starts the respawn timer.
   */
  open(chest: Chest, userId: string, now: number): boolean {
    if (chest.openedBy.includes(userId)) return false;
    chest.openedBy.push(userId);
    if (chest.openedBy.length > MAX_OPENERS) chest.openedBy.shift();
    chest.respawnAt ??= now + CHEST_RESPAWN_MS;
    return true;
  }

  /**
   * Moves chests whose timer ran out to a new random spot (never under anyone), as a fresh spawn.
   * Returns true if any chest moved.
   */
  respawnDue(grid: CollisionGrid, now: number, occupied: Vec2[], rand: () => number): boolean {
    let moved = false;
    for (const c of this.chests) {
      if (c.respawnAt === null || now < c.respawnAt) continue;
      setBlocked(grid, c.x, c.y, 1, 1, false);
      const at = this.pickSpot(grid, rand, occupied);
      if (!at) {
        setBlocked(grid, c.x, c.y, 1, 1, true);
        continue;
      }
      Object.assign(c, at, { gen: c.gen + 1, openedBy: [], respawnAt: null });
      setBlocked(grid, c.x, c.y, 1, 1, true);
      moved = true;
    }
    return moved;
  }

  /**
   * A chest spot: cave floor where the tile and all eight neighbours are open (so a chest never
   * plugs a tunnel), away from arrival spots, exits and the other chests, with nobody on it.
   */
  isSpot(grid: CollisionGrid, x: number, y: number, occupied: Vec2[], self?: Chest): boolean {
    const m = this.map;
    if (m.ground[y * m.width + x] !== Ground.Stone) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (isBlocked(grid, x + dx, y + dy)) return false;
    }
    if (!canStand(grid, x + 0.5, y + 0.5)) return false;
    // Not on or beside a rock (a broken one comes back and would bury the chest).
    if (m.rocks?.some((r) => Math.abs(r.x - x) <= 1 && Math.abs(r.y - y) <= 1)) return false;
    if (Object.values(m.spawns).some((s) => Math.hypot(s.x - x, s.y - y) < SPAWN_CLEARANCE)) return false;
    if (m.exits.some((e) => x >= e.x - EXIT_CLEARANCE && x < e.x + e.w + EXIT_CLEARANCE && y >= e.y - EXIT_CLEARANCE && y < e.y + e.h + EXIT_CLEARANCE)) return false;
    if (this.chests.some((c) => c !== self && Math.hypot(c.x - x, c.y - y) < CHEST_SPACING)) return false;
    if (occupied.some((p) => Math.abs(p.x - (x + 0.5)) < 1.5 && Math.abs(p.y - (y + 0.5)) < 1.5)) return false;
    return true;
  }

  private pickSpot(grid: CollisionGrid, rand: () => number, occupied: Vec2[]): { x: number; y: number } | null {
    const m = this.map;
    for (let i = 0; i < SPAWN_TRIES; i++) {
      const x = Math.floor(rand() * m.width);
      const y = Math.floor(rand() * m.height);
      if (this.isSpot(grid, x, y, occupied)) return { x, y };
    }
    return null;
  }
}
