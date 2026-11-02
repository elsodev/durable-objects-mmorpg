import { describe, expect, it } from "vitest";
import { getMap } from "../src/shared/maps";
import type { MapProp } from "../src/shared/types";
import {
  INTERACTABLE_TYPES,
  hitRect,
  phaseOf,
  pickProp,
  propFeet,
  type HitEntry,
  lidBump,
} from "../src/client/render/props-geom";

const stall: MapProp = { id: "stall_seeds", type: "market_stall", x: 42, y: 18, w: 3, h: 2 };
const bin: MapProp = { id: "shipping_bin", type: "shipping_bin", x: 35, y: 9, w: 2, h: 1 };

function entry(p: MapProp, up = 0, halfW = 0): HitEntry {
  return { id: p.id, footprint: { x: p.x, y: p.y, w: p.w, h: p.h }, hit: hitRect(p, { up, halfW }) };
}

describe("fe-props geometry", () => {
  it("puts feet at the bottom-center of the footprint", () => {
    expect(propFeet(stall)).toEqual({ x: 43.5, y: 20 });
  });

  it("hits inside the footprint and within the tolerance", () => {
    const es = [entry(stall, 2.5, 1.4)];
    expect(pickProp(es, { x: 43.2, y: 18.5 })).toBe("stall_seeds");
    expect(pickProp(es, { x: 41.9, y: 19.5 })).toBe("stall_seeds"); // left pad
    expect(pickProp(es, { x: 43, y: 20.1 })).toBe("stall_seeds"); // bottom pad
    expect(pickProp(es, { x: 43, y: 17.6 })).toBe("stall_seeds"); // awning above footprint
    expect(pickProp(es, { x: 43, y: 16.9 })).toBeNull();
    expect(pickProp(es, { x: 40, y: 19 })).toBeNull();
  });

  it("caps the upward reach of tall art", () => {
    const r = hitRect(stall, { up: 10, halfW: 1.5 });
    expect(r.y).toBeCloseTo(18 - 2 - 0.15);
  });

  it("prefers an exact footprint hit over another prop's tolerance", () => {
    const a: MapProp = { id: "a", type: "well", x: 10, y: 10, w: 2, h: 2 };
    const b: MapProp = { id: "b", type: "shipping_bin", x: 10, y: 12, w: 2, h: 1 };
    const es = [entry(a), entry(b, 3, 1)]; // b's art tolerance overlaps a's footprint
    expect(pickProp(es, { x: 10.5, y: 11.5 })).toBe("a");
    expect(pickProp(es, { x: 10.5, y: 12.5 })).toBe("b");
  });

  it("phase is deterministic and in range", () => {
    expect(phaseOf(3, 4)).toBe(phaseOf(3, 4));
    expect(phaseOf(3, 4)).toBeGreaterThanOrEqual(0);
    expect(phaseOf(3, 4)).toBeLessThan(Math.PI * 2);
  });

  it("marks the special map props interactable", () => {
    const village = getMap("village").props;
    const ids = village.filter((p) => INTERACTABLE_TYPES.has(p.type)).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["stall_bakery", "stall_produce", "stall_goods", "notice_board", "fountain", "well"]));
    expect(village.some((p) => p.type === "tree" && INTERACTABLE_TYPES.has(p.type))).toBe(false);
    expect(getMap("home").props.some((p) => p.id === "shipping_bin" && INTERACTABLE_TYPES.has(p.type))).toBe(true);
  });
});

describe("lidBump", () => {
  it("rests at both ends and squashes in between", () => {
    expect(lidBump(0)).toEqual({ x: 1, y: 1 });
    expect(lidBump(1)).toEqual({ x: 1, y: 1 });
    const s = lidBump(0.2);
    expect(s.y).toBeLessThan(1);
    expect(s.x).toBeGreaterThan(1);
  });
});
