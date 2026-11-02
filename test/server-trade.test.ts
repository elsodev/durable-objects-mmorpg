import { describe, expect, it } from "vitest";
import { TradeDesk, TRADE_ASK_EVERY_MS, type TradeParty } from "../src/worker/game/trades";
import { MAX_SLOTS } from "../src/shared/items";
import { TRADE_ASK_MS, TRADE_LEAVE_RANGE, type TradeOffer } from "../src/shared/trade";
import { decodeClient } from "../src/shared/protocol";
import type { ServerMsg } from "../src/shared/protocol";
import type { Inventory, InventorySlot } from "../src/shared/types";

interface P extends TradeParty {
  got: ServerMsg[];
}

const bag = (coins: number, ...slots: (InventorySlot | null)[]): Inventory => ({
  coins,
  slots: [...slots, ...Array.from({ length: MAX_SLOTS - slots.length }, () => null)],
});

function player(name: string, x: number, inv: Inventory): P {
  return { userId: `u_${name}`, name, entity: { id: `p:${name}`, x, y: 10 }, inv, got: [] };
}

function setup() {
  const settled: { a: P; b: P; gaveA: TradeOffer; gaveB: TradeOffer }[] = [];
  const desk = new TradeDesk<P>({
    send: (p, msg) => p.got.push(structuredClone(msg)),
    settled: (a, b, gaveA, gaveB) => settled.push({ a, b, gaveA, gaveB }),
  });
  const ann = player("Ann", 10, bag(100, { item: "hoe", qty: 1 }, { item: "turnip", qty: 10 }));
  const bob = player("Bob", 12, bag(20, { item: "ore_copper", qty: 6 }));
  return { desk, ann, bob, settled };
}
const last = (p: P, t: string): any => p.got.filter((m) => m.t === t).at(-1);

function open(now = 1000) {
  const s = setup();
  expect(s.desk.request(s.ann, s.bob, now)).toBeNull();
  expect(last(s.bob, "tradeAsk")).toMatchObject({ from: "p:Ann", name: "Ann", expiresAt: now + TRADE_ASK_MS });
  expect(s.desk.answer(s.bob, s.ann, true, now + 10)).toBeNull();
  return s;
}

