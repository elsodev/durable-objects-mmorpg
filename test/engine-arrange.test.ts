// Moving several placed pieces at once (house edit mode): all or nothing, the moving set never
// blocks itself, moved pieces can't overlap each other, a cap per message, and turns.
import { describe, expect, it } from "vitest";
import { checkArrange, MAX_ARRANGE, MAX_FENCE_PIECES, turnInPlace, type ArrangeMove } from "../src/shared/engine";
import { decodeClient } from "../src/shared/protocol";
import type { PlacedObject } from "../src/shared/types";
import { openMap } from "./engine-fixtures";

const map = openMap(12, 10, { floorArea: [{ x: 1, y: 1, w: 10, h: 8 }], exits: [], spawns: {} });
const chair = (id: string, x: number, y: number, rotation: 0 | 1 | 2 | 3 = 0): PlacedObject => ({ id, item: "chair_wood", x, y, rotation });
const mv = (id: string, x: number, y: number, rotation: 0 | 1 | 2 | 3 = 0): ArrangeMove => ({ id, x, y, rotation });

describe("checkArrange", () => {
  const room: PlacedObject[] = [chair("a", 2, 2), chair("b", 3, 2), chair("c", 6, 6), { id: "t", item: "table_wood", x: 5, y: 2, rotation: 0 }];

  it("moves a group by one step even where they overlap their own old spots", () => {
    // a and b shift right by one: b's new tile is c-free, a lands where b was.
    expect(checkArrange(map, room, [], [mv("a", 3, 2), mv("b", 4, 2)])).toEqual({ ok: true });
  });

  it("swaps two pieces in one message", () => {
    expect(checkArrange(map, room, [], [mv("a", 3, 2), mv("b", 2, 2)])).toEqual({ ok: true });
  });

  it("refuses the whole move when one piece is blocked, and names it", () => {
    const r = checkArrange(map, room, [], [mv("a", 2, 3), mv("b", 5, 2)]);
    expect(r).toMatchObject({ ok: false, reason: "Overlaps other furniture.", id: "b" });
  });

  it("refuses two moved pieces landing on the same tile", () => {
    expect(checkArrange(map, room, [], [mv("a", 4, 4), mv("b", 4, 4)])).toMatchObject({ ok: false, id: "b" });
  });

  it("still checks the pieces that stay put", () => {
    expect(checkArrange(map, room, [], [mv("a", 6, 6)])).toMatchObject({ ok: false, reason: "Overlaps other furniture." });
  });

  it("refuses unknown ids, duplicates, empty lists and more than the cap", () => {
    expect(checkArrange(map, room, [], [mv("nope", 4, 4)])).toMatchObject({ ok: false, reason: "That isn't here any more." });
    expect(checkArrange(map, room, [], [mv("a", 4, 4), mv("a", 5, 5)])).toMatchObject({ ok: false, reason: "Each piece moves once." });
    expect(checkArrange(map, room, [], [])).toMatchObject({ ok: false });
    const many = Array.from({ length: MAX_ARRANGE + 1 }, (_, i) => chair(`m${i}`, 1 + (i % 10), 7 + Math.floor(i / 10)));
    const moves = many.map((o) => mv(o.id, o.x, o.y - 1));
    expect(checkArrange(map, many, [], moves)).toMatchObject({ ok: false, reason: `Move at most ${MAX_ARRANGE} pieces at once.` });
    expect(checkArrange(map, many, [], moves.slice(0, MAX_ARRANGE)).ok).toBe(true);
  });

  it("refuses pieces the room says must stay", () => {
    const fixed = (o: PlacedObject) => (o.id === "a" ? "The barn stays where it was built." : null);
    expect(checkArrange(map, room, [], [mv("b", 4, 4), mv("a", 4, 5)], { fixed })).toMatchObject({ ok: false, id: "a" });
  });

  it("checks bounds and people standing there", () => {
    expect(checkArrange(map, room, [], [mv("a", 11, 2)])).toMatchObject({ ok: false });
    expect(checkArrange(map, room, [], [mv("a", 4, 4)], { occupied: [{ x: 4.5, y: 4.6 }] })).toMatchObject({ ok: false, reason: "Someone is standing there." });
  });

  it("only allows turns the piece has art for", () => {
    // The wooden table turns between 0 and 1 only; the lamp never turns.
    expect(checkArrange(map, room, [], [mv("t", 5, 2, 1)]).ok).toBe(true);
    expect(checkArrange(map, room, [], [mv("t", 5, 2, 2)])).toMatchObject({ ok: false, reason: "It doesn't turn that way." });
    const lamp: PlacedObject = { id: "l", item: "lamp", x: 8, y: 4, rotation: 0 };
    expect(checkArrange(map, [...room, lamp], [], [mv("l", 8, 4, 1)])).toMatchObject({ ok: false, reason: "It doesn't turn that way." });
  });
});

