// Pure timing and layout for animated water (render/water.ts draws it; no Pixi here, unit-tested).
//
// Every water tile shows one shared surface animation, laid in world space so it runs on across
// tiles and chunks without seams. Along the banks a faint lap line washes in and out. It is traced
// from the bank art itself (so it hugs grass tufts and rocks) and keyed to world pixels, so it runs
// on across tiles, and its phase drifts along the shore so it travels instead of blinking at once.
import { Ground, type MapData, type WaterStyle } from "../../shared/types";
import type { RectTuple } from "../art/catalog-types";
import { asRect, hashXY } from "../art/slice";
import { groundAt, planTile, type BlobPiece, type BlobSet, type Quadrant, type TilePlan } from "./ground-autotile";

/** Frames in every water loop (surface and bank lap). */
export const WATER_FRAMES = 4;

export interface WaterStyleConfig {
  /** Time each frame shows. */
  ms: number;
  /** Drift of the surface in source px per second (a river's current); null keeps it in place. */
  flow: { x: number; y: number } | null;
}

/** Used when the catalog has no styles for a kind (keeps the game running on an older pack). */
export const DEFAULT_WATER_STYLES: Record<WaterStyle, WaterStyleConfig> = {
  still: { ms: 260, flow: null },
  river: { ms: 220, flow: { x: 6, y: 0 } },
};

export const waterStyleOf = (map: Pick<MapData, "waterStyle">): WaterStyle => map.waterStyle ?? "still";

/** Reads a style from catalog data ({ ms, flow: [x, y] }), falling back per field. */
export function parseWaterStyle(raw: unknown, kind: WaterStyle): WaterStyleConfig {
  const def = DEFAULT_WATER_STYLES[kind];
  const o = raw && typeof raw === "object" ? (raw as { ms?: unknown; flow?: unknown }) : {};
  const ms = typeof o.ms === "number" && Number.isFinite(o.ms) && o.ms >= 50 && o.ms <= 2000 ? o.ms : def.ms;
  let flow = def.flow;
  if (o.flow === null) flow = null;
  else if (Array.isArray(o.flow) && o.flow.length === 2 && o.flow.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 64))
    flow = { x: o.flow[0] as number, y: o.flow[1] as number };
  return { ms, flow };
}

/** Frame index at time `now` for a loop of `frames` frames, `phase` frames ahead. */
export function waterFrame(now: number, ms: number, frames = WATER_FRAMES, phase = 0): number {
  if (frames <= 1 || ms <= 0) return 0;
  const step = Math.floor(now / ms) + phase;
  return ((step % frames) + frames) % frames;
}

/**
 * Whole source px the surface has drifted at `now`, wrapped to [0, period). Whole pixels keep the
 * art crisp at 2x; wrapping at the pattern period keeps the number small and the loop seamless.
 */
export function waterDrift(now: number, pxPerSec: number, period: number): number {
  if (!pxPerSec || period <= 0) return 0;
  const px = Math.floor((now * pxPerSec) / 1000);
  return ((px % period) + period) % period;
}

/**
 * Top-left source px, inside one period, of the surface window that tile (x, y) shows at drift
 * (dx, dy). Neighbouring tiles get neighbouring windows, so the pattern runs on without seams; the
 * window can run past the period, so the surface frames are drawn twice in each direction.
 */
export function surfaceWindow(x: number, y: number, srcTile: number, period: number, dx: number, dy: number): { x: number; y: number } {
  const wrap = (v: number) => ((v % period) + period) % period;
  return { x: wrap(x * srcTile - dx), y: wrap(y * srcTile - dy) };
}

export interface WaterSegment {
  x: number;
  y: number;
  w: number;
}

/**
 * Runs of water tiles in [x0, x1) x [y0, y1), one row high and cut where x is a multiple of
 * `cells` (the pattern period in tiles), so each fits one window of the wrap-around surface atlas.
 * One sprite per segment draws only water (no overdraw under land) with few quads.
 */
export function surfaceSegments(map: MapData, x0: number, y0: number, x1: number, y1: number, cells: number): WaterSegment[] {
  const out: WaterSegment[] = [];
  const xe = Math.min(map.width, x1);
  for (let y = Math.max(0, y0); y < Math.min(map.height, y1); y++) {
    let start = -1;
    for (let x = Math.max(0, x0); x <= xe; x++) {
      const water = x < xe && map.ground[y * map.width + x] === Ground.Water;
      if (start >= 0 && (!water || x % cells === 0)) {
        out.push({ x: start, y, w: x - start });
        start = -1;
      }
      if (water && start < 0) start = x;
    }
  }
  return out;
}