describe("trade requests", () => {
  it("needs someone else, nearby, and not already trading", () => {
    const { desk, ann, bob } = setup();
    expect(desk.request(ann, undefined, 0)).toMatch(/aren't here/);
    expect(desk.request(ann, ann, 0)).toMatch(/yourself/);
    bob.entity.x = 40;
    expect(desk.request(ann, bob, 0)).toMatch(/closer/);
    expect(bob.got).toEqual([]);
  });

  it("can't be repeated every click", () => {
    const { desk, ann, bob } = setup();
    const cy = player("Cy", 11, bag(0));
    expect(desk.request(ann, bob, 0)).toBeNull();
    expect(desk.request(ann, bob, 100)).toMatch(/already asked/);
    expect(desk.request(ann, cy, 200)).toMatch(/Wait/);
    expect(desk.request(ann, cy, TRADE_ASK_EVERY_MS + 1)).toBeNull();
    // Asking Cy withdrew the request to Bob.
    expect(last(bob, "tradeAskGone")).toEqual({ t: "tradeAskGone", from: "p:Ann" });
    expect(desk.answer(bob, ann, true, TRADE_ASK_EVERY_MS + 2)).toMatch(/isn't open/);
  });

  it("runs out, and a declined request tells the asker", () => {
    const { desk, ann, bob } = setup();
    desk.request(ann, bob, 0);
    desk.tick(TRADE_ASK_MS + 1);
    expect(last(bob, "tradeAskGone")).toBeTruthy();
    expect(desk.answer(bob, ann, true, TRADE_ASK_MS + 2)).toMatch(/isn't open/);
    desk.request(ann, bob, TRADE_ASK_MS + TRADE_ASK_EVERY_MS);
    expect(desk.answer(bob, ann, false, TRADE_ASK_MS + TRADE_ASK_EVERY_MS + 1)).toBeNull();
    expect(last(ann, "notice").text).toMatch(/Bob doesn't want to trade/);
    expect(desk.inTrade(ann)).toBe(false);
  });

  it("only the asked player can accept", () => {
    const { desk, ann, bob } = setup();
    const cy = player("Cy", 11, bag(0));
    desk.request(ann, bob, 0);
    expect(desk.answer(cy, ann, true, 1)).toMatch(/isn't open/);
    expect(desk.inTrade(ann)).toBe(false);
  });

  it("asking back accepts their request", () => {
    const { desk, ann, bob } = setup();
    desk.request(ann, bob, 0);
    expect(desk.request(bob, ann, 10)).toBeNull();
    expect(desk.inTrade(ann) && desk.inTrade(bob)).toBe(true);
  });
});

describe("an open trade", () => {
  it("shows both offers live on both sides", () => {
    const { desk, ann, bob } = open();
    expect(last(ann, "trade").view.with).toEqual({ id: "p:Bob", name: "Bob" });
    expect(desk.add(ann, 1, 4, 2000)).toBeNull();
    expect(desk.coins(bob, 15, 2000)).toBeNull();
    expect(last(ann, "trade").view).toMatchObject({ mine: { items: [{ item: "turnip", qty: 4 }], coins: 0 }, theirs: { items: [], coins: 15 } });
    expect(last(bob, "trade").view).toMatchObject({ theirs: { items: [{ item: "turnip", qty: 4 }] }, mine: { coins: 15 } });
    // The bags are untouched until the swap.
    expect(ann.inv.slots[1]).toEqual({ item: "turnip", qty: 10 });
  });

  it("swaps exactly once when both are ready and both press Trade", () => {
    const { desk, ann, bob, settled } = open();
    desk.add(ann, 1, 4, 2000);
    desk.coins(ann, 30, 2000);
    desk.add(bob, 0, 6, 2000);
    expect(desk.confirm(ann, 2000)).toMatch(/ready/);
    desk.ready(ann, true, 2000);
    desk.ready(bob, true, 2000);
    expect(last(ann, "trade").view.ready).toEqual({ mine: true, theirs: true });
    expect(desk.confirm(ann, 2000)).toBeNull();
    expect(last(bob, "trade").view.confirmed).toEqual({ mine: false, theirs: true });
    expect(ann.inv.coins).toBe(100);
    expect(desk.confirm(bob, 2000)).toBeNull();
    expect(settled).toHaveLength(1);
    expect(ann.inv).toMatchObject({ coins: 70 });
    expect(bob.inv.coins).toBe(50);
    expect(ann.inv.slots[1]).toEqual({ item: "turnip", qty: 6 });
    expect(ann.inv.slots.find((s) => s?.item === "ore_copper")).toEqual({ item: "ore_copper", qty: 6 });
    expect(bob.inv.slots[0]).toEqual({ item: "turnip", qty: 4 });
    expect(last(ann, "tradeEnd")).toEqual({ t: "tradeEnd", done: true, reason: "You traded with Bob." });
    expect(desk.inTrade(ann) || desk.inTrade(bob)).toBe(false);
    // A late press does nothing more.
    expect(desk.confirm(bob, 2001)).toMatch(/aren't trading/);
    expect(settled).toHaveLength(1);
  });

  it("any change clears Ready on both sides", () => {
    const { desk, ann, bob } = open();
    desk.add(ann, 1, 4, 2000);
    desk.ready(ann, true, 2000);
    desk.ready(bob, true, 2000);
    desk.confirm(bob, 2000);
    desk.remove(ann, 0, 1, 2000);
    expect(last(bob, "trade").view).toMatchObject({ ready: { mine: false, theirs: false }, confirmed: { mine: false, theirs: false }, theirs: { items: [{ qty: 3 }] } });
    desk.ready(ann, true, 2000);
    desk.ready(bob, true, 2000);
    desk.coins(bob, 1, 2000);
    expect(last(ann, "trade").view.ready).toEqual({ mine: false, theirs: false });
  });

  it("an offer the bag stops covering shrinks and clears Ready", () => {
    const { desk, ann, bob, settled } = open();
    desk.add(ann, 1, 10, 2000);
    desk.ready(ann, true, 2000);
    desk.ready(bob, true, 2000);
    ann.inv.slots[1] = { item: "turnip", qty: 3 }; // sold 7 at a shop, say
    desk.inventoryChanged(ann);
    expect(last(bob, "trade").view).toMatchObject({ theirs: { items: [{ item: "turnip", qty: 3 }] }, ready: { mine: false, theirs: false } });
    // Even with no inventoryChanged call, the swap re-checks the bags.
    desk.ready(ann, true, 2000);
    desk.ready(bob, true, 2000);
    desk.confirm(ann, 2000);
    ann.inv.slots[1] = null;
    desk.confirm(bob, 2000);
    expect(settled).toHaveLength(0);
    expect(bob.inv.slots[0]).toEqual({ item: "ore_copper", qty: 6 });
  });

  it("a bag too full for the swap moves nothing and says whose", () => {
    const { desk, ann, bob, settled } = open();
    bob.inv = bag(0, ...Array.from({ length: MAX_SLOTS }, () => ({ item: "stone", qty: 99 })));
    desk.add(ann, 1, 1, 2000);
    desk.ready(ann, true, 2000);
    desk.ready(bob, true, 2000);
    desk.confirm(ann, 2000);
    desk.confirm(bob, 2000);
    expect(settled).toHaveLength(0);
    expect(last(ann, "notice").text).toMatch(/Bob's bag is too full/);
    expect(last(bob, "notice").text).toMatch(/Your bag is too full/);
    expect(last(ann, "trade").view.ready).toEqual({ mine: false, theirs: false });
    expect(ann.inv.slots[1]).toEqual({ item: "turnip", qty: 10 });
  });

  it("is called off by walking apart, leaving, a cancel, or asking someone else", () => {
    let s = open();
    s.bob.entity.x = s.ann.entity.x + TRADE_LEAVE_RANGE + 0.5;
    s.desk.tick(3000);
    expect(last(s.ann, "tradeEnd")).toMatchObject({ done: false, reason: "Bob is too far away now, so the trade was called off." });
    expect(s.desk.inTrade(s.bob)).toBe(false);

    s = open();
    s.desk.drop(s.bob);
    expect(last(s.ann, "tradeEnd").reason).toMatch(/Bob left/);
    expect(s.desk.inTrade(s.ann)).toBe(false);

    s = open();
    s.desk.cancel(s.ann, "mine", "theirs");
    expect(last(s.bob, "tradeEnd").reason).toBe("theirs");

    s = open();
    const cy = player("Cy", 11, bag(0));
    expect(s.desk.request(s.ann, cy, 5000)).toBeNull();
    expect(last(s.bob, "tradeEnd").reason).toMatch(/asked someone else/);
    expect(s.desk.request(cy, s.bob, 9000)).toBeNull();
  });

  it("someone already trading is busy to everyone else", () => {
    const { desk, ann, bob } = open();
    const cy = player("Cy", 11, bag(0));
    expect(desk.request(cy, bob, 5000)).toMatch(/busy/);
    expect(desk.request(ann, bob, 5000)).toMatch(/already trading/);
  });

  it("edits from a stale player object (a replaced tab) are refused", () => {
    const { desk, ann } = open();
    const again = { ...ann, got: [] };
    expect(desk.add(again, 1, 1, 2000)).toMatch(/aren't trading/);
  });

  it("rate-limits edits", () => {
    const { desk, ann } = open();
    for (let i = 0; i < 40; i++) desk.coins(ann, i, 2000);
    expect(last(ann, "trade").view.mine.coins).toBeLessThan(39);
  });
});

describe("trade messages", () => {
  it("decode only with valid fields", () => {
    expect(decodeClient(JSON.stringify({ t: "tradeAdd", slot: 3, qty: 5, extra: 1 }))).toEqual({ t: "tradeAdd", slot: 3, qty: 5 });
    expect(decodeClient(JSON.stringify({ t: "tradeAdd", slot: 30, qty: 5 }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "tradeAdd", slot: 1, qty: 0 }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "tradeRemove", index: 9 }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "tradeRemove", index: 8, qty: 2 }))).toEqual({ t: "tradeRemove", index: 8, qty: 2 });
    expect(decodeClient(JSON.stringify({ t: "tradeCoins", coins: -1 }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "tradeCoins", coins: 1.5 }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "tradeReady", ready: "yes" }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "tradeAnswer", from: "p:x", accept: true }))).toEqual({ t: "tradeAnswer", from: "p:x", accept: true });
    expect(decodeClient(JSON.stringify({ t: "tradeRequest", target: "" }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "tradeConfirm" }))).toEqual({ t: "tradeConfirm" });
  });
});
