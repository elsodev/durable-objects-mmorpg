// DOM-free text helpers for the inventory panel (also used by tests).
import { getItem } from "../../shared/items";
import type { InventorySlot } from "../../shared/types";

export interface TooltipInfo {
  name: string;
  desc: string | null;
  /** "Sells for 25 coins" / "Can't be sold". */
  price: string;
  qty: number;
}

export function tooltipInfo(slot: InventorySlot): TooltipInfo {
  const def = getItem(slot.item);
  const sell = def?.sell ?? 0;
  return {
    name: def?.name ?? slot.item,
    desc: def?.desc ?? null,
    price: sell > 0 ? `Sells for ${sell} coin${sell === 1 ? "" : "s"}` : "Can't be sold",
    qty: slot.qty,
  };
}

export function formatCoins(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString("en-US");
}
