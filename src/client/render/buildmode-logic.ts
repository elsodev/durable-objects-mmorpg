// Pure build-mode rules (no Pixi), so they can be unit tested and shared by the ghost renderer.
import { getItem } from "../../shared/items";
import { canPlace, footprint } from "../../shared/engine";
import type { ClientMsg } from "../../shared/protocol";
import type { FarmTile, Inventory, ItemId, MapData, PlacedObject, Vec2 } from "../../shared/types";

export type Rotation = 0 | 1 | 2 | 3;

export type BuildTarget =
  | { kind: "place"; slot: number; item: ItemId }
  | { kind: "move"; id: string; item: ItemId };

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  ok: boolean;
  reason?: string;
}

export function nextRotation(r: Rotation): Rotation {
  return ((r + 1) % 4) as Rotation;
}

/** Top-left tile so the footprint is centred under the (float) pointer tile. */
export function snapTopLeft(item: ItemId, rotation: Rotation, tile: Vec2): Vec2 {
  const { w, h } = footprint(item, rotation);
  return { x: Math.floor(tile.x - (w - 1) / 2), y: Math.floor(tile.y - (h - 1) / 2) };
}

/** Furniture item in an inventory slot, or the reason it can't be placed. */
export function furnitureInSlot(inv: Inventory, slot: number): { item: ItemId } | { reason: string } {
  const s = Number.isInteger(slot) ? inv.slots[slot] : undefined;
  if (!s || s.qty <= 0) return { reason: "That slot is empty." };
  const def = getItem(s.item);
  if (!def || def.kind !== "furniture" || !def.footprint) return { reason: "That can't be placed." };
  return { item: s.item };
}

export interface PlaceWorld {
  map: MapData | null;
  objects: PlacedObject[];
  farm: FarmTile[];
  occupied: Vec2[];
}

export function evaluate(target: BuildTarget, rotation: Rotation, tile: Vec2, w: PlaceWorld): Placement {
  const at = snapTopLeft(target.item, rotation, tile);
  const fp = footprint(target.item, rotation);
  const base = { x: at.x, y: at.y, w: fp.w, h: fp.h };
  if (!w.map) return { ...base, ok: false, reason: "Not loaded yet." };
  const res = canPlace(w.map, w.objects, w.farm, target.item, at.x, at.y, rotation, {
    ignoreId: target.kind === "move" ? target.id : undefined,
    occupied: w.occupied,
  });
  return res.ok ? { ...base, ok: true } : { ...base, ok: false, reason: res.reason };
}

export function buildMessage(target: BuildTarget, p: Placement, rotation: Rotation, req: string): ClientMsg {
  return target.kind === "place"
    ? { t: "place", slot: target.slot, x: p.x, y: p.y, rotation, req }
    : { t: "moveObject", id: target.id, x: p.x, y: p.y, rotation, req };
}
