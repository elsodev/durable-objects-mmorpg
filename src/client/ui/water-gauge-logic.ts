// Watering can level for its slot gauge: which items carry it, how full, and its label.
import type { ItemId } from "../../shared/types";

export interface WaterLevel {
  water: number;
  max: number;
}

/** Items that carry the gauge. */
export function holdsWater(item: ItemId): boolean {
  return item === "watering_can";
}

/** Fill 0..1 for `item`, or null when it has no gauge or the level isn't known yet. */
export function gaugeFill(item: ItemId, level: WaterLevel | null): number | null {
  if (!holdsWater(item) || !level || !(level.max > 0)) return null;
  const f = level.water / level.max;
  return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : null;
}

/** "Water 12/20", for the slot's label and tooltip. */
export function gaugeLabel(level: WaterLevel): string {
  return level.water <= 0 ? "Empty: refill at the well or the pond" : `Water ${level.water}/${level.max}`;
}
