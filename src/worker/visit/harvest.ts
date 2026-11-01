// A visitor's harvest belongs to the home owner: into the owner's bag, or the owner's shipping bin
// when the bag is full (it sells tonight). Notices to the owner are batched per visitor and crop.
import type { Inventory, ItemId } from "../../shared/types";
import { addItem, canAdd } from "../../shared/engine";
import { getItem } from "../../shared/items";
import { countLabel } from "../../shared/visits";
import { BIN_MAX, type BinEntry } from "../game/shipping";

export type HarvestCredit = "bag" | "bin";

/** True when `item` has somewhere to go (call before removing the crop). */
export function canCredit(inv: Inventory, bin: readonly BinEntry[], item: ItemId): boolean {
  return canAdd(inv, item, 1) || bin.length < BIN_MAX || bin.some((e) => e.item === item);
}

/** Credits one harvested item to the owner; null when neither the bag nor the bin has room. */
export function creditHarvest(inv: Inventory, bin: BinEntry[], item: ItemId): HarvestCredit | null {
  if (canAdd(inv, item, 1) && addItem(inv, item, 1)) return "bag";
  // Join the last shipment of the same crop so helpers don't fill the bin's 48 entries one by one.
  const last = bin[bin.length - 1];
  if (last && last.item === item) {
    last.qty += 1;
    return "bin";
  }
  if (bin.length >= BIN_MAX) {
    const same = bin.find((e) => e.item === item);
    if (!same) return null;
    same.qty += 1;
    return "bin";
  }
  bin.push({ item, qty: 1 });
  return "bin";
}

/** "+1 Gold Turnip, +2 Turnip" for a harvest's stacks. */
export function harvestText(items: readonly { item: ItemId; qty: number }[]): string {
  return items.map((i) => `+${i.qty} ${getItem(i.item)?.name ?? i.item}`).join(", ");
}

/** Batches "Basil helped harvest 3 turnips" so a busy helper doesn't flood the owner with toasts. */
export class HarvestTally {
  private pending = new Map<string, { who: string; item: ItemId; qty: number; bin: number; since: number }>();

  constructor(private readonly delayMs = 2000) {}

  add(who: string, item: ItemId, credit: HarvestCredit, now: number): void {
    const key = `${who}\u0000${item}`;
    const e = this.pending.get(key) ?? { who, item, qty: 0, bin: 0, since: now };
    e.qty += 1;
    if (credit === "bin") e.bin += 1;
    this.pending.set(key, e);
  }

  get size(): number {
    return this.pending.size;
  }

  /** Lines whose batch is at least delayMs old (all of them with force). */
  flush(now: number, force = false): string[] {
    const out: string[] = [];
    for (const [k, e] of this.pending) {
      if (!force && now - e.since < this.delayMs) continue;
      this.pending.delete(k);
      const name = getItem(e.item)?.name ?? e.item;
      const where = e.bin === e.qty ? " (into your shipping bin, your bag was full)" : e.bin > 0 ? ` (${e.bin} into your shipping bin)` : "";
      out.push(`${e.who} helped harvest ${countLabel(e.qty, name)}${where}`);
    }
    return out;
  }
}
