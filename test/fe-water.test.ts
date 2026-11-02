import { describe, expect, it } from "vitest";
import catalog from "../src/client/public/assets/lpc/catalog.json";
import { chunkBands, pieceQuadRect, type BlobPiece, type BlobSet, type Quadrant } from "../src/client/render/ground-autotile";
import {
  DEFAULT_WATER_STYLES,
  LAP_MARGIN,
  WATER_BANK_KEYS,
  WATER_FRAMES,
  lapFrames,
  lapLit,
  lapStage,
  lapWindow,
  parseWaterAnim,
  parseWaterStyle,
  surfaceSegments,
  surfaceWindow,
  waterDrift,
  waterFrame,
  waterStyleOf,
} from "../src/client/render/water-anim";
import { getMap } from "../src/shared/maps";
import { Ground, type MapData } from "../src/shared/types";

interface NodeFs {
  readFileSync(path: string): { readUInt32BE(at: number): number };
}
const nodeFs = () => import(/* @vite-ignore */ ["node", "fs"].join(":")) as Promise<NodeFs>;

const G: Record<string, Ground> = { ".": Ground.Grass, ",": Ground.Sand, "~": Ground.Water, "=": Ground.Wood, " ": Ground.Void };
function mapOf(rows: string[], extra: Partial<MapData> = {}): MapData {
  return {
    zone: "village", name: "t", width: rows[0]!.length, height: rows.length,
    ground: rows.flatMap((r) => [...r].map((c) => G[c]!)),
    props: [], exits: [], spawns: {}, npcs: [], monsters: [], ambient: "day", ...extra,
  };
}
const T = 32;
/** A bank that is solid in the outer half of every bank quadrant, like the real sheets. */
const halfBank = (_set: BlobSet, piece: BlobPiece, q: Quadrant): Uint8Array => {
  const m = new Uint8Array(16 * 16);
  const north = piece.block === "outer" && piece.row === 0 && !(q & 2);
  const south = piece.block === "outer" && piece.row === 2 && !!(q & 2);
  const west = piece.block === "outer" && piece.col === 0 && !(q & 1);
  const east = piece.block === "outer" && piece.col === 2 && !!(q & 1);
  if (north || south || west || east) m.fill(1);
  return m;
};

describe("water timing", () => {
  it("steps frames every `ms` and loops", () => {
    expect([0, 259, 260, 519, 520, 780, 1040].map((t) => waterFrame(t, 260))).toEqual([0, 0, 1, 1, 2, 3, 0]);
  });
  it("applies a phase, never negative", () => {
    expect(waterFrame(0, 260, 4, 3)).toBe(3);
    expect(waterFrame(260, 260, 4, 3)).toBe(0);
    expect(waterFrame(0, 260, 4, -1)).toBe(3);
  });
  it("holds frame 0 for a single frame or bad timing", () => {
    expect(waterFrame(5000, 260, 1)).toBe(0);
    expect(waterFrame(5000, 0)).toBe(0);
  });
  it("drifts whole pixels and wraps at the period", () => {
    expect(waterDrift(0, 6, 192)).toBe(0);
    expect(waterDrift(999, 6, 192)).toBe(5);
    expect(waterDrift(1000, 6, 192)).toBe(6);
    expect(waterDrift(32_000, 6, 192)).toBe(0);
    expect(waterDrift(1000, -6, 192)).toBe(186);
    expect(waterDrift(1000, 0, 192)).toBe(0);
  });
});

describe("water styles", () => {
  it("rivers drift, ponds and the default stay put", () => {
    expect(waterStyleOf(getMap("riverside"))).toBe("river");
    expect(waterStyleOf(getMap("village"))).toBe("still");
    expect(waterStyleOf(getMap("home"))).toBe("still");
    expect(DEFAULT_WATER_STYLES.still.flow).toBeNull();
    expect(DEFAULT_WATER_STYLES.river.flow).not.toBeNull();
  });
  it("parses catalog styles and falls back field by field", () => {
    expect(parseWaterStyle({ ms: 220, flow: [6, 0] }, "river")).toEqual({ ms: 220, flow: { x: 6, y: 0 } });
    expect(parseWaterStyle({ ms: 5 }, "still")).toEqual(DEFAULT_WATER_STYLES.still);
    expect(parseWaterStyle({ flow: null }, "river").flow).toBeNull();
    expect(parseWaterStyle({ flow: [1e9, 0] }, "river").flow).toEqual(DEFAULT_WATER_STYLES.river.flow);
    expect(parseWaterStyle("junk", "river")).toEqual(DEFAULT_WATER_STYLES.river);
  });
});

