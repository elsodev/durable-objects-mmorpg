import { describe, expect, it } from "vitest";
import { buildCollision, canStand, isBlocked, type CollisionGrid } from "../src/shared/engine";
import { getMap } from "../src/shared/maps";
import { MOUTH } from "../src/shared/maps/quarry";
import { Ground, OUTDOOR_ZONES, type MapData, type MapExit, type Vec2 } from "../src/shared/types";

// Node built-ins without Node types (the worker tsconfig checks tests with Workers types only).
const proc = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process;
const fs = proc.getBuiltinModule("node:fs") as { readFileSync(p: string, enc?: "utf8"): string & Uint8Array };
const zlib = proc.getBuiltinModule("node:zlib") as { inflateSync(b: Uint8Array): Uint8Array };

const ASSETS = "src/client/public/assets/lpc/";
const quarry = getMap("quarry");

/** 4-connected flood fill over open tiles from a point. */
function reach(map: MapData, grid: CollisionGrid, from: Vec2): Set<string> {
  const start = { x: Math.floor(from.x), y: Math.floor(from.y) };
  const seen = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i]!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const k = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height || seen.has(k) || isBlocked(grid, nx, ny)) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

const exitTo = (map: MapData, to: string): MapExit => map.exits.find((e) => e.to === to)!;
const tilesOf = (e: MapExit) => Array.from({ length: e.w * e.h }, (_, i) => ({ x: e.x + (i % e.w), y: e.y + Math.floor(i / e.w) }));

/** Decodes an 8-bit RGBA, non-interlaced PNG (what the art scripts write). */
function readPng(path: string): { w: number; h: number; px: (x: number, y: number) => [number, number, number, number] } {
  const buf = new Uint8Array(fs.readFileSync(path));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const w = view.getUint32(16);
  const h = view.getUint32(20);
  expect([buf[24], buf[25], buf[28]]).toEqual([8, 6, 0]);
  const idat: number[] = [];
  for (let o = 8; o < buf.length; ) {
    const len = view.getUint32(o);
    if (String.fromCharCode(...buf.subarray(o + 4, o + 8)) === "IDAT") idat.push(...buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Uint8Array.from(idat));
  const stride = w * 4;
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const v = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= 4 ? out[y * stride + i - 4]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!;
      out[y * stride + i] = (v + pred) & 0xff;
    }
  }
  return { w, h, px: (x, y) => [...out.subarray(y * stride + x * 4, y * stride + x * 4 + 4)] as [number, number, number, number] };
}

describe("quarry", () => {
  it("is an outdoor zone in daylight with no monsters", () => {
    expect(OUTDOOR_ZONES).toContain("quarry");
    expect(quarry.ambient).toBe("day");
    expect(quarry.monsters).toEqual([]);
  });

  it("reaches every exit from every spawn", () => {
    const grid = buildCollision(quarry);
    for (const [name, s] of Object.entries(quarry.spawns)) {
      expect(canStand(grid, s.x, s.y), name).toBe(true);
      const seen = reach(quarry, grid, s);
      for (const e of quarry.exits) expect(tilesOf(e).some((t) => seen.has(`${t.x},${t.y}`)), `${name} -> ${e.to}`).toBe(true);
    }
  });

  it("runs a dirt road from the village exit to the cave mouth", () => {
    const dirt = (x: number, y: number) => quarry.ground[y * quarry.width + x] === Ground.Dirt;
    const west = exitTo(quarry, "village");
    const mouth = exitTo(quarry, "caves");
    const start = tilesOf(west).find((t) => dirt(t.x, t.y))!;
    expect(start).toBeDefined();
    const seen = new Set([`${start.x},${start.y}`]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const { x, y } = queue[i]!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = `${x + dx},${y + dy}`;
        if (x + dx >= 0 && y + dy >= 0 && x + dx < quarry.width && y + dy < quarry.height && dirt(x + dx, y + dy) && !seen.has(k)) {
          seen.add(k);
          queue.push({ x: x + dx, y: y + dy });
        }
      }
    }
    // The road ends on the apron right under the mouth's exit tiles.
    expect(tilesOf(mouth).some((t) => seen.has(`${t.x},${t.y + 1}`))).toBe(true);
  });

  it("puts the cave exit in the bottom row of the cave mouth, inside the dark opening", () => {
    const prop = quarry.props.find((p) => p.type === "cave_mouth")!;
    expect(prop).toMatchObject(MOUTH);
    const e = exitTo(quarry, "caves");
    expect(e.y).toBe(prop.y + prop.h - 1);
    expect(e.h).toBe(1);
    expect(e.x).toBeGreaterThanOrEqual(prop.x);
    expect(e.x + e.w).toBeLessThanOrEqual(prop.x + prop.w);

    const cat = JSON.parse(fs.readFileSync(`${ASSETS}catalog.json`, "utf8"));
    const art = cat.props.cave_mouth as { file: string; rect: [number, number, number, number]; anchor: [number, number] };
    const png = readPng(`${ASSETS}${art.file}`);
    const [rx, ry, rw, rh] = art.rect;
    expect(rw).toBe(prop.w * 32);
    expect(rh).toBe(prop.h * 32);
    expect(art.anchor).toEqual([rw / 2, rh]); // bottom centre: the art fills the footprint exactly
    const dark = (x: number, y: number) => {
      const [r, g, b, a] = png.px(rx + x, ry + y);
      return a === 255 && r + g + b < 200;
    };
    // Every exit tile is dark across its middle at foot level and halfway up the arch.
    for (const t of tilesOf(e)) {
      const cx = (t.x - prop.x) * 32;
      for (let x = cx + 6; x < cx + 26; x++) {
        expect(dark(x, rh - 12), `foot ${t.x}:${x}`).toBe(true);
        expect(dark(x, rh - 48), `arch ${t.x}:${x}`).toBe(true);
      }
    }
    // The rock either side of the opening is not.
    expect(dark(0, rh - 48)).toBe(false);
    expect(dark(rw - 1, rh - 48)).toBe(false);
  });

  it("lines the whole north edge with cliff and keeps the clifftop out of reach", () => {
    const grid = buildCollision(quarry);
    const cliff = quarry.props.filter((p) => p.type === "cave_mouth" || p.type === "cliff_face" || p.type === "cliff_vines");
    const cols = new Set<number>();
    for (const p of cliff) for (let x = p.x; x < p.x + p.w; x++) {
      expect(cols.has(x), `cliff overlap at ${x}`).toBe(false);
      cols.add(x);
    }
    expect(cols.size).toBe(quarry.width);
    const seen = reach(quarry, grid, quarry.spawns.default!);
    for (const k of seen) expect(Number(k.split(",")[1]), k).toBeGreaterThanOrEqual(MOUTH.y + MOUTH.h - 1);
  });
});

