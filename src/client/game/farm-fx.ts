// Home farming feedback for the session: predicted soil/seeds/water, the shipping bin lid and the
// item tossed into it, and the watering-can refill cue. The session forwards messages here;
// drawing goes through the world's farm, props and effects layers.
import type { Art } from "../contracts";
import { isWaterSource } from "../../shared/engine";
import { getItem } from "../../shared/items";
import type { HomeServerMsg, ShipLine } from "../../shared/home";
import type { FarmTile, ItemId, MapData, PlacedObject, Vec2 } from "../../shared/types";
import { FarmPrediction, predictUse } from "./farm-predict";
import type { World } from "./world";

/** The bin closes when you walk this far (tiles, feet to the bin's centre) from it. */
export const BIN_WALK_AWAY = 2.6;
/** A refill shows only if the server's answer comes this soon after the use (ms). */
export const REFILL_WINDOW_MS = 2500;

/** The item whose quantity went up between two bin contents (the one just shipped), else null. */
export function shippedItem(prev: readonly ShipLine[] | null, next: readonly ShipLine[]): ItemId | null {
  if (!prev) return null;
  const had = new Map<ItemId, number>();
  for (const l of prev) had.set(l.item, (had.get(l.item) ?? 0) + l.qty);
  const now = new Map<ItemId, number>();
  for (const l of next) now.set(l.item, (now.get(l.item) ?? 0) + l.qty);
  for (const [item, qty] of now) if (qty > (had.get(item) ?? 0)) return item;
  return null;
}

/** True when the water went up after a can was used on a water source moments ago. */
export function isRefill(cueAt: number | null, now: number, before: number | null, after: number): boolean {
  return cueAt !== null && now - cueAt <= REFILL_WINDOW_MS && before !== null && after > before;
}

type HomeState = Extract<HomeServerMsg, { t: "homeState" }>;
type BinMsg = Extract<HomeServerMsg, { t: "bin" }>;

export interface FarmFxDeps {
  world(): World | null;
  art: Art;
  map(): MapData | null;
  farm(): ReadonlyMap<string, FarmTile>;
  objects(): PlacedObject[];
  rockAt(x: number, y: number): boolean;
  you(): Vec2 | null;
  farmTime(): number;
  playSfx(key: string): void;
  /** Closes the bin panel (its close callback then calls binClosed). */
  closeBinUi(): void;
}

export function createFarmFx(d: FarmFxDeps) {
  const prediction = new FarmPrediction();
  let water: number | null = null;
  let refillCue: { tile: Vec2; at: number } | null = null;
  let bin: ShipLine[] | null = null;
  let binOpen = false;
  let expireTimer: ReturnType<typeof setTimeout> | null = null;

  const binProp = () => d.map()?.props.find((p) => p.type === "shipping_bin") ?? null;

  function redraw(): void {
    d.world()?.farm.setFarm(prediction.merge(d.farm().values()), d.farmTime());
  }

  function scheduleExpiry(): void {
    if (expireTimer !== null || prediction.size === 0) return;
    expireTimer = setTimeout(() => {
      expireTimer = null;
      if (prediction.expire(performance.now())) redraw();
      scheduleExpiry();
    }, 500);
  }

  function setLid(open: boolean): void {
    const p = binProp();
    if (!p || open === binOpen) return;
    binOpen = open;
    d.world()?.props.setOpen?.(p.id, open);
    d.playSfx(open ? "bin_open" : "bin_close");
  }

  /** Arc the shipped item from the player into the bin; the bin squashes and thuds as it lands. */
  function tossIntoBin(item: ItemId): void {
    const w = d.world();
    const p = binProp();
    const me = d.you();
    if (!w || !p || !me) return;
    const land = () => {
      w.props.bump?.(p.id);
      d.playSfx("ship_drop");
    };
    if (!w.effects.toss) return land();
    // From the hands (about a tile above the feet) to the bin's open top.
    w.effects.toss({ x: me.x, y: me.y - 1 }, { x: p.x + p.w / 2, y: p.y + p.h * 0.35 }, d.art.icon(item), land);
  }

  return {
    redraw,

    /** A `use` was just sent for `item` on `tile` with request id `req` (home, as the owner). */
    used(item: ItemId | null, tile: Vec2, req: string, water: number | null): void {
      const map = d.map();
      if (!map) return;
      if (item && getItem(item)?.tool === "water" && isWaterSource(map, tile.x, tile.y)) {
        refillCue = { tile, at: performance.now() };
        return;
      }
      const next = predictUse({
        item,
        tile,
        farm: d.farm(),
        map,
        objects: d.objects(),
        rock: d.rockAt(tile.x, tile.y),
        water,
        now: d.farmTime(),
      });
      if (!next) return;
      prediction.add(next, req, performance.now());
      redraw();
      scheduleExpiry();
    },

    /** Server farm tiles arrived (after the store applied them). */
    farmChanged(tiles: Iterable<FarmTile> | null): void {
      if (tiles) prediction.confirm(tiles);
      else prediction.clear();
      redraw();
    },

    /** The server refused request `req`; drop its prediction. */
    rejected(req: string | undefined): void {
      if (req !== undefined && prediction.reject(req)) redraw();
    },

    homeState(msg: HomeState): void {
      const before = water;
      water = msg.water;
      if (!refillCue || !isRefill(refillCue.at, performance.now(), before, msg.water)) return;
      const { tile } = refillCue;
      refillCue = null;
      const w = d.world();
      if (!w) return;
      // A well holds its water in the bowl near the top of its footprint; a pond tile on the ground.
      const well = d.map()?.props.find((p) => p.type === "well" && tile.x >= p.x && tile.x < p.x + p.w && tile.y >= p.y && tile.y < p.y + p.h);
      const at = well ? { x: well.x + well.w / 2, y: well.y + well.h * 0.62 } : { x: tile.x + 0.5, y: tile.y + 0.5 };
      const sortY = well ? well.y + well.h + 0.01 : tile.y + 0.01;
      d.playSfx("refill");
      w.effects.ripple?.(at, sortY);
      w.effects.burst(at, "water");
      const max = msg.maxWater > 0 ? msg.maxWater : 1;
      w.effects.meter?.((before ?? 0) / max, msg.water / max);
    },

    bin(msg: BinMsg): void {
      // Only a ship (or opening the bin) answers with open; join and unship updates just record.
      const shipped = msg.open ? shippedItem(bin, msg.items) : null;
      bin = msg.items;
      if (msg.open) setLid(true);
      if (shipped) tossIntoBin(shipped);
    },

    /** The bin panel closed (✕, Escape, walking away or leaving home). */
    binClosed(): void {
      setLid(false);
    },

    /** Per tick: close the bin once you walk away from it. */
    tick(): void {
      if (!binOpen) return;
      const p = binProp();
      const me = d.you();
      if (!p || !me) return;
      if (Math.hypot(me.x - (p.x + p.w / 2), me.y - (p.y + p.h / 2)) > BIN_WALK_AWAY) d.closeBinUi();
    },

    /**
     * New zone: nothing predicted, bin closed (the props layer was rebuilt closed). The bin's
     * contents and the can's water are kept: home sends them around its welcome, in either order.
     */
    reset(): void {
      prediction.clear();
      refillCue = null;
      binOpen = false;
      if (expireTimer !== null) clearTimeout(expireTimer);
      expireTimer = null;
    },
  };
}
