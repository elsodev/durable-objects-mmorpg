// Storage furniture (the fridge, and any piece with ItemDef.storage): a fixed row of slots that
// lives in the owner's home save, keyed by the placed object's id. Moves between the bag and the
// box are synchronous and partial-safe: whatever doesn't fit stays where it was.
import type { Inventory, InventorySlot, ItemId } from "../types";
import { getItem, MAX_SLOTS } from "../items";
import type { StorageSpec } from "../furnitureItems";
import { addItem, gridOf, removeFromSlot, sameStack } from "./inventory";

export type StorageSlots = (InventorySlot | null)[];

export type StoreResult = { ok: true; moved: number; item: ItemId } | { ok: false; reason: string };

const fail = (reason: string): StoreResult => ({ ok: false, reason });

/** The storage spec of a furniture item, or null if it holds nothing. */
export function storageOf(item: ItemId): StorageSpec | null {
  return getItem(item)?.storage ?? null;
}

/** Whether `item` may go into storage of this spec ("food": crops, fish, forage, anything edible). */
export function storageAccepts(spec: StorageSpec, item: ItemId): boolean {
  const def = getItem(item);
  if (!def) return false;
  if (spec.accepts === "any") return def.kind !== "tool";
  return def.kind === "crop" || def.kind === "fish" || def.kind === "forage" || (def.eat ?? 0) > 0;
}

export function emptyStorage(spec: StorageSpec): StorageSlots {
  return Array.from({ length: spec.slots }, () => null);
}

export function isStorageEmpty(box: readonly (InventorySlot | null)[]): boolean {
  return box.every((s) => !s || s.qty <= 0);
}

/** A stored box from save data: exactly spec.slots long, known accepted items only, stacks capped. */
export function sanitizeStorage(raw: unknown, spec: StorageSpec): StorageSlots {
  const out = emptyStorage(spec);
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < spec.slots; i++) {
    const s = raw[i] as Partial<InventorySlot> | null | undefined;
    if (!s || typeof s.item !== "string" || !storageAccepts(spec, s.item)) continue;
    const qty = Number.isInteger(s.qty) ? Math.min(s.qty!, Math.max(1, getItem(s.item)!.stack)) : 0;
    if (qty <= 0) continue;
    const q = s.quality === 1 || s.quality === 2 ? s.quality : undefined;
    out[i] = { item: s.item, qty, ...(q ? { quality: q } : {}) };
  }
  return out;
}

/** How many of item (at quality) still fit in these slots. */
export function roomIn(slots: readonly (InventorySlot | null)[], item: ItemId, quality?: number): number {
  const stack = Math.max(1, getItem(item)?.stack ?? 1);
  const want = { item, ...(quality ? { quality } : {}) };
  let room = 0;
  for (const s of slots) room += !s ? stack : sameStack(s, want) ? Math.max(0, stack - s.qty) : 0;
  return room;
}

/** Puts qty into the slots (tops up matching stacks, then the first empty ones). Caller checked room. */
function fill(slots: StorageSlots, item: ItemId, qty: number, quality?: number): void {
  const stack = Math.max(1, getItem(item)?.stack ?? 1);
  const want = { item, ...(quality ? { quality } : {}) };
  let left = qty;
  for (const s of slots) {
    if (left === 0) return;
    if (!s || !sameStack(s, want) || s.qty >= stack) continue;
    const n = Math.min(stack - s.qty, left);
    s.qty += n;
    left -= n;
  }
  for (let i = 0; i < slots.length && left > 0; i++) {
    if (slots[i]) continue;
    const n = Math.min(stack, left);
    slots[i] = { ...want, qty: n };
    left -= n;
  }
}

const isQty = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

/**
 * Moves up to `qty` (default: the whole stack) from bag slot `slot` into the box. Moves as many
 * as fit; refuses when nothing fits or the box doesn't take that item.
 */
export function putIntoStorage(inv: Inventory, box: StorageSlots, spec: StorageSpec, slot: number, qty?: number): StoreResult {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS) return fail("Invalid slot.");
  const s = inv.slots[slot];
  if (!s || s.qty <= 0) return fail("Nothing in that slot.");
  if (qty !== undefined && !isQty(qty)) return fail("Invalid amount.");
  if (!storageAccepts(spec, s.item)) return fail(spec.accepts === "food" ? "Only food keeps in here." : "That doesn't go in here.");
  const want = Math.min(qty ?? s.qty, s.qty);
  const n = Math.min(want, roomIn(box, s.item, s.quality));
  if (n <= 0) return fail("It's full.");
  const { item, quality } = s;
  if (!removeFromSlot(inv, slot, n)) return fail("Nothing in that slot.");
  fill(box, item, n, quality);
  return { ok: true, moved: n, item };
}

/** Moves up to `qty` (default: all) from box slot `index` into the bag, as many as fit. */
export function takeFromStorage(inv: Inventory, box: StorageSlots, index: number, qty?: number): StoreResult {
  if (!Number.isInteger(index) || index < 0 || index >= box.length) return fail("Invalid slot.");
  const s = box[index];
  if (!s || s.qty <= 0) return fail("That shelf is empty.");
  if (qty !== undefined && !isQty(qty)) return fail("Invalid amount.");
  const want = Math.min(qty ?? s.qty, s.qty);
  const n = Math.min(want, roomIn(gridOf(inv.slots), s.item, s.quality));
  if (n <= 0) return fail("Your bag is full.");
  if (!addItem(inv, s.item, n, s.quality)) return fail("Your bag is full.");
  const item = s.item;
  s.qty -= n;
  if (s.qty === 0) box[index] = null;
  return { ok: true, moved: n, item };
}
