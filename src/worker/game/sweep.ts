// Plans one harvest `use`: by hand it picks the aimed tile; a scythe sweep also cuts the ripe crops
// on the tiles beside it (shared/engine/scythe.ts). Pure, so the rules are testable without a room:
// nothing changes until the caller applies the plan, and a full bag never destroys a crop.
import { addItem } from "../../shared/engine/inventory";
import type { HarvestRoll } from "../../shared/engine/harvest";
import type { FarmTile, Inventory, ItemId, Vec2 } from "../../shared/types";
import { cloneInventory } from "./sanitize";

export type HarvestPlan =
  | {
      ok: true;
      /** Tiles to harvest, the aimed tile first. */
      tiles: FarmTile[];
      /** Everything picked, merged per item (for the notice). */
      items: { item: ItemId; qty: number }[];
      /** Crops picked in all (for stats). */
      count: number;
      /** The bag with the crops added; the caller swaps it in. */
      inventory: Inventory;
    }
  | { ok: false; reason: string };

/**
 * `spots`: the aimed tile first, then any extra sweep tiles the caller has checked are in reach.
 * The aimed tile must be ripe and fit the bag; extra tiles are cut only while they are ripe and
 * their crops still fit (the sweep stops at the first that doesn't).
 */
export function planHarvest(
  spots: readonly Vec2[],
  farm: readonly FarmTile[],
  inv: Inventory,
  roll: (tile: FarmTile) => HarvestRoll | null,
): HarvestPlan {
  let bag = cloneInventory(inv);
  const tiles: FarmTile[] = [];
  const merged = new Map<ItemId, number>();
  let count = 0;
  for (const [i, spot] of spots.entries()) {
    const tile = farm.find((t) => t.x === spot.x && t.y === spot.y);
    const r = tile ? roll(tile) : null;
    if (!tile || !r) {
      if (i === 0) return { ok: false, reason: "Nothing to harvest." };
      continue;
    }
    if (tiles.includes(tile)) continue;
    const next = cloneInventory(bag);
    if (!r.items.every((it) => addItem(next, it.item, it.qty))) {
      if (i === 0) return { ok: false, reason: "Your bag is full." };
      break;
    }
    bag = next;
    tiles.push(tile);
    count += r.count;
    for (const it of r.items) merged.set(it.item, (merged.get(it.item) ?? 0) + it.qty);
  }
  return { ok: true, tiles, items: [...merged].map(([item, qty]) => ({ item, qty })), count, inventory: bag };
}
