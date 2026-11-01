import { describe, expect, it } from "vitest";
import { blobPiece, blobPieces, planTile, wallShade, type Quadrant } from "../src/client/render/ground-autotile";
import { getMap } from "../src/shared/maps";
import { Ground, type MapData } from "../src/shared/types";

const G: Record<string, Ground> = {
  ".": Ground.Grass, ":": Ground.Dirt, ",": Ground.Sand, "~": Ground.Water,
  _: Ground.Stone, "=": Ground.Wood, '"': Ground.Tilled, "#": Ground.CaveWall, W: Ground.Wall, " ": Ground.Void,
};

function mapOf(rows: string[], ambient: MapData["ambient"] = "day"): MapData {
  return {
    zone: "village", name: "t", width: rows[0]!.length, height: rows.length,
    ground: rows.flatMap((r) => [...r].map((c) => G[c]!)),
    props: [], exits: [], spawns: {}, npcs: [], monsters: [], ambient,
  };
}

const NW: Quadrant = 0, NE: Quadrant = 1, SW: Quadrant = 2, SE: Quadrant = 3;
const only = (...cells: [number, number][]) => (dx: number, dy: number) => cells.some(([x, y]) => x === dx && y === dy);

describe("blobPiece", () => {
  it("uses outer corners when both orthogonal neighbours are outside", () => {
    expect(blobPiece(only([0, -1], [-1, 0]), NW)).toEqual({ block: "outer", col: 0, row: 0 });
    expect(blobPiece(only([0, 1], [1, 0]), SE)).toEqual({ block: "outer", col: 2, row: 2 });
  });
  it("uses outer edges for a single orthogonal neighbour", () => {
    expect(blobPiece(only([0, -1]), NE)).toEqual({ block: "outer", col: 1, row: 0 });
    expect(blobPiece(only([-1, 0]), SW)).toEqual({ block: "outer", col: 0, row: 1 });
    expect(blobPiece(only([0, -1]), SW)).toBeNull();
  });
  it("uses the inner block for diagonal-only notches", () => {
    expect(blobPiece(only([-1, -1]), NW)).toEqual({ block: "inner", col: 1, row: 1 });
    expect(blobPiece(only([1, 1]), SE)).toEqual({ block: "inner", col: 0, row: 0 });
    expect(blobPiece(only([1, -1]), NE)).toEqual({ block: "inner", col: 0, row: 1 });
  });
  it("returns null for interior tiles", () => {
    expect(blobPieces(() => false)).toBeNull();
  });
  it("composes 1-wide strips from both sides", () => {
    const p = blobPieces(only([0, -1], [0, 1]))!;
    expect(p[NW]).toEqual({ block: "outer", col: 1, row: 0 });
    expect(p[SE]).toEqual({ block: "outer", col: 1, row: 2 });
  });
});

describe("planTile", () => {
  it("blends grass over a neighbouring dirt path", () => {
    const m = mapOf(["...", "...", ":::"]);
    const p = planTile(m, 1, 1);
    expect(p.base).toBe(Ground.Dirt);
    expect(p.blobKind).toBe(Ground.Grass);
    expect(p.blob?.set).toBe("grass");
    expect(p.blob?.pieces[SW]).toEqual({ block: "outer", col: 1, row: 2 });
    expect(p.blob?.pieces[NW]).toBeNull();
    expect(planTile(m, 1, 0)).toEqual({ base: Ground.Grass, blob: null, blobKind: null });
  });
  it("draws banks on water tiles, choosing grass or dirt bank", () => {
    expect(planTile(mapOf(["...", ".~.", "..."]), 1, 1).blob?.set).toBe("water.grass");
    expect(planTile(mapOf([",,,", ",~,", ",,,"]), 1, 1).blob?.set).toBe("water.dirt");
    // Docks don't get a bank.
    expect(planTile(mapOf(["~~~", "~~=", "~~~"]), 1, 1).blob).toBeNull();
  });
  it("treats map borders as the same terrain", () => {
    expect(planTile(mapOf(["~"]), 0, 0).blob).toBeNull();
  });
  it("skips void", () => {
    expect(planTile(mapOf([" "]), 0, 0).base).toBeNull();
  });
  it("plans every tile of the real maps without throwing", () => {
    for (const zone of ["home", "village", "riverside", "caves"] as const) {
      const m = getMap(zone);
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
        planTile(m, x, y);
        wallShade(m, x, y);
      }
    }
  });
});

describe("wallShade", () => {
  const m = mapOf(["###", "###", "___"], "cave");
  it("marks wall tops and faces", () => {
    expect(wallShade(m, 1, 0)).toMatchObject({ kind: "wall", top: true });
    expect(wallShade(m, 1, 1)).toMatchObject({ kind: "wall", top: false, open: { s: true } });
  });
  it("shades floor under walls", () => {
    expect(wallShade(m, 1, 2)).toEqual({ kind: "floor", walls: { n: true, e: false, s: false, w: false } });
    expect(wallShade(mapOf(["..."]), 1, 0)).toBeNull();
  });
});
