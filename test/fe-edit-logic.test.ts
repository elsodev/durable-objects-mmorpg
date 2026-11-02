// House edit mode, pure client rules: hit tests, box select, group offsets, snapping, turning,
// the tray, the toolbar's spot and the edit camera.
import { describe, expect, it } from "vitest";
import {
  artRect,
  boxBetween,
  boxSelect,
  checkMoves,
  clampFocus,
  edgeScroll,
  groupMoves,
  isNoop,
  nearestFree,
  pieceAt,
  shapeOf,
  snapDelta,
  toggleSelect,
  toolbarSpot,
  trayEntries,
  turnMoves,
  unionRect,
  type PieceShape,
} from "../src/client/game/edit-logic";
import { dragGhosts, heldGhost, pendingGhosts, toolbarState } from "../src/client/game/edit-scene";
import { MAX_ARRANGE } from "../src/shared/engine";
import type { Inventory, PlacedObject } from "../src/shared/types";
import { openMap } from "./engine-fixtures";

const obj = (id: string, item: string, x: number, y: number, rotation: 0 | 1 | 2 | 3 = 0): PlacedObject => ({ id, item, x, y, rotation });
/** A 1x1 piece whose art is one tile wide and two tall (anchored at its feet). */
const tall = { w: 32, h: 64, ax: 0.5, ay: 1 };
const flat = { w: 32, h: 32, ax: 0.5, ay: 1 };

describe("art boxes and hit tests", () => {
  it("anchors the art at the bottom-centre of the footprint, raised by a wall lift", () => {
    expect(artRect("chair_wood", 4, 4, 0, tall)).toEqual({ x: 4, y: 3, w: 1, h: 2 });
    expect(artRect("table_wood", 4, 4, 0, { w: 64, h: 32, ax: 0.5, ay: 1 })).toEqual({ x: 4, y: 4, w: 2, h: 1 });
    expect(artRect("chair_wood", 4, 4, 0, { ...flat, lift: 16 })).toEqual({ x: 4, y: 3.5, w: 1, h: 1 });
  });

  it("picks the front-most piece, by footprint or by its art", () => {
    const back = shapeOf(obj("back", "chair_wood", 4, 3), tall); // art covers y 2..4
    const front = shapeOf(obj("front", "chair_wood", 4, 4), tall); // art covers y 3..5
    const shapes = [back, front];
    expect(pieceAt(shapes, { x: 4.5, y: 4.5 })).toBe("front");
    // The top of the front chair's art overlaps the back chair's footprint: the front one wins.
    expect(pieceAt(shapes, { x: 4.5, y: 3.5 })).toBe("front");
    expect(pieceAt(shapes, { x: 4.5, y: 2.5 })).toBe("back");
    expect(pieceAt(shapes, { x: 6.5, y: 4.5 })).toBeNull();
  });

  it("answers with a rug only where nothing stands on it", () => {
    const rug = shapeOf(obj("rug", "rug_round", 3, 3), { w: 96, h: 64, ax: 0.5, ay: 1 });
    const chair = shapeOf(obj("c", "chair_wood", 4, 4), flat);
    expect(pieceAt([rug, chair], { x: 4.5, y: 4.5 })).toBe("c");
    expect(pieceAt([chair, rug], { x: 3.5, y: 3.5 })).toBe("rug");
  });
});

