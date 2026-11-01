// Cave treasure chests as the client sees them. Chests are per-player loot: everyone may open
// each chest once per spawn, and `opened` says whether YOU already did.

export interface ChestView {
  id: string;
  x: number;
  y: number;
  opened: boolean;
}

/** Interact target for a chest ("chest:<id>"), parsed by the zone. */
export const CHEST_TARGET_PREFIX = "chest:";
/** How far (tiles, feet to tile centre) a player may stand from a chest to open it. */
export const CHEST_REACH = 2;
