// Pure rules for rearranging the bag by drag and drop (inventory panel and hotbar). The server
// re-checks every move (moveSlot in shared/engine/inventory.ts); the client applies the same
// function to a copy so the slot moves at once.
import type { ClientMsg } from "../../shared/protocol";
import type { Inventory } from "../../shared/types";
import { moveSlot, type SlotMoveResult } from "../../shared/engine";

/** Pointer travel (px) before a press becomes a drag; shorter presses stay clicks. */
export const DRAG_THRESHOLD = 6;

export function dragStarted(dx: number, dy: number): boolean {
  return dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD;
}

/** Half a stack (rounded up) for a split drag; null when there's nothing to split. */
export function splitQty(qty: number): number | null {
  return qty >= 2 ? Math.ceil(qty / 2) : null;
}

export interface PlannedMove {
  msg: Extract<ClientMsg, { t: "moveSlot" }>;
  /** The bag after the move, for an optimistic redraw. */
  next: Inventory;
  result: SlotMoveResult;
}

/** Plans a drop of slot `from` onto `to` (half the stack when `split`), or null when it can't happen. */
export function planMove(inv: Inventory | null, from: number, to: number, split = false): PlannedMove | null {
  if (!inv || from === to) return null;
  const s = inv.slots[from];
  if (!s) return null;
  const qty = split ? splitQty(s.qty) : null;
  if (split && qty === null) return null;
  const next: Inventory = { coins: inv.coins, slots: inv.slots.map((x) => (x ? { ...x } : null)) };
  const result = moveSlot(next, from, to, qty ?? undefined);
  if (!result) return null;
  const msg: PlannedMove["msg"] = { t: "moveSlot", from, to, ...(qty !== null ? { qty } : {}) };
  return { msg, next, result };
}
