import { describe, expect, it } from "vitest";
import {
  buildMessage,
  evaluate,
  furnitureInSlot,
  nextRotation,
  snapTopLeft,
} from "../src/client/render/buildmode-logic";
import type { Inventory } from "../src/shared/types";
import { openMap } from "./engine-fixtures";

const map = openMap(10, 10, { floorArea: [{ x: 0, y: 0, w: 10, h: 10 }], exits: [], spawns: {} });
const world = (extra: Partial<Parameters<typeof evaluate>[3]> = {}) => ({
  map,
  objects: [],
  farm: [],
  occupied: [],
  ...extra,
});

describe("build mode logic", () => {
  it("cycles rotation 0..3", () => {
    expect([0, 1, 2, 3].map((r) => nextRotation(r as 0 | 1 | 2 | 3))).toEqual([1, 2, 3, 0]);
  });

  it("centres the footprint under the pointer", () => {
    expect(snapTopLeft("chair_wood", 0, { x: 4.7, y: 3.2 })).toEqual({ x: 4, y: 3 });
    expect(snapTopLeft("table_wood", 0, { x: 4.7, y: 3.2 })).toEqual({ x: 4, y: 3 });
    expect(snapTopLeft("table_wood", 0, { x: 4.2, y: 3.2 })).toEqual({ x: 3, y: 3 });
    expect(snapTopLeft("table_wood", 1, { x: 4.2, y: 3.2 })).toEqual({ x: 4, y: 2 });
  });

  it("validates the slot holds furniture", () => {
    const inv: Inventory = { coins: 0, slots: [{ item: "hoe", qty: 1 }, { item: "chair_wood", qty: 2 }] };
    expect(furnitureInSlot(inv, 0)).toHaveProperty("reason");
    expect(furnitureInSlot(inv, 1)).toEqual({ item: "chair_wood" });
    expect(furnitureInSlot(inv, 5)).toHaveProperty("reason");
  });

  it("ignores the moved object itself but not others", () => {
    const objects = [{ id: "o1", item: "table_wood", x: 2, y: 2, rotation: 0 as const }];
    const move = { kind: "move" as const, id: "o1", item: "table_wood" };
    expect(evaluate(move, 0, { x: 2.5, y: 2.5 }, world({ objects })).ok).toBe(true);
    const place = { kind: "place" as const, slot: 0, item: "chair_wood" };
    const p = evaluate(place, 0, { x: 2.5, y: 2.5 }, world({ objects }));
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/furniture/);
  });

  it("rejects tiles where someone stands", () => {
    const place = { kind: "place" as const, slot: 0, item: "chair_wood" };
    expect(evaluate(place, 0, { x: 5, y: 5 }, world({ occupied: [{ x: 5.5, y: 5.6 }] })).ok).toBe(false);
  });

  it("builds place and moveObject messages with a req tag", () => {
    const p = { x: 1, y: 2, w: 1, h: 1, ok: true };
    expect(buildMessage({ kind: "place", slot: 3, item: "chair_wood" }, p, 1, "r1")).toEqual({
      t: "place", slot: 3, x: 1, y: 2, rotation: 1, req: "r1",
    });
    expect(buildMessage({ kind: "move", id: "o9", item: "chair_wood" }, p, 2, "r2")).toEqual({
      t: "moveObject", id: "o9", x: 1, y: 2, rotation: 2, req: "r2",
    });
  });
});