describe("water surface layout", () => {
  it("gives neighbouring tiles neighbouring windows, so the pattern has no seams", () => {
    const a = surfaceWindow(3, 2, T, 192, 0, 0);
    const b = surfaceWindow(4, 2, T, 192, 0, 0);
    expect(b.x - a.x).toBe(T);
    expect(a.y).toBe(64);
    // Drift slides every window the same way, wrapping inside the period.
    expect(surfaceWindow(0, 0, T, 192, 5, 0)).toEqual({ x: 187, y: 0 });
    expect(surfaceWindow(6, 6, T, 192, 0, 0)).toEqual(surfaceWindow(0, 0, T, 192, 0, 0));
  });
  it("cuts water rows into segments that fit one window", () => {
    const m = mapOf(["..~~~~~~~~~~~~..", "~~~.~~~~~~~~~~~~"]);
    const segs = surfaceSegments(m, 0, 0, 16, 2, 6);
    for (const s of segs) {
      expect(s.w).toBeGreaterThan(0);
      expect((s.x % 6) + s.w).toBeLessThanOrEqual(6);
      for (let x = s.x; x < s.x + s.w; x++) expect(m.ground[s.y * m.width + x]).toBe(Ground.Water);
    }
    const covered = segs.reduce((n, s) => n + s.w, 0);
    expect(covered).toBe(m.ground.filter((g) => g === Ground.Water).length);
  });
  it("covers every water tile of the real maps exactly once", () => {
    for (const zone of ["home", "village", "riverside"] as const) {
      const m = getMap(zone);
      const seen = new Uint8Array(m.ground.length);
      for (let cy = 0; cy < m.height; cy += 16)
        for (let cx = 0; cx < m.width; cx += 16)
          for (const s of surfaceSegments(m, cx, cy, cx + 16, cy + 16, 6)) for (let x = s.x; x < s.x + s.w; x++) seen[s.y * m.width + x]!++;
      m.ground.forEach((g, i) => expect(seen[i], `${zone} ${i}`).toBe(g === Ground.Water ? 1 : 0));
    }
  });
});

describe("lap line", () => {
  const pond = mapOf(["......", ".~~~~.", ".~~~~.", ".~~~~.", "......"]);
  it("marks bank quadrants and land as solid, docks and the map edge as water", () => {
    const w = lapWindow(pond, 1, 1, T, halfBank);
    const size = T + 2 * LAP_MARGIN;
    expect(w.length).toBe(size * size);
    // Top-left of the window is the land corner; the tile's south-east quadrant is open water.
    expect(w[0]).toBe(1);
    expect(w[(LAP_MARGIN + 24) * size + LAP_MARGIN + 24]).toBe(0);
    const dock = mapOf(["~~~", "~=~", "~~~"]);
    expect(lapWindow(dock, 0, 0, T, halfBank).every((v) => v === 0)).toBe(true);
  });
  it("lights only water, 1 to 3 px off the bank", () => {
    const solid = lapWindow(pond, 1, 1, T, halfBank);
    const frames = lapFrames(solid, 1, 1, T)!;
    expect(frames).toHaveLength(WATER_FRAMES);
    const size = T + 2 * LAP_MARGIN;
    let lit = 0;
    for (const f of frames)
      for (let k = 0; k < f.length; k++) {
        if (!f[k]) continue;
        lit++;
        const i = k % T;
        const j = Math.floor(k / T);
        expect(solid[(j + LAP_MARGIN) * size + i + LAP_MARGIN], "lap on the bank").toBe(0);
        // The bank covers the outer half: the line sits in the inner half, near it.
        expect(Math.min(i, j)).toBeGreaterThanOrEqual(16);
        expect(Math.min(i, j)).toBeLessThan(16 + 3);
      }
    expect(lit).toBeGreaterThan(0);
  });
  it("has no lap on open water", () => {
    const sea = mapOf(["~~~~~", "~~~~~", "~~~~~"]);
    expect(lapFrames(lapWindow(sea, 2, 1, T, halfBank), 2, 1, T)).toBeNull();
  });
  it("washes out and settles: d1, then d2, then a faint d3, then calm", () => {
    let d1 = 0;
    let d3 = 0;
    for (let x = 0; x < 300; x++) {
      if (lapLit(0, 1, x, 0)) d1++;
      if (lapLit(2, 3, x, 0)) d3++;
      expect(lapLit(0, 2, x, 0)).toBe(false);
      expect(lapLit(3, 1, x, 0)).toBe(false);
    }
    expect(d1).toBeGreaterThan(d3);
    expect(d3).toBeGreaterThan(0);
  });
  it("keys stage and dashes to world pixels, so lines run on across tiles", () => {
    expect(lapStage(0, 0, 0)).toBe(0);
    expect(lapStage(1, 0, 0)).toBe(1);
    // The phase steps along the shore, so the shore never pulses all at once.
    const stages = new Set(Array.from({ length: 200 }, (_, x) => lapStage(0, x, 0)));
    expect(stages.size).toBe(WATER_FRAMES);
    expect(lapLit(0, 1, 100, 7)).toBe(lapLit(0, 1, 100, 7));
  });
});

