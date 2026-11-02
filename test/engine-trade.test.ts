import { describe, expect, it } from "vitest";
import {
  bothConfirmed,
  countStack,
  fitOffer,
  isTradable,
  newTrade,
  offerAdd,
  offerCoins,
  offerRemove,
  settleTrade,
  takeStack,
  withConfirm,
  withOffer,
  withReady,
} from "../src/shared/engine/trade";
import { MAX_SLOTS } from "../src/shared/items";
import { emptyOffer, parseTradeCommand, TRADE_SLOTS, type TradeOffer } from "../src/shared/trade";
import type { Inventory, InventorySlot } from "../src/shared/types";

const bag = (coins: number, ...slots: (InventorySlot | null)[]): Inventory => ({
  coins,
  slots: [...slots, ...Array.from({ length: MAX_SLOTS - slots.length }, () => null)],
});
const ok = (r: TradeOffer | string): TradeOffer => {
  if (typeof r === "string") throw new Error(r);
  return r;
};
const total = (inv: Inventory, item: string): number => countStack(inv, { item });

describe("offers", () => {
  it("adds from a slot, merging the same stack and capping at what the bag holds", () => {
    const inv = bag(10, { item: "turnip", qty: 5 }, { item: "turnip", qty: 3 }, { item: "ore_copper", qty: 2 });
    let o = ok(offerAdd(emptyOffer(), inv, 0, 4));
    o = ok(offerAdd(o, inv, 1, 99));
    expect(o.items).toEqual([{ item: "turnip", qty: 8 }]);
    expect(offerAdd(o, inv, 0, 1)).toMatch(/already/);
    o = ok(offerAdd(o, inv, 2, 1));
    expect(o.items).toEqual([{ item: "turnip", qty: 8 }, { item: "ore_copper", qty: 1 }]);
  });

  it("refuses empty slots, unknown items, the wardrobe and bad amounts", () => {
    const inv = bag(0, null, { item: "nope_item", qty: 1 }, { item: "wardrobe", qty: 1 }, { item: "turnip", qty: 1 });
    expect(offerAdd(emptyOffer(), inv, 0, 1)).toMatch(/empty/);
    expect(offerAdd(emptyOffer(), inv, 1, 1)).toMatch(/can't be traded/);
    expect(offerAdd(emptyOffer(), inv, 2, 1)).toMatch(/can't be traded/);
    expect(offerAdd(emptyOffer(), inv, 3, 0)).toMatch(/how many/);
    expect(offerAdd(emptyOffer(), inv, 99, 1)).toMatch(/empty/);
    expect(isTradable("hoe")).toBe(true);
  });

  it("keeps qualities apart", () => {
    const inv = bag(0, { item: "turnip", qty: 2 }, { item: "turnip", qty: 2, quality: 2 });
    let o = ok(offerAdd(emptyOffer(), inv, 0, 2));
    o = ok(offerAdd(o, inv, 1, 2));
    expect(o.items).toEqual([{ item: "turnip", qty: 2 }, { item: "turnip", qty: 2, quality: 2 }]);
  });

  it("holds at most TRADE_SLOTS different stacks", () => {
    const ids = ["turnip", "ore_copper", "ore_iron", "stone", "wood", "hoe", "axe", "pickaxe", "sword_wood", "seed_turnip"];
    const inv = bag(0, ...ids.map((item) => ({ item, qty: 1 })));
    let o = emptyOffer();
    for (let i = 0; i < TRADE_SLOTS; i++) o = ok(offerAdd(o, inv, i, 1));
    expect(o.items).toHaveLength(TRADE_SLOTS);
    expect(offerAdd(o, inv, TRADE_SLOTS, 1)).toMatch(/full/);
  });

  it("takes entries back, in part or whole", () => {
    const inv = bag(0, { item: "turnip", qty: 5 }, { item: "stone", qty: 1 });
    let o = ok(offerAdd(ok(offerAdd(emptyOffer(), inv, 0, 5)), inv, 1, 1));
    o = ok(offerRemove(o, 0, 2));
    expect(o.items[0]).toEqual({ item: "turnip", qty: 3 });
    o = ok(offerRemove(o, 0));
    expect(o.items).toEqual([{ item: "stone", qty: 1 }]);
    expect(offerRemove(o, 4)).toMatch(/isn't in/);
  });

  it("offers only coins you carry", () => {
    const inv = bag(30);
    expect(ok(offerCoins(emptyOffer(), inv, 30)).coins).toBe(30);
    expect(offerCoins(emptyOffer(), inv, 31)).toMatch(/many coins/);
    expect(offerCoins(emptyOffer(), inv, -1)).toMatch(/amount/);
  });

  it("fitOffer shrinks an offer the bag no longer covers, and keeps it otherwise", () => {
    const inv = bag(50, { item: "turnip", qty: 5 });
    const o = { items: [{ item: "turnip", qty: 5 }], coins: 40 };
    expect(fitOffer(o, inv)).toBe(o);
    inv.slots[0]!.qty = 2;
    inv.coins = 10;
    expect(fitOffer(o, inv)).toEqual({ items: [{ item: "turnip", qty: 2 }], coins: 10 });
    inv.slots[0] = null;
    expect(fitOffer(o, inv)).toEqual({ items: [], coins: 10 });
  });
});

describe("ready and trade presses", () => {
  const some = { items: [{ item: "turnip", qty: 1 }], coins: 0 };

  it("any change to either offer clears both Ready and both Trade presses", () => {
    let s = withOffer(newTrade(), 0, some);
    s = withReady(withReady(s, 0, true), 1, true);
    s = withConfirm(s, 0) as typeof s;
    expect(s.confirmed).toEqual([true, false]);
    const after = withOffer(s, 1, { items: [], coins: 1 });
    expect(after.ready).toEqual([false, false]);
    expect(after.confirmed).toEqual([false, false]);
    // The same offer again is no change.
    expect(withOffer(s, 0, { items: [{ item: "turnip", qty: 1 }], coins: 0 })).toBe(s);
  });

  it("Trade needs both ready and something on the table; un-ready clears presses", () => {
    let s = withReady(newTrade(), 0, true);
    expect(withConfirm(s, 0)).toMatch(/Both/);
    s = withReady(s, 1, true);
    expect(withConfirm(s, 0)).toMatch(/nothing/);
    s = withReady(withReady(withOffer(s, 1, some), 0, true), 1, true);
    s = withConfirm(s, 1) as typeof s;
    expect(bothConfirmed(s)).toBe(false);
    expect(withReady(s, 0, false).confirmed).toEqual([false, false]);
    s = withConfirm(s, 0) as typeof s;
    expect(bothConfirmed(s)).toBe(true);
  });
});

describe("settleTrade", () => {
  it("swaps items and coins exactly once, stacking onto existing stacks", () => {
    const a = bag(100, { item: "hoe", qty: 1 }, { item: "turnip", qty: 10 }, { item: "ore_copper", qty: 95 });
    const b = bag(5, { item: "ore_copper", qty: 3 }, { item: "stone", qty: 4 });
    const offerA = { items: [{ item: "turnip", qty: 7 }], coins: 40 };
    const offerB = { items: [{ item: "ore_copper", qty: 3 }, { item: "stone", qty: 4 }], coins: 5 };
    const before = JSON.stringify({ a, b });
    const r = settleTrade(a, offerA, b, offerB);
    if ("fail" in r) throw new Error(r.fail);
    // Inputs untouched: the caller writes the result.
    expect(JSON.stringify({ a, b })).toBe(before);
    expect(r.a.coins).toBe(65);
    expect(r.b.coins).toBe(40);
    expect(total(r.a, "turnip")).toBe(3);
    expect(total(r.b, "turnip")).toBe(7);
    expect(total(r.a, "ore_copper")).toBe(98);
    expect(r.a.slots[2]).toEqual({ item: "ore_copper", qty: 98 });
    expect(total(r.a, "stone")).toBe(4);
    expect(total(r.b, "ore_copper") + total(r.b, "stone")).toBe(0);
    expect(r.a.slots[0]).toEqual({ item: "hoe", qty: 1 });
    // Nothing made or lost.
    for (const item of ["turnip", "ore_copper", "stone", "hoe"]) {
      expect(total(r.a, item) + total(r.b, item)).toBe(total(a, item) + total(b, item));
    }
    expect(r.a.coins + r.b.coins).toBe(a.coins + b.coins);
  });

  it("refuses when a bag no longer covers its offer", () => {
    const a = bag(10, { item: "turnip", qty: 2 });
    const b = bag(0);
    expect(settleTrade(a, { items: [{ item: "turnip", qty: 3 }], coins: 0 }, b, emptyOffer())).toEqual({ fail: "a_missing" });
    expect(settleTrade(a, { items: [], coins: 11 }, b, emptyOffer())).toEqual({ fail: "a_missing" });
    expect(settleTrade(a, emptyOffer(), b, { items: [], coins: 1 })).toEqual({ fail: "b_missing" });
  });

  it("refuses when a bag can't hold what it gets, counting the room its own offer frees", () => {
    const full = (item: string) => bag(0, ...Array.from({ length: MAX_SLOTS }, () => ({ item, qty: 99 })));
    const a = full("stone");
    const b = bag(0, { item: "turnip", qty: 1 });
    expect(settleTrade(a, emptyOffer(), b, { items: [{ item: "turnip", qty: 1 }], coins: 0 })).toEqual({ fail: "a_full" });
    // Giving a whole stack away makes room for the turnip.
    const r = settleTrade(a, { items: [{ item: "stone", qty: 99 }], coins: 0 }, b, { items: [{ item: "turnip", qty: 1 }], coins: 0 });
    expect("fail" in r).toBe(false);
    // Both full and swapping different things: b can't take the stone.
    const c = full("turnip");
    expect(settleTrade(a, { items: [{ item: "stone", qty: 1 }], coins: 0 }, c, { items: [{ item: "turnip", qty: 1 }], coins: 0 })).toEqual({ fail: "a_full" });
    expect(settleTrade(a, { items: [{ item: "stone", qty: 1 }], coins: 0 }, c, emptyOffer())).toEqual({ fail: "b_full" });
  });

  it("keeps quality stacks apart when it moves them", () => {
    const a = bag(0, { item: "turnip", qty: 3 }, { item: "turnip", qty: 2, quality: 2 });
    const r = settleTrade(a, { items: [{ item: "turnip", qty: 2, quality: 2 }], coins: 0 }, bag(0), emptyOffer());
    if ("fail" in r) throw new Error(r.fail);
    expect(r.a.slots[0]).toEqual({ item: "turnip", qty: 3 });
    expect(r.a.slots[1]).toBeNull();
    expect(r.b.slots[0]).toEqual({ item: "turnip", qty: 2, quality: 2 });
  });

  it("takeStack takes from the last slots first and is all-or-nothing", () => {
    const inv = bag(0, { item: "turnip", qty: 5 }, null, { item: "turnip", qty: 2 });
    expect(takeStack(inv, { item: "turnip" }, 8)).toBe(false);
    expect(total(inv, "turnip")).toBe(7);
    expect(takeStack(inv, { item: "turnip" }, 3)).toBe(true);
    expect(inv.slots[2]).toBeNull();
    expect(inv.slots[0]).toEqual({ item: "turnip", qty: 4 });
  });
});

describe("/trade", () => {
  it("parses the name, and nothing else", () => {
    expect(parseTradeCommand("/trade Basil")).toEqual({ name: "Basil" });
    expect(parseTradeCommand("/TRADE  bob  ")).toEqual({ name: "bob" });
    expect(parseTradeCommand("/trade")).toEqual({ name: "" });
    expect(parseTradeCommand("/trader x")).toBeNull();
    expect(parseTradeCommand("trade bob")).toBeNull();
  });
});
