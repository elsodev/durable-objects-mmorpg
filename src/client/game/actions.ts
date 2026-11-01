// Pure targeting rules for "use" and "interact" (no DOM, no Pixi) so they are unit-testable.
import { facingTile } from "../../shared/engine/geometry";
import { getItem } from "../../shared/items";
import type { EntityState, Facing, Inventory, MapData, MapExit, Vec2, ZoneId } from "../../shared/types";

/** Max distance (tiles, feet to tile centre) for using an item on a clicked tile. */
export const USE_RANGE = 1.5;
/** Max distance for talking to an NPC or poking a prop. */
export const INTERACT_RANGE = 3;

export function floorTile(p: Vec2): Vec2 {
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

function distToTileCenter(from: Vec2, tile: Vec2): number {
  return Math.hypot(tile.x + 0.5 - from.x, tile.y + 0.5 - from.y);
}

/** Integer tile to use the selected item on: the clicked tile when in range, else the facing tile. */
export function useTarget(you: Vec2, facing: Facing, clicked?: Vec2 | null): Vec2 {
  if (clicked) {
    const t = floorTile(clicked);
    if (distToTileCenter(you, t) <= USE_RANGE) return t;
  }
  return facingTile(you, facing);
}

/** True when the clicked tile is close enough to use the selected item on it. */
export function inUseRange(you: Vec2, clicked: Vec2): boolean {
  return distToTileCenter(you, floorTile(clicked)) <= USE_RANGE;
}

/** Nearest NPC within range (F key). */
export function nearestNpc(you: Vec2, entities: readonly EntityState[], range = INTERACT_RANGE): string | null {
  let best: string | null = null;
  let bestD = range;
  for (const e of entities) {
    if (e.kind !== "npc") continue;
    const d = Math.hypot(e.x - you.x, e.y - you.y);
    if (d <= bestD) {
      bestD = d;
      best = e.id;
    }
  }
  return best;
}

export function withinInteract(you: Vec2, target: Vec2): boolean {
  return Math.hypot(target.x - you.x, target.y - you.y) <= INTERACT_RANGE;
}

/** Item in a slot if it is something you "use" on a tile (tools and seeds). */
export function usableItem(inv: Inventory, slot: number): string | null {
  const s = inv.slots[slot];
  if (!s || s.qty <= 0) return null;
  const def = getItem(s.item);
  return def && (def.kind === "tool" || def.kind === "seed") ? s.item : null;
}

/**
 * Like usableItem, but only for items that do something in this zone: farming tools and seeds
 * work only on the home farm, while pickaxes and swords work everywhere (rocks, monsters).
 * Clicks with anything else just walk, instead of asking the server for a "Nothing to do" reject.
 */
export function usableHere(inv: Inventory, slot: number, zone: ZoneId | null): string | null {
  const item = usableItem(inv, slot);
  if (!item || zone === "home") return item;
  const tool = getItem(item)?.tool;
  return tool === "pickaxe" || tool === "sword" ? item : null;
}

/** Interact target for a prop: the shipping bin sells the selected stack, other props take their id. */
export function propTarget(map: MapData | null, propId: string, selectedSlot: number): string {
  const prop = map?.props.find((p) => p.id === propId);
  return prop?.type === "shipping_bin" ? `${propId}:${selectedSlot}` : propId;
}

export function isFurnitureSlot(inv: Inventory, slot: number): boolean {
  const s = inv.slots[slot];
  return !!s && s.qty > 0 && getItem(s.item)?.kind === "furniture";
}

/** Sound key for using the item in a slot (audio module maps keys to files). */
export function sfxForUse(inv: Inventory, slot: number): string {
  const s = inv.slots[slot];
  const def = s ? getItem(s.item) : undefined;
  if (!def) return "use";
  if (def.tool) return `tool_${def.tool}`;
  if (def.kind === "seed") return "plant";
  return "use";
}

/**
 * The exit a guest was trying to take when the server answered needAccount (or the socket was
 * refused): the nearest exit to a shared zone, preferring exits that lead to `preferTo`.
 */
export function exitNear(map: MapData, pos: Vec2, preferTo?: ZoneId): MapExit | null {
  const shared = map.exits.filter((e) => e.to !== "home");
  const preferred = preferTo ? shared.filter((e) => e.to === preferTo) : [];
  let best: MapExit | null = null;
  let bestD = Infinity;
  for (const e of preferred.length ? preferred : shared) {
    const cx = Math.min(Math.max(pos.x, e.x), e.x + e.w);
    const cy = Math.min(Math.max(pos.y, e.y), e.y + e.h);
    const d = Math.hypot(cx - pos.x, cy - pos.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Chat line origin -> HUD style. Server/system lines have no entity id. */
export function chatKind(from: string): "player" | "npc" | "system" {
  if (from.startsWith("n:")) return "npc";
  if (from.startsWith("p:")) return "player";
  return "system";
}

/** Short unique tags for `req`, echoed by `reject`. */
export function createReqIds(prefix = "r"): () => string {
  let n = 0;
  return () => `${prefix}${(++n).toString(36)}`;
}
