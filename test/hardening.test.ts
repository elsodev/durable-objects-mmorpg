// Regression tests for the security review fixes (input validation, prototype keys, NaN).
import { describe, expect, it } from "vitest";
import { decodeClient } from "../src/shared/protocol";
import { safeSpawnName, ownGet } from "../src/shared/validate";
import { getItem, starterInventory } from "../src/shared/items";
import {
  addItem,
  buildCollision,
  findPath,
  harvestable,
  isBlocked,
  isFarmable,
  removeFromSlot,
  tillTile,
} from "../src/shared/engine";
import { DAY_MS } from "../src/shared/types";
import { openMap } from "./engine-fixtures";

describe("decodeClient", () => {
  it("accepts well-formed messages and strips unknown fields", () => {
    expect(decodeClient(JSON.stringify({ t: "move", dx: 1, dy: 0, evil: true }))).toEqual({ t: "move", dx: 1, dy: 0 });
    expect(decodeClient(JSON.stringify({ t: "place", slot: 2, x: 3, y: 4, rotation: 1, req: "r1" }))).toEqual({
      t: "place", slot: 2, x: 3, y: 4, rotation: 1, req: "r1",
    });
  });
  it("rejects wrong types and out-of-range values", () => {
    const bad = [
      { t: "chat", text: {} },
      { t: "place", slot: 0, x: 1, y: 1, rotation: "7" },
      { t: "use", slot: "0", x: 1, y: 1 },
      { t: "moveTo", x: 1e308, y: 1 },
      { t: "move", dx: 2, dy: 0 },
      { t: "sell", npc: "odette", slot: 0, qty: -3 },
      { t: "buy", npc: "odette", item: "x".repeat(65), qty: 1 },
      { t: "nope" },
      [],
    ];
    for (const m of bad) expect(decodeClient(JSON.stringify(m))).toBeNull();
    expect(decodeClient("{")).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "chat", text: "a".repeat(5000) }))).toBeNull(); // oversized frame
  });
  it("cleans chat text", () => {
    expect(decodeClient(JSON.stringify({ t: "chat", text: "  hi\u0000\nthere  " }))).toEqual({ t: "chat", text: "hi  there" });
    expect(decodeClient(JSON.stringify({ t: "chat", text: "   " }))).toBeNull();
  });
});

describe("prototype keys", () => {
  it("getItem ignores inherited keys", () => {
    expect(getItem("constructor")).toBeUndefined();
    expect(getItem("__proto__")).toBeUndefined();
    const inv = starterInventory();
    expect(addItem(inv, "constructor", 1)).toBe(false);
  });
  it("removeFromSlot rejects non-integer slots", () => {
    const inv = starterInventory();
    expect(removeFromSlot(inv, "constructor" as unknown as number, 1)).toBe(false);
    expect(removeFromSlot(inv, "length" as unknown as number, 1)).toBe(false);
    expect(removeFromSlot(inv, -1, 1)).toBe(false);
    expect((Array.prototype as unknown as { qty?: number }).qty).toBeUndefined();
  });
  it("spawn names and record lookups", () => {
    const spawns = { default: { x: 1, y: 1 }, from_home: { x: 2, y: 2 } };
    expect(safeSpawnName(spawns, "from_home")).toBe("from_home");
    expect(safeSpawnName(spawns, "constructor")).toBe("default");
    expect(safeSpawnName(spawns, "../x")).toBe("default");
    expect(ownGet(spawns, "toString")).toBeUndefined();
  });
});

describe("NaN coordinates", () => {
  const map = openMap(10, 10);
  const grid = buildCollision(map);
  it("isBlocked treats non-integers as blocked", () => {
    expect(isBlocked(grid, NaN, 1)).toBe(true);
    expect(isBlocked(grid, 1.5, 1)).toBe(true);
  });
  it("findPath bails on non-finite targets", () => {
    expect(findPath(grid, { x: 2, y: 2 }, { x: NaN, y: 3 })).toBeNull();
  });
});

describe("farming guards", () => {
  it("harvestable doesn't mutate", () => {
    const t = { ...tillTile(1, 1), crop: "turnip", plantedAt: 0, wateredDays: 99, lastWateredDay: 0 };
    const now = DAY_MS * 200;
    expect(harvestable(t, now)).toBe("turnip");
    expect(t.crop).toBe("turnip");
  });
  it("isFarmable refuses tiles under placed furniture", () => {
    const map = openMap(10, 10, { farmArea: [{ x: 1, y: 1, w: 5, h: 5 }] });
    expect(isFarmable(map, 2, 2)).toBe(true);
    expect(isFarmable(map, 2, 2, [{ id: "f", item: "fence", x: 2, y: 2, rotation: 0 }])).toBe(false);
  });
});
