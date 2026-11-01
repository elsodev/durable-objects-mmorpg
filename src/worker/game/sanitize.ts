// Normalises save data that crosses a trust boundary (RPC payloads, imports, old storage).
import { getItem, MAX_SLOTS } from "../../shared/items";
import { MAX_QTY } from "../../shared/validate";
import {
  SHARED_ZONES,
  type FarmTile,
  type Inventory,
  type InventorySlot,
  type PlacedObject,
  type ZoneId,
} from "../../shared/types";

const MAX_COINS = 10_000_000;

export function sanitizeInventory(inv: unknown): Inventory {
  const o = (inv && typeof inv === "object" ? inv : {}) as { coins?: unknown; slots?: unknown };
  const coins =
    typeof o.coins === "number" && Number.isFinite(o.coins) ? Math.min(MAX_COINS, Math.max(0, Math.floor(o.coins))) : 0;
  const slots: InventorySlot[] = [];
  for (const s of Array.isArray(o.slots) ? o.slots : []) {
    if (slots.length >= MAX_SLOTS) break;
    if (!s || typeof s !== "object") continue;
    const def = getItem((s as InventorySlot).item);
    const qty = (s as InventorySlot).qty;
    if (!def || typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) continue;
    slots.push({ item: def.id, qty: Math.min(qty, def.stack, MAX_QTY) });
  }
  return { coins, slots };
}

export function cloneInventory(inv: Inventory): Inventory {
  return { coins: inv.coins, slots: inv.slots.map((s) => ({ ...s })) };
}

export function clampHp(hp: unknown, maxHp: number): number {
  if (typeof hp !== "number" || !Number.isFinite(hp)) return maxHp;
  return Math.min(maxHp, Math.max(1, Math.round(hp)));
}

export function isZoneId(z: unknown): z is ZoneId {
  return z === "home" || (SHARED_ZONES as unknown[]).includes(z);
}

const isTileInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1024;
const isNumOrNull = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v));

export function sanitizeFarm(tiles: unknown): FarmTile[] {
  const out: FarmTile[] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(tiles) ? tiles : []) {
    if (!t || typeof t !== "object") continue;
    const f = t as FarmTile;
    if (!isTileInt(f.x) || !isTileInt(f.y) || seen.has(`${f.x},${f.y}`)) continue;
    if (!isNumOrNull(f.plantedAt) || !isNumOrNull(f.lastWateredDay)) continue;
    const cdef = typeof f.crop === "string" ? getItem(f.crop) : undefined;
    // Tiles hold the base crop; quality only exists once harvested.
    const crop = cdef?.kind === "crop" && !cdef.quality ? cdef.id : null;
    seen.add(`${f.x},${f.y}`);
    out.push({
      x: f.x,
      y: f.y,
      crop,
      plantedAt: crop ? f.plantedAt : null,
      wateredDays:
        crop && typeof f.wateredDays === "number" && Number.isInteger(f.wateredDays) && f.wateredDays >= 0
          ? Math.min(f.wateredDays, 100)
          : 0,
      lastWateredDay: crop ? f.lastWateredDay : null,
      ...(!crop && typeof f.dryDays === "number" && Number.isInteger(f.dryDays) && f.dryDays > 0
        ? { dryDays: Math.min(f.dryDays, 10) }
        : {}),
    });
  }
  return out;
}

export function sanitizeObjects(objs: unknown): PlacedObject[] {
  const out: PlacedObject[] = [];
  const ids = new Set<string>();
  for (const o of Array.isArray(objs) ? objs : []) {
    if (!o || typeof o !== "object") continue;
    const p = o as PlacedObject;
    if (typeof p.id !== "string" || p.id.length > 64 || ids.has(p.id)) continue;
    if (getItem(p.item)?.kind !== "furniture" || !isTileInt(p.x) || !isTileInt(p.y)) continue;
    if (![0, 1, 2, 3].includes(p.rotation)) continue;
    ids.add(p.id);
    out.push({ id: p.id, item: p.item, x: p.x, y: p.y, rotation: p.rotation });
  }
  return out;
}

/**
 * Counter for new object ids (`o<n>`, issued as ++seq): never below the highest numeric id in
 * use, so imported or old saves can't hand out an id that already exists.
 */
export function objSeqFor(objects: PlacedObject[], stored: unknown = 0): number {
  let max = typeof stored === "number" && Number.isInteger(stored) && stored > 0 ? stored : 0;
  for (const o of objects) {
    const m = /^o(\d{1,9})$/.exec(o.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}