// ---------------------------------------------------------------- lap line

/** Pixels around a tile a lap trace also reads, so lines run on across tile edges. */
export const LAP_MARGIN = 3;
/** World px per step of lap phase along the shore. */
const LAP_PHASE_PX = 40;

/**
 * 1 where a source pixel is bank or land, for a (srcTile + 2*LAP_MARGIN)^2 window around tile
 * (x, y). `bankSolid` gives a bank quadrant's solid pixels (half x half, row-major) or null.
 * Docks, bridges and the map edge count as water: they get no lap.
 */
export function lapWindow(
  map: MapData,
  x: number,
  y: number,
  srcTile: number,
  bankSolid: (set: BlobSet, piece: BlobPiece, q: Quadrant) => Uint8Array | null,
): Uint8Array {
  const size = srcTile + 2 * LAP_MARGIN;
  const half = srcTile / 2;
  const out = new Uint8Array(size * size);
  const plans = new Map<number, TilePlan | null>();
  const planOf = (tx: number, ty: number): TilePlan | null => {
    const k = ty * map.width + tx;
    let p = plans.get(k);
    if (p === undefined) {
      const g = groundAt(map, tx, ty, Ground.Water);
      p = g === Ground.Water ? planTile(map, tx, ty) : null;
      plans.set(k, p);
    }
    return p;
  };
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const wx = x * srcTile - LAP_MARGIN + i;
      const wy = y * srcTile - LAP_MARGIN + j;
      const tx = Math.floor(wx / srcTile);
      const ty = Math.floor(wy / srcTile);
      const g = groundAt(map, tx, ty, Ground.Water);
      if (g === Ground.Water) {
        const plan = planOf(tx, ty);
        const lx = wx - tx * srcTile;
        const ly = wy - ty * srcTile;
        const q = ((lx >= half ? 1 : 0) | (ly >= half ? 2 : 0)) as Quadrant;
        const piece = plan?.blob?.pieces[q];
        if (piece && plan?.blob) {
          const solid = bankSolid(plan.blob.set, piece, q);
          if (solid && solid[(ly % half) * half + (lx % half)]) out[j * size + i] = 1;
        }
      } else if (g !== Ground.Wood && g !== Ground.Void) {
        out[j * size + i] = 1;
      }
    }
  }
  return out;
}

/** 0..1 from a world px block and a salt (dashes of 3 px, different per stage). */
function dash(wx: number, wy: number, salt: number): number {
  return (hashXY(Math.floor(wx / 3) + salt * 7919, Math.floor(wy / 3) - salt * 104729) % 1000) / 1000;
}

/**
 * Whether a water pixel `d` px from the bank is lit at lap stage 0..3: the line washes out from the
 * bank (1 px, then 2, then a faint 3) and the water settles for one frame.
 */
export function lapLit(stage: number, d: number, wx: number, wy: number): boolean {
  switch (stage) {
    case 0:
      return d === 1 && dash(wx, wy, 0) < 0.65;
    case 1:
      return (d === 2 && dash(wx, wy, 1) < 0.55) || (d === 1 && dash(wx, wy, 2) < 0.15);
    case 2:
      return d === 3 && dash(wx, wy, 3) < 0.3;
    default:
      return false;
  }
}

/** Lap stage of a world pixel at loop frame `frame`: the phase steps along the shore. */
export function lapStage(frame: number, wx: number, wy: number): number {
  const phase = Math.floor((wx + wy) / LAP_PHASE_PX);
  return (((frame + phase) % WATER_FRAMES) + WATER_FRAMES) % WATER_FRAMES;
}

/**
 * The lap frames of tile (x, y) from its lapWindow (`solid`): WATER_FRAMES masks of srcTile^2 (1 = lit), or
 * null when the tile never shows a lap (open water far from any bank).
 */
