// Animated water under the cached ground chunks. Per chunk: the surface as one sprite per run of
// water (cut every pattern period), the bank quadrants (static, with the open water cut out so the
// surface shows through) and a lap sprite on each shore tile. Surface runs share windows into one
// wrap-around atlas: the ticker moves those few windows when the frame or the drift pixel changes,
// and every sprite follows. Lap frames are traced from the bank art once per map into a second
// atlas. Still water is cached per chunk like the ground and redrawn only on a frame step; a river
// drifts every few frames, so it stays live.
import { Container, Rectangle, Sprite, Texture, Ticker } from "pixi.js";
import { Ground, type MapData, type WaterStyle } from "../../shared/types";
import { SCALE, SRC_TILE, TILE } from "../contracts";
import { QUADRANTS, planTile, type BlobPiece, type BlobSet, type Quadrant } from "./ground-autotile";
import type { BlobTextures, GroundEdgeArt } from "./ground";
import {
  WATER_FRAMES,
  lapFrames,
  lapWindow,
  surfaceSegments,
  surfaceWindow,
  waterDrift,
  waterFrame,
  waterStyleOf,
  type WaterStyleConfig,
} from "./water-anim";

/** Animated water art (from the catalog's terrain.water_anim), see GroundEdgeArt.waterAnim. */
export interface WaterArt {
  /**
   * WATER_FRAMES surface frames on one sheet: each a seamless `period` px pattern drawn 2x2, so any
   * tile-sized window starting inside the pattern fits.
   */
  surface: Texture[];
  period: number;
  /** Bank sheets (water.grass / water.dirt) with the open water cut out. */
  banks: GroundEdgeArt;
  /** Solid (bank, not water) pixels of one bank quadrant, half x half row-major; null if unknown. */
  bankSolid(set: BlobSet, piece: BlobPiece, q: Quadrant): Uint8Array | null;
  /** Colour of the lap line (a light from the water palette). */
  lapColor: [number, number, number];
  styles: Record<WaterStyle, WaterStyleConfig>;
}

interface Lap {
  s: Sprite;
  frames: Texture[];
}

const HALF = TILE / 2;
/** Atlas width in tiles; rows grow with the shore, capped so a huge map can't ask for a giant canvas. */
const ATLAS_COLS = 32;
const ATLAS_MAX_ROWS = 128;

/** Lap frames of every shore tile, packed into one canvas texture. */
class LapAtlas {
  private frames = new Map<number, Texture[]>();
  private source: Texture | null = null;

  constructor(water: WaterArt, map: MapData) {
    if (typeof document === "undefined") return;
    const masks: { key: number; frames: Uint8Array[] }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.ground[y * map.width + x] !== Ground.Water || !planTile(map, x, y).blob) continue;
        const frames = lapFrames(lapWindow(map, x, y, SRC_TILE, (set, piece, q) => water.bankSolid(set, piece, q)), x, y, SRC_TILE);
        if (frames) masks.push({ key: y * map.width + x, frames });
      }
    }
    const cells = Math.min(masks.length * WATER_FRAMES, ATLAS_COLS * ATLAS_MAX_ROWS);
    if (!cells) return;
    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_COLS * SRC_TILE;
    canvas.height = Math.ceil(cells / ATLAS_COLS) * SRC_TILE;
    const g = canvas.getContext("2d");
    if (!g) return;
    const img = g.createImageData(canvas.width, canvas.height);
    const [r, gr, b] = water.lapColor;
    const placed: { key: number; cell: number }[] = [];
    masks.forEach((m, n) => {
      if ((n + 1) * WATER_FRAMES > cells) return;
      placed.push({ key: m.key, cell: n * WATER_FRAMES });
      m.frames.forEach((mask, f) => {
        const c = n * WATER_FRAMES + f;
        const ox = (c % ATLAS_COLS) * SRC_TILE;
        const oy = Math.floor(c / ATLAS_COLS) * SRC_TILE;
        for (let k = 0; k < mask.length; k++) {
          if (!mask[k]) continue;
          const o = ((oy + Math.floor(k / SRC_TILE)) * canvas.width + ox + (k % SRC_TILE)) * 4;
          img.data[o] = r;
          img.data[o + 1] = gr;
          img.data[o + 2] = b;
          img.data[o + 3] = 255;
        }
      });
    });
    g.putImageData(img, 0, 0);
    this.source = Texture.from(canvas);
    this.source.source.scaleMode = "nearest";
    for (const p of placed) {
      const list: Texture[] = [];
      for (let f = 0; f < WATER_FRAMES; f++) {
        const c = p.cell + f;
        const frame = new Rectangle((c % ATLAS_COLS) * SRC_TILE, Math.floor(c / ATLAS_COLS) * SRC_TILE, SRC_TILE, SRC_TILE);
        list.push(new Texture({ source: this.source.source, frame }));
      }
      this.frames.set(p.key, list);
    }
  }

  /** Frames of the tile at map index `key`, or undefined when it shows no lap. */
  get(key: number): Texture[] | undefined {
    return this.frames.get(key);
  }

  destroy(): void {
    for (const list of this.frames.values()) for (const t of list) t.destroy(false);
    this.frames.clear();
    this.source?.destroy(true);
    this.source = null;
  }
}

