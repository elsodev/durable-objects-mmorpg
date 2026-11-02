// What edit mode shows for its current state, as plain data (no Pixi, no DOM): the ghosts of a
// drag, of a move waiting for the server and of a piece held from the bag, and what the floating
// toolbar offers. edit-mode.ts hands these to render/edit-view.ts and ui/edit-ui.ts.
import { canPlace, type ArrangeMove } from "../../shared/engine";
import { getItem } from "../../shared/items";
import type { ItemId, PlacedObject, Vec2 } from "../../shared/types";
import type { EditGhost } from "../render/edit-view";
import type { EditToolbarState } from "../ui/edit-ui";
import { checkMoves, groupMoves, type ArrangeWorld, type Rotation } from "./edit-logic";

/** A piece taken from the bag tray: its slot, item, turn and the top-left of its ghost. */
export interface HeldPiece {
  slot: number;
  item: ItemId;
  rotation: Rotation;
  at: Vec2 | null;
}

const turns = (item: ItemId) => (getItem(item)?.rotations?.length ?? 1) > 1;

/** Dragged pieces at their new spots: all green if the whole group fits, else all red. */
export function dragGhosts(w: ArrangeWorld, pieces: readonly PlacedObject[], delta: Vec2): EditGhost[] {
  const ok = checkMoves(w, groupMoves(pieces, delta)).ok;
  return pieces.map((o) => ({ item: o.item, x: o.x + delta.x, y: o.y + delta.y, rotation: o.rotation, ok }));
}

/** A move the server hasn't answered yet, drawn where it is going. */
export function pendingGhosts(objects: readonly PlacedObject[], moves: readonly ArrangeMove[]): EditGhost[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  return moves.flatMap((m) => {
    const o = byId.get(m.id);
    return o ? [{ item: o.item, x: m.x, y: m.y, rotation: m.rotation, ok: true }] : [];
  });
}

/** The held piece where its ghost is, green when it may go down there. */
export function heldGhost(w: ArrangeWorld, held: HeldPiece): EditGhost | null {
  if (!held.at) return null;
  const ok = !!w.map && canPlace(w.map, w.objects, w.farm, held.item, held.at.x, held.at.y, held.rotation, { occupied: w.occupied }).ok;
  return { item: held.item, x: held.at.x, y: held.at.y, rotation: held.rotation, ok };
}

/** What the toolbar offers: for a held piece, or for the selection; null shows no toolbar. */
export function toolbarState(held: HeldPiece | null, selected: readonly PlacedObject[]): EditToolbarState | null {
  if (held) return { count: 0, holding: true, name: getItem(held.item)?.name, canTurn: turns(held.item), canPickUp: true };
  if (selected.length === 0) return null;
  return { count: selected.length, holding: false, canTurn: selected.some((o) => turns(o.item)), canPickUp: true };
}
