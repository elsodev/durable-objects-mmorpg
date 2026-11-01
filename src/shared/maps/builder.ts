// MapBuilder: small toolkit used by each map file to paint ground, place props and
// scatter decoration deterministically. It tracks which tiles are blocked by props/rocks and
// which tiles are "reserved" (paths, doorways, spawns) so random scatter never blocks them.

import { BLOCKING_GROUND, Ground, type MapData, type MapExit, type MonsterSpawn, type NpcSpawn, type Vec2 } from "../types";
import { WALKABLE_PROPS } from "./interiors/props";
import { PROP_FOOTPRINTS, type PropType } from "./props";
import { Rng } from "./rng";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Ore = "stone" | "copper" | "iron" | "gem";

export class MapBuilder {
  readonly width: number;
  readonly height: number;
  readonly ground: Ground[];
  readonly rng: Rng;
  /** 1 where a prop or rock footprint covers the tile. */
  private blocked: Uint8Array;
  /** 1 where scatter must not place anything (paths, doorways, spawn areas). */
  private reserved: Uint8Array;
  private props: MapData["props"] = [];
  private exits: MapExit[] = [];
  private spawns: Record<string, Vec2> = {};
  private npcs: NpcSpawn[] = [];
  private monsters: MonsterSpawn[] = [];
  private rocks: NonNullable<MapData["rocks"]> = [];
  private propCounters = new Map<string, number>();

  constructor(width: number, height: number, fill: Ground, seed: number) {
    this.width = width;
    this.height = height;
    this.ground = new Array<Ground>(width * height).fill(fill);
    this.blocked = new Uint8Array(width * height);
    this.reserved = new Uint8Array(width * height);
    this.rng = new Rng(seed);
  }

  // ---------- ground ----------

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Ground {
    return this.inBounds(x, y) ? this.ground[y * this.width + x]! : Ground.Void;
  }

  set(x: number, y: number, g: Ground): void {
    if (this.inBounds(x, y)) this.ground[y * this.width + x] = g;
  }