describe("turnInPlace", () => {
  it("keeps a turned piece centred, and turning back undoes it exactly", () => {
    expect(turnInPlace("chair_wood", 4, 4, 0, 1)).toEqual({ x: 4, y: 4 });
    const up = turnInPlace("table_long", 4, 4, 0, 1); // 3x1 -> 1x3
    expect(up).toEqual({ x: 5, y: 3 });
    expect(turnInPlace("table_long", up.x, up.y, 1, 0)).toEqual({ x: 4, y: 4 });
    const t = turnInPlace("table_wood", 4, 4, 0, 1); // 2x1 -> 1x2
    expect(turnInPlace("table_wood", t.x, t.y, 1, 0)).toEqual({ x: 4, y: 4 });
  });
});

describe("moveObjects / pickupObjects frames", () => {
  const frame = (m: unknown) => decodeClient(JSON.stringify(m));

  it("keep only known fields of valid moves", () => {
    expect(frame({ t: "moveObjects", moves: [{ id: "o1", x: 2, y: 3, rotation: 1, extra: 1 }], req: "r1", junk: true })).toEqual({
      t: "moveObjects",
      moves: [{ id: "o1", x: 2, y: 3, rotation: 1 }],
      req: "r1",
    });
    expect(frame({ t: "pickupObjects", ids: ["o1", "o2"] })).toEqual({ t: "pickupObjects", ids: ["o1", "o2"] });
  });

  it("drop empty, oversized, duplicate or malformed lists", () => {
    const moves = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, x: 1, y: 1, rotation: 0 }));
    expect(frame({ t: "moveObjects", moves: [] })).toBeNull();
    expect(frame({ t: "moveObjects", moves: moves(MAX_ARRANGE) })).not.toBeNull();
    expect(frame({ t: "moveObjects", moves: moves(MAX_ARRANGE + 1) })).toBeNull();
    // A plot's whole fence slides with shiftObjects (ids only), which still fits in one frame.
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `o${i + 100}`);
    expect(frame({ t: "shiftObjects", ids: ids(MAX_FENCE_PIECES), dx: 1, dy: 0 })).not.toBeNull();
    expect(frame({ t: "shiftObjects", ids: ids(MAX_FENCE_PIECES + 1), dx: 1, dy: 0 })).toBeNull();
    expect(frame({ t: "shiftObjects", ids: ids(3), dx: 0, dy: 0 })).toBeNull();
    expect(frame({ t: "pickupObjects", ids: ids(MAX_FENCE_PIECES) })).not.toBeNull();
    expect(frame({ t: "moveObjects", moves: [...moves(1), ...moves(1)] })).toBeNull();
    expect(frame({ t: "moveObjects", moves: [{ id: "o1", x: 1.5, y: 1, rotation: 0 }] })).toBeNull();
    expect(frame({ t: "moveObjects", moves: [{ id: "o1", x: 1, y: 1, rotation: 4 }] })).toBeNull();
    expect(frame({ t: "moveObjects", moves: "o1" })).toBeNull();
    expect(frame({ t: "pickupObjects", ids: [] })).toBeNull();
    expect(frame({ t: "pickupObjects", ids: ["a", "a"] })).toBeNull();
    expect(frame({ t: "pickupObjects", ids: [3] })).toBeNull();
    expect(frame({ t: "pickupObjects", ids: Array.from({ length: MAX_FENCE_PIECES + 1 }, (_, i) => `o${i}`) })).toBeNull();
  });
});
