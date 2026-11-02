// The flashlight: a rare cave find that you never equip. While one is anywhere in your bag, caves
// are drawn fully lit instead of dark with a small circle of light around you. Pure.
import type { Inventory } from "./types";

export const FLASHLIGHT = "flashlight";

/** True when the bag holds a flashlight (any slot, hotbar or not). */
export function hasFlashlight(inv: Inventory | null | undefined): boolean {
  return !!inv?.slots.some((s) => s?.item === FLASHLIGHT && s.qty > 0);
}
