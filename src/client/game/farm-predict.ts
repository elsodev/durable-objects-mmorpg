// Client-side farm prediction (pure, unit-tested). Hoeing, planting and watering show at once;
// the server's `farm` message then confirms the tile, and a `reject` (or silence) drops it.
// The rules mirror HomeRoom.onUse through the shared engine, so a prediction is rarely wrong.
import { clearDeadCrop, cropView, harvestable, isFarmable, plantTile, tillTile, waterTile } from "../../shared/engine";
import { getItem } from "../../shared/items";
import type { FarmTile, ItemId, MapData, PlacedObject, Vec2 } from "../../shared/types";

export const PREDICT_TTL_MS = 2000;

export interface PredictInput {
  item: ItemId | null | undefined;
  tile: Vec2;
  farm: ReadonlyMap<string, FarmTile>;
  map: MapData;
  objects: readonly PlacedObject[];
  /** A breakable rock stands on the tile. */
  rock: boolean;
  /** Water left in the can (null = unknown). */
  water: number | null;
  /** Farm time (see session farmTime). */
  now: number;
}

const keyOf = (x: number, y: number) => `${x},${y}`;

/** The tile as it will look once the server applies this use, or null to predict nothing. */
export function predictUse(i: PredictInput): FarmTile | null {
  const def = i.item ? getItem(i.item) : undefined;
  if (!def) return null;
  const { x, y } = i.tile;
  const cur = i.farm.get(keyOf(x, y));
  if (!cur) {
    if (def.tool !== "hoe" || i.rock) return null;
    return isFarmable(i.map, x, y, [...i.objects]) ? tillTile(x, y) : null;
  }
  // The server harvests a ripe crop whatever is in hand; leave that to its answer.
  if (cur.crop && harvestable(cur, i.now)) return null;
  const next: FarmTile = { ...cur };
  // Any item pulls up a dead crop (toolRules "clear"), like the server does.
  if (cur.dead) return clearDeadCrop(next) ? next : null;
  if (def.kind === "seed") return plantTile(next, def.id, i.now) ? next : null;
  if (def.tool === "water") {
    if (cropView(cur, i.now).wateredToday || i.water === 0) return null;
    return waterTile(next, i.now) ? next : null;
  }
  return null;
}

interface Pending {
  tile: FarmTile;
  req: string | null;
  expires: number;
}

/** Predicted tiles laid over the store's tiles until the server answers. */
export class FarmPrediction {
  private pending = new Map<string, Pending>();

  add(tile: FarmTile, req: string | null, now: number): void {
    this.pending.set(keyOf(tile.x, tile.y), { tile, req, expires: now + PREDICT_TTL_MS });
  }

  /** The server sent these tiles: its version wins. */
  confirm(tiles: Iterable<FarmTile>): void {
    for (const t of tiles) this.pending.delete(keyOf(t.x, t.y));
  }

  /** The server refused request `req`. Returns true when a prediction was dropped. */
  reject(req: string | undefined): boolean {
    let dropped = false;
    for (const [k, p] of this.pending) {
      if (req === undefined || p.req === req) {
        this.pending.delete(k);
        dropped = true;
      }
    }
    return dropped;
  }

  /** Drops predictions the server never answered. Returns true when any were dropped. */
  expire(now: number): boolean {
    let dropped = false;
    for (const [k, p] of this.pending) {
      if (p.expires <= now) {
        this.pending.delete(k);
        dropped = true;
      }
    }
    return dropped;
  }

  clear(): void {
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }

  /** Store tiles with predictions applied on top. */
  merge(tiles: Iterable<FarmTile>): FarmTile[] {
    if (this.pending.size === 0) return [...tiles];
    const out = new Map<string, FarmTile>();
    for (const t of tiles) out.set(keyOf(t.x, t.y), t);
    for (const [k, p] of this.pending) out.set(k, p.tile);
    return [...out.values()];
  }
}
