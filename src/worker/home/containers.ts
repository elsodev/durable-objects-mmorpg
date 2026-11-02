// Contents of the owner's storage furniture (fridges), keyed by placed object id. Stored apart
// from the save (storage key "containers") so zones never load it; HomeRoom alone reads and
// writes it, synchronously next to the inventory.
import { emptyStorage, isStorageEmpty, sanitizeStorage, storageOf, type StorageSlots } from "../../shared/engine/storage";
import type { HomeServerMsg } from "../../shared/home";
import type { InventorySlot, PlacedObject } from "../../shared/types";

export type Containers = Record<string, StorageSlots>;

/** Saved contents for the objects that still exist and hold storage; everything else is dropped. */
export function sanitizeContainers(raw: unknown, objects: readonly PlacedObject[]): Containers {
  const out: Containers = {};
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const o of objects) {
    const spec = storageOf(o.item);
    if (!spec || !Object.hasOwn(src, o.id)) continue;
    const box = sanitizeStorage(src[o.id], spec);
    if (!isStorageEmpty(box)) out[o.id] = box;
  }
  return out;
}

/** The box inside a storage object (created empty on first use); null if it holds nothing. */
export function boxFor(containers: Containers, obj: PlacedObject): StorageSlots | null {
  const spec = storageOf(obj.item);
  if (!spec) return null;
  if (!Object.hasOwn(containers, obj.id)) containers[obj.id] = emptyStorage(spec);
  return containers[obj.id]!;
}

/** True when nothing is stored in object `id` (it may be picked up). */
export function containerEmpty(containers: Containers, id: string): boolean {
  return !Object.hasOwn(containers, id) || isStorageEmpty(containers[id]!);
}

/** Items left in containers whose objects are gone (to hand back to the owner). */
export function orphanedItems(raw: unknown, objects: readonly PlacedObject[]): InventorySlot[] {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: InventorySlot[] = [];
  for (const [id, slots] of Object.entries(src)) {
    const obj = objects.find((o) => o.id === id);
    if (obj && storageOf(obj.item)) continue;
    if (!Array.isArray(slots)) continue;
    // Any storage spec that takes everything: what matters is that the items are real.
    for (const s of sanitizeStorage(slots, { slots: Math.min(slots.length, 64), accepts: "any" })) if (s) out.push(s);
  }
  return out;
}

export function storageMsg(obj: PlacedObject, box: StorageSlots, open = false): HomeServerMsg {
  const spec = storageOf(obj.item)!;
  return { t: "storage", id: obj.id, item: obj.item, slots: box.map((s) => (s ? { ...s } : null)), accepts: spec.accepts, ...(open ? { open: true } : {}) };
}