describe("chunk bands", () => {
  it("drops rows with nothing to draw and trims the rest", () => {
    const need = (x: number, y: number) => (y === 1 && x >= 2 && x < 5) || (y === 2 && x === 7) || y === 5;
    expect(chunkBands(need, 0, 0, 16, 8)).toEqual([
      { x0: 2, y0: 1, x1: 8, y1: 3 },
      { x0: 0, y0: 5, x1: 16, y1: 6 },
    ]);
    expect(chunkBands(() => false, 0, 0, 16, 16)).toEqual([]);
    expect(chunkBands(() => true, 16, 0, 32, 16)).toEqual([{ x0: 16, y0: 0, x1: 32, y1: 16 }]);
  });
});

describe("water_anim catalog entry", () => {
  const entry = (catalog as { terrain: Record<string, unknown> }).terrain.water_anim;
  it("parses with four surface frames and every bank sheet", () => {
    const w = parseWaterAnim(entry, T)!;
    expect(w).not.toBeNull();
    expect(w.surface).toHaveLength(WATER_FRAMES);
    expect(w.period % T).toBe(0);
    for (const k of WATER_BANK_KEYS) expect(w.banks[k], k).toBeTruthy();
    expect(w.styles.river.flow).not.toBeNull();
    expect(w.styles.still.flow).toBeNull();
    expect(w.lap.water.length).toBeGreaterThan(0);
  });
  it("keeps every rect inside the PNG", async () => {
    const w = parseWaterAnim(entry, T)!;
    const b = (await nodeFs()).readFileSync(`src/client/public/assets/lpc/${w.file}`);
    const size = { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    for (const [x, y, rw, rh] of [...w.surface, ...Object.values(w.banks)]) {
      expect(x + rw).toBeLessThanOrEqual(size.w);
      expect(y + rh).toBeLessThanOrEqual(size.h);
    }
  });
  it("rejects a half-finished entry (still water instead)", () => {
    const e = JSON.parse(JSON.stringify(entry));
    e.frames.surface.pop();
    expect(parseWaterAnim(e, T)).toBeNull();
    const f = JSON.parse(JSON.stringify(entry));
    delete f.banks.dirtInner2x2;
    expect(parseWaterAnim(f, T)).toBeNull();
    expect(parseWaterAnim(null, T)).toBeNull();
  });
  it("cuts bank quadrants from the right block", () => {
    expect(pieceQuadRect({ x: 0, y: 384, width: 96 }, { block: "outer", col: 1, row: 0 }, 3)).toEqual({ x: 48, y: 400, w: 16, h: 16 });
    expect(pieceQuadRect({ x: 192, y: 384, width: 64 }, { block: "inner", col: 1, row: 1 }, 0)).toEqual({ x: 224, y: 416, w: 16, h: 16 });
  });
});