describe("box select", () => {
  const shapes: PieceShape[] = [
    shapeOf(obj("a", "chair_wood", 2, 2), flat),
    shapeOf(obj("b", "chair_wood", 5, 2), flat),
    shapeOf(obj("c", "chair_wood", 2, 6), flat),
    shapeOf(obj("rug", "rug_round", 1, 5), { w: 96, h: 64, ax: 0.5, ay: 1 }),
  ];

  it("normalises the box whichever way it was drawn", () => {
    expect(boxBetween({ x: 5, y: 1 }, { x: 2, y: 4 })).toEqual({ x: 2, y: 1, w: 3, h: 3 });
  });

  it("takes every piece the box touches", () => {
    expect(boxSelect(shapes, boxBetween({ x: 1.5, y: 1.5 }, { x: 5.2, y: 2.5 })).sort()).toEqual(["a", "b"]);
    expect(boxSelect(shapes, boxBetween({ x: 3.2, y: 1 }, { x: 4.8, y: 3 }))).toEqual([]);
  });

  it("takes a rug only when the box covers all of it", () => {
    expect(boxSelect(shapes, boxBetween({ x: 1.5, y: 5.5 }, { x: 2.5, y: 6.5 }))).toEqual(["c"]);
    expect(boxSelect(shapes, boxBetween({ x: 0.5, y: 4.5 }, { x: 4.5, y: 7.5 })).sort()).toEqual(["c", "rug"]);
  });

  it("stops at the per-message cap", () => {
    const many = Array.from({ length: MAX_ARRANGE + 3 }, (_, i) => shapeOf(obj(`m${i}`, "chair_wood", i, 0), flat));
    expect(boxSelect(many, { x: 0, y: 0, w: 100, h: 2 })).toHaveLength(MAX_ARRANGE);
  });

  it("click selects one; an added click toggles in and out", () => {
    expect(toggleSelect(["a", "b"], "c", false)).toEqual(["c"]);
    expect(toggleSelect(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleSelect(["a", "b"], "a", true)).toEqual(["b"]);
    const full = Array.from({ length: MAX_ARRANGE }, (_, i) => `m${i}`);
    expect(toggleSelect(full, "x", true)).toEqual(full);
  });
});

describe("dragging a group", () => {
  const pieces = [obj("a", "chair_wood", 2, 2), obj("b", "table_wood", 3, 2, 1)];

  it("snaps the pointer's travel to whole tiles", () => {
    expect(snapDelta({ x: 2.4, y: 2.4 }, { x: 4.3, y: 2.1 })).toEqual({ x: 2, y: 0 });
    expect(snapDelta({ x: 2.4, y: 2.4 }, { x: 2.0, y: 1.8 })).toEqual({ x: 0, y: -1 });
    expect(snapDelta({ x: 2.5, y: 2.5 }, { x: 2.6, y: 2.4 })).toEqual({ x: 0, y: 0 });
  });

  it("moves every piece by the same offset and keeps rotations", () => {
    expect(groupMoves(pieces, { x: 3, y: -1 })).toEqual([
      { id: "a", x: 5, y: 1, rotation: 0 },
      { id: "b", x: 6, y: 1, rotation: 1 },
    ]);
    expect(isNoop(pieces, groupMoves(pieces, { x: 0, y: 0 }))).toBe(true);
    expect(isNoop(pieces, groupMoves(pieces, { x: 1, y: 0 }))).toBe(false);
  });

  it("is valid only if the whole group fits", () => {
    const map = openMap(12, 10, { floorArea: [{ x: 1, y: 1, w: 10, h: 8 }], exits: [], spawns: {} });
    const lamp = obj("l", "lamp", 6, 2);
    const w = { map, objects: [...pieces, lamp], farm: [], occupied: [] };
    expect(checkMoves(w, groupMoves(pieces, { x: 1, y: 0 })).ok).toBe(true);
    expect(checkMoves(w, groupMoves(pieces, { x: 3, y: 0 }))).toMatchObject({ ok: false, id: "b" });
    expect(checkMoves({ ...w, map: null }, groupMoves(pieces, { x: 1, y: 0 })).ok).toBe(false);
  });
});

describe("turning", () => {
  it("turns only pieces with art for the next turn, centred where they stood", () => {
    const pieces = [obj("c", "chair_wood", 4, 4), obj("t", "table_long", 4, 6), obj("l", "lamp", 8, 4)];
    const { moves, turned } = turnMoves(pieces, 1);
    expect(turned).toBe(1);
    expect(moves).toEqual([
      { id: "c", x: 4, y: 4, rotation: 1 },
      { id: "t", x: 4, y: 6, rotation: 0 },
      { id: "l", x: 8, y: 4, rotation: 0 },
    ]);
    expect(turnMoves([obj("t", "table_wood", 4, 4)], 1).moves).toEqual([{ id: "t", x: 4, y: 4, rotation: 1 }]);
    expect(turnMoves([obj("c", "chair_wood", 4, 4)], -1).moves[0]!.rotation).toBe(3);
  });
});

describe("tray, toolbar and camera", () => {
  it("lists indoor furniture in the bag, in bag order", () => {
    const inv: Inventory = {
      coins: 0,
      slots: [{ item: "hoe", qty: 1 }, { item: "chair_wood", qty: 3 }, { item: "fence", qty: 5 }, null, { item: "window", qty: 1 }, { item: "barn", qty: 1 }],
    };
    expect(trayEntries(inv, true)).toEqual([
      { slot: 1, item: "chair_wood", qty: 3 },
      { slot: 4, item: "window", qty: 1 },
    ]);
    expect(trayEntries(inv, false)).toEqual([{ slot: 2, item: "fence", qty: 5 }]);
  });

  it("puts the toolbar above the selection, below when there's no room, and always on screen", () => {
    const view = { w: 390, h: 844 };
    const bar = { w: 180, h: 50 };
    expect(toolbarSpot({ x: 150, y: 300, w: 64, h: 64 }, bar, view)).toEqual({ x: 92, y: 240 });
    expect(toolbarSpot({ x: 150, y: 20, w: 64, h: 64 }, bar, view)).toEqual({ x: 92, y: 94 });
    expect(toolbarSpot({ x: 360, y: 300, w: 64, h: 64 }, bar, view).x).toBe(390 - 8 - 180);
    expect(toolbarSpot({ x: -40, y: 300, w: 64, h: 64 }, bar, view).x).toBe(8);
    expect(toolbarSpot({ x: 150, y: 820, w: 64, h: 64 }, bar, view).y).toBe(820 - 10 - 50);
  });

  it("joins the selection's boxes", () => {
    expect(unionRect([])).toBeNull();
    expect(unionRect([{ x: 1, y: 1, w: 1, h: 2 }, { x: 4, y: 0, w: 2, h: 1 }])).toEqual({ x: 1, y: 0, w: 5, h: 3 });
  });

  it("keeps the edit camera where the real camera can go", () => {
    const map = { width: 14, height: 12 };
    expect(clampFocus({ x: 0, y: 0 }, map, { w: 6, h: 13 })).toEqual({ x: 3, y: 6 });
    expect(clampFocus({ x: 20, y: 5 }, map, { w: 6, h: 10 })).toEqual({ x: 11, y: 5 });
    expect(clampFocus({ x: 20, y: 1 }, map, { w: 6, h: 10 })).toEqual({ x: 11, y: 5 });
    expect(clampFocus({ x: 7.5, y: 5.5 }, map, { w: 6, h: 10 })).toEqual({ x: 7.5, y: 5.5 });
  });

  it("scrolls when a drag nears the edge", () => {
    const view = { w: 390, h: 844 };
    expect(edgeScroll({ x: 10, y: 400 }, view)).toEqual({ x: -1, y: 0 });
    expect(edgeScroll({ x: 380, y: 830 }, view)).toEqual({ x: 1, y: 1 });
    expect(edgeScroll({ x: 200, y: 400 }, view)).toEqual({ x: 0, y: 0 });
  });

  it("finds the nearest free spot ring by ring", () => {
    const taken = new Set(["5,5", "6,5", "4,5", "5,4"]);
    const fits = (x: number, y: number) => !taken.has(`${x},${y}`);
    expect(nearestFree({ x: 5.5, y: 5.5 }, 3, fits)).toEqual({ x: 5, y: 6 });
    expect(nearestFree({ x: 2, y: 2 }, 3, fits)).toEqual({ x: 2, y: 2 });
    expect(nearestFree({ x: 2, y: 2 }, 3, () => false)).toBeNull();
  });
});

describe("edit scene", () => {
  const map = openMap(12, 10, { floorArea: [{ x: 1, y: 1, w: 10, h: 8 }], exits: [], spawns: {} });
  const pieces = [obj("a", "chair_wood", 2, 2), obj("b", "lamp", 3, 2)];
  const w = { map, objects: [...pieces, obj("t", "table_wood", 6, 2)], farm: [], occupied: [] };

  it("paints a dragged group all green or all red", () => {
    expect(dragGhosts(w, pieces, { x: 0, y: 2 }).map((g) => g.ok)).toEqual([true, true]);
    expect(dragGhosts(w, pieces, { x: 3, y: 0 }).map((g) => g.ok)).toEqual([false, false]);
    expect(dragGhosts(w, pieces, { x: 0, y: 2 })[1]).toEqual({ item: "lamp", x: 3, y: 4, rotation: 0, ok: true });
  });

  it("draws an unanswered move where it is going, and the held piece where it would land", () => {
    expect(pendingGhosts(pieces, [{ id: "a", x: 5, y: 5, rotation: 1 }, { id: "gone", x: 1, y: 1, rotation: 0 }])).toEqual([
      { item: "chair_wood", x: 5, y: 5, rotation: 1, ok: true },
    ]);
    expect(heldGhost(w, { slot: 3, item: "chair_wood", rotation: 0, at: { x: 2, y: 2 } })?.ok).toBe(false);
    expect(heldGhost(w, { slot: 3, item: "chair_wood", rotation: 0, at: { x: 4, y: 5 } })?.ok).toBe(true);
    expect(heldGhost(w, { slot: 3, item: "chair_wood", rotation: 0, at: null })).toBeNull();
  });

  it("offers Turn only when some piece can turn", () => {
    expect(toolbarState(null, [])).toBeNull();
    expect(toolbarState(null, [pieces[1]!])).toMatchObject({ count: 1, holding: false, canTurn: false });
    expect(toolbarState(null, pieces)).toMatchObject({ count: 2, canTurn: true });
    expect(toolbarState({ slot: 1, item: "chair_wood", rotation: 0, at: null }, pieces)).toMatchObject({ holding: true, name: "Wooden Chair", canTurn: true });
  });
});