export function lapFrames(solid: Uint8Array, x: number, y: number, srcTile: number): Uint8Array[] | null {
  const size = srcTile + 2 * LAP_MARGIN;
  // Distance (4-neighbour, through water) from the nearest bank pixel, capped past the line's reach.
  const dist = new Uint8Array(size * size).fill(255);
  const queue: number[] = [];
  for (let k = 0; k < solid.length; k++) if (solid[k]) {
    dist[k] = 0;
    queue.push(k);
  }
  if (!queue.length) return null;
  for (let h = 0; h < queue.length; h++) {
    const k = queue[h]!;
    const d = dist[k]!;
    if (d >= 3) continue;
    const i = k % size;
    const near = [i > 0 ? k - 1 : -1, i < size - 1 ? k + 1 : -1, k - size, k + size];
    for (const n of near) {
      if (n < 0 || n >= dist.length || dist[n] !== 255) continue;
      dist[n] = d + 1;
      queue.push(n);
    }
  }
  const frames: Uint8Array[] = [];
  let any = false;
  for (let f = 0; f < WATER_FRAMES; f++) {
    const m = new Uint8Array(srcTile * srcTile);
    for (let j = 0; j < srcTile; j++) {
      for (let i = 0; i < srcTile; i++) {
        const d = dist[(j + LAP_MARGIN) * size + i + LAP_MARGIN]!;
        if (d < 1 || d > 3) continue;
        const wx = x * srcTile + i;
        const wy = y * srcTile + j;
        if (lapLit(lapStage(f, wx, wy), d, wx, wy)) {
          m[j * srcTile + i] = 1;
          any = true;
        }
      }
    }
    frames.push(m);
  }
  return any ? frames : null;
}

// ---------------------------------------------------------------- catalog (terrain.water_anim)

/** Bank sheets of terrain.water (edges), copied with the open water cut out. */
export const WATER_BANK_KEYS = ["grassBankOverlay3x3", "grassInner2x2", "dirtBankOverlay3x3", "dirtInner2x2"] as const;
export type WaterBankKey = (typeof WATER_BANK_KEYS)[number];

export interface WaterAnimRects {
  file: string;
  /** Surface frames: the `period` px pattern drawn 2x2, so 2 * period px square. */
  surface: RectTuple[];
  period: number;
  banks: Record<WaterBankKey, RectTuple>;
  styles: Record<WaterStyle, WaterStyleConfig>;
  /** Lap line colour, and the bank sheets' water colours (pixels the lap may cross). */
  lap: { color: Rgb; water: Rgb[] };
}

export type Rgb = [number, number, number];
/** The water palette of terrain_summer.png and the reflections: light, shallows, open water. */
const DEFAULT_LAP = { color: [58, 175, 194] as Rgb, water: [[33, 112, 135], [42, 133, 152]] as Rgb[] };

const isRgb = (v: unknown): v is Rgb =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255);

function parseLap(raw: unknown): { color: Rgb; water: Rgb[] } {
  const o = raw && typeof raw === "object" ? (raw as { color?: unknown; water?: unknown }) : {};
  const water = Array.isArray(o.water) && o.water.length > 0 && o.water.every(isRgb) ? (o.water as Rgb[]) : DEFAULT_LAP.water;
  return { color: isRgb(o.color) ? o.color : DEFAULT_LAP.color, water };
}

/** WATER_FRAMES rects of one size, or null. */
function frameRects(v: unknown): RectTuple[] | null {
  if (!Array.isArray(v) || v.length !== WATER_FRAMES) return null;
  const rects = v.map(asRect);
  if (rects.some((r) => !r)) return null;
  const [, , w, h] = rects[0]!;
  return rects.every((r) => r![2] === w && r![3] === h) ? (rects as RectTuple[]) : null;
}

/**
 * Validates terrain.water_anim. Returns null (still water) unless every part is complete, so a
 * half-finished entry never draws half a pond. `srcTile` is the source tile size.
 */
export function parseWaterAnim(entry: unknown, srcTile: number): WaterAnimRects | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as { file?: unknown; frames?: Record<string, unknown>; banks?: Record<string, unknown>; styles?: Record<string, unknown>; lap?: unknown };
  if (typeof e.file !== "string" || !e.frames || typeof e.frames !== "object" || !e.banks || typeof e.banks !== "object") return null;
  const surface = frameRects(e.frames.surface);
  // Each frame is its pattern drawn 2x2, so the pattern period is half the frame.
  if (!surface || surface[0]![2] !== surface[0]![3] || surface[0]![2] % (2 * srcTile) !== 0) return null;
  const banks = {} as Record<WaterBankKey, RectTuple>;
  for (const key of WATER_BANK_KEYS) {
    const r = asRect(e.banks[key]);
    const cells = key.endsWith("3x3") ? 3 : 2;
    if (!r || r[2] !== r[3] || r[2] !== cells * srcTile) return null;
    banks[key] = r;
  }
  const styles = e.styles && typeof e.styles === "object" ? e.styles : {};
  return {
    file: e.file,
    surface,
    period: surface[0]![2] / 2,
    banks,
    styles: { still: parseWaterStyle(styles.still, "still"), river: parseWaterStyle(styles.river, "river") },
    lap: parseLap(e.lap),
  };
}
