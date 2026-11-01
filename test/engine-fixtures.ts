// Tiny hand-made maps for engine tests. Legend: '.' grass, '#' wall, '~' water, 'w' wood floor.
import { Ground, type MapData } from "../src/shared/types";

const LEGEND: Record<string, Ground> = {
  ".": Ground.Grass,
  "#": Ground.Wall,
  "~": Ground.Water,
  w: Ground.Wood,
  d: Ground.Dirt,
};

export function makeMap(rows: string[], extra: Partial<MapData> = {}): MapData {
  const height = rows.length;
  const width = rows[0].length;
  const ground: Ground[] = [];
  for (const row of rows) {
    if (row.length !== width) throw new Error("ragged map");
    for (const ch of row) ground.push(LEGEND[ch] ?? Ground.Grass);
  }
  return {
    zone: "home",
    name: "test",
    width,
    height,
    ground,
    props: [],
    exits: [],
    spawns: { default: { x: 1.5, y: 1.5 } },
    npcs: [],
    monsters: [],
    ambient: "day",
    ...extra,
  };
}

/** Open field of grass with a wall border. */
export function openMap(w: number, h: number, extra: Partial<MapData> = {}): MapData {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(y === 0 || y === h - 1 ? "#".repeat(w) : "#" + ".".repeat(w - 2) + "#");
  }
  return makeMap(rows, extra);
}

/** Deterministic RNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
