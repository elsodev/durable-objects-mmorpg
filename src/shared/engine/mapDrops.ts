// Rolls a map's own drop tables (MapData.drops, from JSON maps). Pure: the server passes its rand.
import type { ItemId, MapDrops, MapDropEntry } from "../types";
import { DEFAULT_DROP_RATES, rollDrop, type DropRates } from "./dropRate";
import { weightedItem } from "./spawning";

/** One entry by weight, with its qty rolled in [min, max]; null for an empty table. */
export function rollDropEntry(table: readonly MapDropEntry[], rand: () => number): { item: ItemId; qty: number } | null {
  const e = weightedItem(table, rand);
  if (!e) return null;
  const lo = Math.min(e.min, e.max);
  const hi = Math.max(e.min, e.max);
  return { item: e.item, qty: lo + Math.floor(rand() * (hi - lo + 1)) };
}

/** The map's extra find for one kill, if the chance (scaled by DROP_RATE_MONSTER) comes up. */
export function rollKillDrop(drops: MapDrops | undefined, rand: () => number, rates: Readonly<DropRates> = DEFAULT_DROP_RATES): { item: ItemId; qty: number } | null {
  const kill = drops?.kill;
  if (!kill || !rollDrop(kill.chance, "monster", rand, rates)) return null;
  return rollDropEntry(kill.table, rand);
}

/** Adds `extra` into `loot`, stacking onto a line of the same item. */
export function mergeLoot(loot: { item: ItemId; qty: number }[], extra: { item: ItemId; qty: number } | null): { item: ItemId; qty: number }[] {
  if (!extra || extra.qty <= 0) return loot;
  const same = loot.find((l) => l.item === extra.item);
  if (same) same.qty += extra.qty;
  else loot.push({ ...extra });
  return loot;
}
