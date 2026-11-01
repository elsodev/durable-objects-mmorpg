// Shipping bin: stacks put in the bin are paid at the end of the day. The last stack can be
// taken back the same day. All-or-nothing and synchronous, like the shop.
import type { Inventory, ItemId } from "../../shared/types";
import type { ShipLine } from "../../shared/home";
import { getItem } from "../../shared/items";
import { addItem, canAdd, removeFromSlot } from "../../shared/engine";
import { MAX_QTY } from "../../shared/validate";

export interface BinEntry {
  item: ItemId;
  qty: number;
}

/** Separate shipments kept in the bin per day (each one can be undone, last first). */
export const BIN_MAX = 48;

export type BinResult = { ok: true; text: string } | { ok: false; reason: string };

/** Moves the whole stack in `slot` into the bin. */
export function shipSlot(inv: Inventory, bin: BinEntry[], slot: number): BinResult {
  const s = Number.isInteger(slot) ? inv.slots[slot] : undefined;
  if (!s) return { ok: false, reason: "Pick something to ship first." };
  const def = getItem(s.item);
  if (!def || def.sell <= 0 || def.kind === "tool") return { ok: false, reason: "That can't be shipped." };
  if (bin.length >= BIN_MAX) return { ok: false, reason: "The bin is full until tonight." };
  const { item, qty } = s;
  if (!removeFromSlot(inv, slot, qty)) return { ok: false, reason: "Nothing in that slot." };
  bin.push({ item, qty });
  return { ok: true, text: `Shipped ${qty} ${def.name} — paid tonight` };
}

/** Takes the last shipment back into the bag. */
export function unshipLast(inv: Inventory, bin: BinEntry[]): BinResult {
  const last = bin[bin.length - 1];
  if (!last) return { ok: false, reason: "The shipping bin is empty." };
  if (!canAdd(inv, last.item, last.qty)) return { ok: false, reason: "Your bag is full." };
  addItem(inv, last.item, last.qty);
  bin.pop();
  return { ok: true, text: `Took back ${last.qty} ${getItem(last.item)?.name ?? last.item}` };
}

/** What the bin pays, one line per item id in first-shipped order. */
export function binPayout(bin: readonly BinEntry[]): { lines: ShipLine[]; total: number } {
  const byItem = new Map<ItemId, ShipLine>();
  for (const e of bin) {
    const price = getItem(e.item)?.sell ?? 0;
    const line = byItem.get(e.item) ?? { item: e.item, qty: 0, coins: 0 };
    line.qty += e.qty;
    line.coins += price * e.qty;
    byItem.set(e.item, line);
  }
  const lines = [...byItem.values()];
  return { lines, total: lines.reduce((n, l) => n + l.coins, 0) };
}

export function sanitizeBin(v: unknown): BinEntry[] {
  const out: BinEntry[] = [];
  for (const e of Array.isArray(v) ? v : []) {
    if (out.length >= BIN_MAX) break;
    const def = e && typeof e === "object" ? getItem((e as BinEntry).item) : undefined;
    const qty = (e as BinEntry | undefined)?.qty;
    if (!def || typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) continue;
    out.push({ item: def.id, qty: Math.min(qty, MAX_QTY) });
  }
  return out;
}