describe("village -> quarry -> caves and back", () => {
  /** Walks through `exit` of `from`: the arrival spot in the target map. */
  function arrive(from: MapData, to: MapData): Vec2 {
    const e = exitTo(from, to.zone);
    expect(e.spawn).toBe(`from_${from.zone}`);
    return to.spawns[e.spawn]!;
  }
  /** The arrival is open, not inside an exit, and can walk to the exit back and the next one. */
  function landsWell(map: MapData, at: Vec2, back: string, next?: string): void {
    const grid = buildCollision(map);
    expect(canStand(grid, at.x, at.y), `${map.zone} arrival`).toBe(true);
    expect(map.exits.some((e) => tilesOf(e).some((t) => t.x === Math.floor(at.x) && t.y === Math.floor(at.y)))).toBe(false);
    const seen = reach(map, grid, at);
    for (const to of next ? [back, next] : [back]) expect(tilesOf(exitTo(map, to)).some((t) => seen.has(`${t.x},${t.y}`)), `${map.zone} -> ${to}`).toBe(true);
    // Close to the exit it came through (within a few tiles).
    const e = exitTo(map, back);
    const d = Math.hypot(Math.max(e.x - at.x, 0, at.x - (e.x + e.w)), Math.max(e.y - at.y, 0, at.y - (e.y + e.h)));
    expect(d).toBeLessThan(4);
  }

  it("lands somewhere sensible at every step", () => {
    const village = getMap("village");
    const caves = getMap("caves");
    expect(village.exits.some((e) => e.to === "caves")).toBe(false);
    expect(caves.exits.some((e) => e.to === "village")).toBe(false);

    landsWell(quarry, arrive(village, quarry), "village", "caves");
    const inCaves = arrive(quarry, caves);
    landsWell(caves, inCaves, "quarry");
    landsWell(quarry, arrive(caves, quarry), "caves", "village");
    landsWell(village, arrive(quarry, village), "quarry");
  });

  it("enters the caves facing the way you walked in: the cave mouth faces south, the way out is south", () => {
    const caves = getMap("caves");
    const out = exitTo(caves, "quarry");
    expect(caves.spawns.from_quarry!.y).toBeLessThan(out.y);
    expect(quarry.spawns.from_caves!.y).toBeGreaterThan(exitTo(quarry, "caves").y);
  });

  it("points the village sign at the quarry and the quarry signs both ways", () => {
    const sign = (m: MapData, id: string) => m.props.find((p) => p.id === id)?.label;
    expect(sign(getMap("village"), "sign_quarry")).toMatch(/Quarry/);
    expect(sign(quarry, "sign_village")).toMatch(/Village/);
    expect(sign(quarry, "sign_caves")).toMatch(/Caves/);
    expect(sign(getMap("caves"), "sign_quarry")).toMatch(/Quarry/);
  });
});
