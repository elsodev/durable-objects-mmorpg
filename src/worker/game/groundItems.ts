// Items lying on the ground in a zone: loot that didn't fit a player's bag (owned by them,
// picked up by walking over it, gone after GROUND_DROP_MS) and forage (anyone picks it by
// interacting). Plain data so the zone can store it as is.
import type { Inventory, ItemId, Vec2 } from "../../shared/types";
import type { GroundItemView } from "../../shared/protocol";
import { addItem, dist } from "../../shared/engine";
import { GROUND_DROP_MS, PICKUP_RADIUS } from "../../shared/spawns";

export interface GroundItem {
  id: string;
  item: ItemId;
  qty: number;
  x: number;
  y: number;
  /** userId of the only player who may take it; null for forage. */
  owner: string | null;
  /** ms epoch it vanishes; null never (forage). */
  expiresAt: number | null;
}

const MAX_ITEMS = 300;

export class GroundItems {
  private items = new Map<string, GroundItem>();
  private seq = 0;

  load(stored: unknown, now: number): void {
    this.items.clear();
    if (!Array.isArray(stored)) return;
    for (const raw of stored.slice(0, MAX_ITEMS)) {
      const g = raw as Partial<GroundItem>;
      if (typeof g?.id !== "string" || typeof g.item !== "string" || !(Number(g.qty) > 0)) continue;
      if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
      const expiresAt = typeof g.expiresAt === "number" ? g.expiresAt : null;
      if (expiresAt !== null && expiresAt <= now) continue;
      this.items.set(g.id, { id: g.id, item: g.item, qty: Math.floor(Number(g.qty)), x: g.x!, y: g.y!, owner: typeof g.owner === "string" ? g.owner : null, expiresAt });
      const n = Number(g.id.replace(/^g/, ""));
      if (Number.isFinite(n)) this.seq = Math.max(this.seq, n);
    }
  }

  record(): GroundItem[] {
    return [...this.items.values()];
  }

  get(id: string): GroundItem | undefined {
    return this.items.get(id);
  }

  /** Loot that didn't fit `owner`'s bag, scattered a little around `at`. */
  drop(owner: string, item: ItemId, qty: number, at: Vec2, now: number, rand: () => number): GroundItem | null {
    const a = rand() * Math.PI * 2;
    const r = 0.2 + rand() * 0.4;
    return this.add({ item, qty, x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r, owner, expiresAt: now + GROUND_DROP_MS });
  }

  /** Forage growing at a tile point; nobody owns it and it doesn't expire. */
  forage(item: ItemId, at: Vec2, qty = 1): GroundItem | null {
    return this.add({ item, qty: Math.max(1, Math.floor(qty)), x: at.x, y: at.y, owner: null, expiresAt: null });
  }

  private add(g: Omit<GroundItem, "id">): GroundItem | null {
    if (this.items.size >= MAX_ITEMS) return null;
    const full = { id: `g${++this.seq}`, ...g };
    this.items.set(full.id, full);
    return full;
  }

  take(id: string): GroundItem | undefined {
    const g = this.items.get(id);
    if (g) this.items.delete(id);
    return g;
  }

  /** `owner`'s own drops within pickup reach of `pos` (walk-over pickup). */
  ownedNear(owner: string, pos: Vec2): GroundItem[] {
    const out: GroundItem[] = [];
    for (const g of this.items.values()) if (g.owner === owner && dist(g, pos) <= PICKUP_RADIUS) out.push(g);
    return out;
  }

  forageCount(): number {
    let n = 0;
    for (const g of this.items.values()) if (g.owner === null) n++;
    return n;
  }

  /** True when some item already lies within `r` of `p` (forage doesn't pile up). */
  occupied(p: Vec2, r = 0.9): boolean {
    for (const g of this.items.values()) if (dist(g, p) < r) return true;
    return false;
  }

  /** Removes expired drops; returns them. */
  expire(now: number): GroundItem[] {
    const out: GroundItem[] = [];
    for (const g of this.items.values()) {
      if (g.expiresAt !== null && now >= g.expiresAt) {
        this.items.delete(g.id);
        out.push(g);
      }
    }
    return out;
  }

  /** What `userId` sees: forage plus their own drops (other people's loot stays private). */
  visibleTo(userId: string): GroundItemView[] {
    const out: GroundItemView[] = [];
    for (const g of this.items.values()) if (g.owner === null || g.owner === userId) out.push(viewOf(g));
    return out;
  }
}

export function viewOf(g: GroundItem): GroundItemView {
  return { id: g.id, item: g.item, qty: g.qty, x: Math.round(g.x * 100) / 100, y: Math.round(g.y * 100) / 100, ...(g.owner === null ? { forage: true } : {}) };
}

/** Whether `userId` would see `g` at all. */
export function visibleToUser(g: GroundItem, userId: string): boolean {
  return g.owner === null || g.owner === userId;
}

/**
 * Puts loot in `inv`; whatever doesn't fit lands on the ground at `at`, owned by `owner`.
 * Returns what went in the bag and the ground items made.
 */
export function giveOrDrop(
  inv: Inventory,
  ground: GroundItems,
  owner: string,
  items: readonly { item: ItemId; qty: number }[],
  at: Vec2,
  now: number,
  rand: () => number,
): { given: { item: ItemId; qty: number }[]; dropped: GroundItem[] } {
  const given: { item: ItemId; qty: number }[] = [];
  const dropped: GroundItem[] = [];
  for (const d of items) {
    let left = d.qty;
    // Fill what fits one at a time, so a nearly full stack still takes some.
    if (addItem(inv, d.item, left)) left = 0;
    else while (left > 0 && addItem(inv, d.item, 1)) left--;
    if (left < d.qty) given.push({ item: d.item, qty: d.qty - left });
    if (left > 0) {
      const g = ground.drop(owner, d.item, left, at, now, rand);
      if (g) dropped.push(g);
    }
  }
  return { given, dropped };
}