export class WaterLayer {
  /** Surface windows, shared by every segment with the same start cell and width. */
  private windows = new Map<number, { t: Texture; a: number; b: number }>();
  private cellsPerSide: number;
  private tiles = 0;
  private laps: Lap[] = [];
  /** Chunks drawn from a cache, refreshed on each frame step (still water only). */
  private cached: Container[] = [];
  private style: WaterStyleConfig;
  private frame = -1;
  private drift = { x: -1, y: -1 };
  private lapAtlas: LapAtlas;
  private readonly onTick = (): void => this.tick(performance.now());

  constructor(
    private water: WaterArt,
    /** Quadrants of the cut-out banks. */
    private banks: BlobTextures,
    /** Static banks, for a set the water sheet lacks. */
    private staticBanks: BlobTextures,
    private map: MapData,
  ) {
    this.style = water.styles[waterStyleOf(map)];
    this.lapAtlas = new LapAtlas(water, map);
    this.cellsPerSide = Math.max(1, Math.round(water.period / SRC_TILE));
  }

  /** The shared window for a segment starting at pattern cell (a, b), `w` tiles wide. */
  private windowFor(a: number, b: number, w: number): Texture {
    const n = this.cellsPerSide;
    const key = (b * n + a) * (n + 1) + w;
    let win = this.windows.get(key);
    if (!win) {
      const frame = new Rectangle(0, 0, w * SRC_TILE, SRC_TILE);
      win = { t: new Texture({ source: this.water.surface[0]!.source, frame, dynamic: true }), a, b };
      this.windows.set(key, win);
    }
    return win.t;
  }

  /** Water of one chunk, or null when it has none. Add it below that chunk's cached ground. */
  buildChunk(x0: number, y0: number, x1: number, y1: number): Container | null {
    const map = this.map;
    let has = false;
    for (let y = y0; y < y1 && !has; y++) for (let x = x0; x < x1 && !has; x++) has = map.ground[y * map.width + x] === Ground.Water;
    if (!has) return null;
    const c = new Container();
    c.label = "water";
    c.position.set(x0 * TILE, y0 * TILE);
    const surface = new Container();
    const laps = new Container();
    const banks = new Container();
    // Laps go over the banks: the bank's shallows (cobbles) are water too, and the line may cross them.
    c.addChild(surface, banks, laps);
    const n = this.cellsPerSide;
    for (const seg of surfaceSegments(map, x0, y0, x1, y1, n)) {
      const s = new Sprite(this.windowFor(seg.x % n, seg.y % n, seg.w));
      s.position.set((seg.x - x0) * TILE, (seg.y - y0) * TILE);
      s.scale.set(SCALE);
      surface.addChild(s);
      this.tiles += seg.w;
    }
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (map.ground[y * map.width + x] !== Ground.Water) continue;
        const px = (x - x0) * TILE;
        const py = (y - y0) * TILE;
        const plan = planTile(map, x, y);
        if (!plan.blob) continue;
        const lap = this.lapAtlas.get(y * map.width + x);
        if (lap) {
          const s = new Sprite(lap[0]!);
          s.position.set(px, py);
          s.scale.set(SCALE);
          laps.addChild(s);
          this.laps.push({ s, frames: lap });
        }
        const set = plan.blob.set;
        const cutOut = this.banks.has(set);
        if (!cutOut && !this.staticBanks.has(set)) continue;
        for (const q of QUADRANTS) {
          const piece = plan.blob.pieces[q];
          if (!piece) continue;
          const tex = (cutOut ? this.banks : this.staticBanks).quad(set, piece, q);
          if (!tex) continue;
          const b = new Sprite(tex);
          b.position.set(px + (q & 1 ? HALF : 0), py + (q & 2 ? HALF : 0));
          b.width = HALF;
          b.height = HALF;
          banks.addChild(b);
        }
      }
    }
    c.cullable = true;
    c.cullArea = new Rectangle(0, 0, (x1 - x0) * TILE, (y1 - y0) * TILE);
    if (!this.style.flow) {
      // Still water changes only on a frame step: cache it like the ground and redraw it then.
      c.cacheAsTexture({ scaleMode: "nearest", antialias: false });
      this.cached.push(c);
    }
    return c;
  }

  /** Starts the animation (after every chunk is built). */
  start(): void {
    if (!this.tiles) return;
    this.tick(performance.now());
    Ticker.shared.add(this.onTick);
  }

  tick(now: number): void {
    const f = waterFrame(now, this.style.ms);
    const flow = this.style.flow;
    const p = this.water.period;
    const dx = flow ? waterDrift(now, flow.x, p) : 0;
    const dy = flow ? waterDrift(now, flow.y, p) : 0;
    const frameChanged = f !== this.frame;
    if (!frameChanged && dx === this.drift.x && dy === this.drift.y) return;
    if (frameChanged) for (const l of this.laps) l.s.texture = l.frames[f]!;
    this.frame = f;
    this.drift = { x: dx, y: dy };
    for (const { t, a, b } of this.windows.values()) {
      const w = surfaceWindow(a, b, SRC_TILE, p, dx, dy);
      const base = this.water.surface[f]!.frame;
      t.frame.x = base.x + w.x;
      t.frame.y = base.y + w.y;
      t.update();
    }
    for (const c of this.cached) if (!c.destroyed) c.updateCacheTexture();
  }

  destroy(): void {
    Ticker.shared.remove(this.onTick);
    this.laps = [];
    for (const c of this.cached) if (!c.destroyed) c.cacheAsTexture(false);
    this.cached = [];
    this.lapAtlas.destroy();
    for (const { t } of this.windows.values()) t.destroy(false);
    this.windows.clear();
  }
}