  fill(r: Rect, g: Ground): void {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) this.set(x, y, g);
  }

  /** Rectangle outline (walls). */
  outline(r: Rect, g: Ground): void {
    for (let x = r.x; x < r.x + r.w; x++) {
      this.set(x, r.y, g);
      this.set(x, r.y + r.h - 1, g);
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      this.set(r.x, y, g);
      this.set(r.x + r.w - 1, y, g);
    }
  }

  /**
   * Paint a path of the given width along axis-aligned segments between waypoints
   * (horizontal first, then vertical). Only overwrites tiles listed in `over`.
   * Path tiles are reserved so scatter keeps them clear.
   */
  path(points: Vec2[], width = 2, g: Ground = Ground.Dirt, over: Ground[] = [Ground.Grass, Ground.Sand, Ground.Dirt]): void {
    const paint = (x: number, y: number) => {
      for (let oy = 0; oy < width; oy++)
        for (let ox = 0; ox < width; ox++) {
          const tx = x + ox;
          const ty = y + oy;
          if (over.includes(this.get(tx, ty))) this.set(tx, ty, g);
          this.reserve({ x: tx - 1, y: ty - 1, w: 3, h: 3 });
        }
    };
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const sx = Math.sign(b.x - a.x);
      for (let x = a.x; x !== b.x; x += sx) paint(x, a.y);
      const sy = Math.sign(b.y - a.y);
      for (let y = a.y; y !== b.y; y += sy) paint(b.x, y);
      paint(b.x, b.y);
    }
  }

  /** Fill a rough ellipse (noise jitters the edge only) — caves chambers, ponds, islands. */
  blob(cx: number, cy: number, rx: number, ry: number, g: Ground, noise = 0.2): void {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d <= 1 + (this.rng.float() - 0.5) * noise) this.set(x, y, g);
      }
  }

  /** Turn walkable land touching water into sand (1 tile, plus an occasional 2nd ring). */
  shore(): void {
    const isWater = (x: number, y: number) => this.get(x, y) === Ground.Water;
    const ring = (x: number, y: number, r: number) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (isWater(x + dx, y + dy)) return true;
      return false;
    };
    const next = this.ground.slice();
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        const g = this.get(x, y);
        if (g !== Ground.Grass && g !== Ground.Dirt) continue;
        if (ring(x, y, 1) || (ring(x, y, 2) && this.rng.chance(0.45))) next[y * this.width + x] = Ground.Sand;
      }
    for (let i = 0; i < next.length; i++) this.ground[i] = next[i]!;
  }

  // ---------- occupancy ----------

  reserve(r: Rect): void {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) if (this.inBounds(x, y)) this.reserved[y * this.width + x] = 1;
  }

  isBlocked(x: number, y: number): boolean {
    return !this.inBounds(x, y) || this.blocked[y * this.width + x] === 1;
  }

  /** Walkable ground and no prop/rock on it. */
  isOpen(x: number, y: number): boolean {
    return this.inBounds(x, y) && !BLOCKING_GROUND.has(this.get(x, y)) && !this.isBlocked(x, y);
  }

  private markBlocked(r: Rect): void {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) if (this.inBounds(x, y)) this.blocked[y * this.width + x] = 1;
  }

  // ---------- props ----------

  /**
   * Place a prop with its default footprint (or an explicit size). Throws if it overlaps another
   * prop, so layout mistakes surface immediately in tests.
   */
  prop(type: PropType, x: number, y: number, opts: { id?: string; w?: number; h?: number; label?: string } = {}): string {
    const w = opts.w ?? PROP_FOOTPRINTS[type].w;
    const h = opts.h ?? PROP_FOOTPRINTS[type].h;
    if (WALKABLE_PROPS.has(type)) {
      // Flat floor decoration (rugs): may lie under furniture and never blocks.
      const id = opts.id ?? this.nextId(type);
      this.props.push({ id, type, x, y, w, h, walkable: true });
      return id;
    }
    for (let ty = y; ty < y + h; ty++)
      for (let tx = x; tx < x + w; tx++)
        if (this.isBlocked(tx, ty)) throw new Error(`prop ${type} at ${x},${y} overlaps another prop at ${tx},${ty}`);
    const id = opts.id ?? this.nextId(type);
    this.props.push(opts.label ? { id, type, x, y, w, h, label: opts.label } : { id, type, x, y, w, h });
    this.markBlocked({ x, y, w, h });
    return id;
  }

  /** Place a prop only if its footprint is free; returns false otherwise. */
  tryProp(type: PropType, x: number, y: number): boolean {
    const { w, h } = PROP_FOOTPRINTS[type];
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (this.isBlocked(tx, ty)) return false;
    this.prop(type, x, y);
    return true;
  }

  private nextId(type: string): string {
    const n = (this.propCounters.get(type) ?? 0) + 1;
    this.propCounters.set(type, n);
    return `${type}_${n}`;
  }

  /**
   * True if a 1x1 obstacle at (x,y) can be added without ever cutting walkable space apart:
   * the tile and all 8 neighbours must be open and unreserved. (Removing a tile whose whole
   * 3x3 neighbourhood is open cannot disconnect a 4-connected region.)
   */
  private safeSingle(x: number, y: number, ground?: Ground[]): boolean {
    if (this.reserved[y * this.width + x] === 1) return false;
    if (ground && !ground.includes(this.get(x, y))) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!this.isOpen(x + dx, y + dy)) return false;
    return true;
  }

  /** Scatter up to `count` 1x1 props inside `area` without blocking anything important. */
  scatter(type: PropType, count: number, area: Rect, ground: Ground[] = [Ground.Grass]): void {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      const x = this.rng.int(area.x, area.x + area.w - 1);
      const y = this.rng.int(area.y, area.y + area.h - 1);
      if (!this.inBounds(x, y) || !this.safeSingle(x, y, ground)) continue;
      this.prop(type, x, y);
      placed++;
    }
  }

  /**
   * Place a 1x1 decoration at (x,y) or the nearest tile (within 4) where it cannot block anything.
   * Returns false if nowhere fits.
   */
  decorNear(type: PropType, x: number, y: number, opts: { id?: string } = {}): boolean {
    for (let r = 0; r <= 4; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = x + dx;
          const ty = y + dy;
          if (!this.inBounds(tx, ty) || !this.safeSingle(tx, ty)) continue;
          this.prop(type, tx, ty, { ...opts, w: 1, h: 1 });
          return true;
        }
    return false;
  }

  /**
   * Dense tree line along the map edge (thickness tiles), skipping reserved tiles (exits),
   * with a ragged inner edge. Only placed on open, unreserved land.
   */
  borderTrees(thickness = 2, ragged = 0.35): void {
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        const d = Math.min(x, y, this.width - 1 - x, this.height - 1 - y);
        const want = d < thickness || (d === thickness && this.rng.chance(ragged));
        if (!want || this.reserved[y * this.width + x] === 1 || !this.isOpen(x, y)) continue;
        this.prop("tree", x, y);
      }
  }

  // ---------- rocks (mining nodes, block until broken) ----------

  /** Scatter mining rocks in an area, using the same never-disconnect rule as scatter(). */
  scatterRocks(prefix: string, ores: Ore[], count: number, area: Rect): void {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 60; tries++) {
      const x = this.rng.int(area.x, area.x + area.w - 1);
      const y = this.rng.int(area.y, area.y + area.h - 1);
      if (!this.inBounds(x, y) || !this.safeSingle(x, y)) continue;
      placed++;
      this.rocks.push({ id: `${prefix}_${placed}`, x, y, ore: this.rng.pick(ores) });
      this.markBlocked({ x, y, w: 1, h: 1 });
    }
  }

  // ---------- gameplay markers ----------

  /** Named spawn at the centre of tile (tx, ty). Reserves a small area around it. */
  spawn(name: string, tx: number, ty: number): void {
    this.spawns[name] = { x: tx + 0.5, y: ty + 0.5 };
    this.reserve({ x: tx - 1, y: ty - 1, w: 3, h: 3 });
  }

  exit(r: Rect, to: MapExit["to"], spawn: string): void {
    this.exits.push({ ...r, to, spawn });
    this.reserve({ x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 });
  }

  /** `feetY` overrides the tile-centre y (e.g. a shopkeeper standing behind a stall counter). */
  npc(npcId: string, tx: number, ty: number, wander: number, feetY?: number): void {
    this.npcs.push({ npcId, x: tx + 0.5, y: feetY ?? ty + 0.5, wander });
    this.reserve({ x: tx - 1, y: ty - 1, w: 3, h: 3 });
  }

  monster(type: MonsterSpawn["type"], tx: number, ty: number, radius: number, count: number): void {
    this.monsters.push({ type, x: tx + 0.5, y: ty + 0.5, radius, count });
    this.reserve({ x: tx - 1, y: ty - 1, w: 3, h: 3 });
  }

  /**
   * Convert every walkable tile not 4-connected to (sx, sy) into `wall`. Used by caves so noise
   * never leaves sealed pockets that might receive rocks.
   */
  sealUnreachable(sx: number, sy: number, wall: Ground): void {
    const seen = new Uint8Array(this.width * this.height);
    const stack = [sy * this.width + sx];
    seen[stack[0]!] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % this.width;
      const y = (i - x) / this.width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = ny * this.width + nx;
        if (seen[j] || BLOCKING_GROUND.has(this.ground[j]!)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    for (let i = 0; i < this.ground.length; i++) if (!seen[i] && !BLOCKING_GROUND.has(this.ground[i]!)) this.ground[i] = wall;
  }

  build(meta: Pick<MapData, "zone" | "name" | "ambient" | "farmArea" | "floorArea">): MapData {
    const map: MapData = {
      ...meta,
      width: this.width,
      height: this.height,
      ground: this.ground.slice(),
      props: this.props,
      exits: this.exits,
      spawns: this.spawns,
      npcs: this.npcs,
      monsters: this.monsters,
    };
    if (this.rocks.length) map.rocks = this.rocks;
    return map;
  }
}
