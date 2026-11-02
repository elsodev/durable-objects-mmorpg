import { describe, expect, it } from "vitest";
import { askText, bagLeft, coinInput, secondsLeft, sideBadge, tradeStatus } from "../src/client/ui/trade-logic";
import { tradeMenuChoices } from "../src/client/ui/slot-menu-logic";
import type { TradeView } from "../src/shared/trade";

const view = (over: Partial<TradeView> = {}): TradeView => ({
  with: { id: "p:bob", name: "Bob" },
  mine: { items: [{ item: "turnip", qty: 2 }], coins: 0 },
  theirs: { items: [], coins: 10 },
  ready: { mine: false, theirs: false },
  confirmed: { mine: false, theirs: false },
  ...over,
});

describe("trade window status", () => {
  it("walks through Ready, then Trade", () => {
    expect(tradeStatus(view({ mine: { items: [], coins: 0 }, theirs: { items: [], coins: 0 } })).line).toMatch(/Right-click/);
    expect(tradeStatus(view())).toMatchObject({ readyLabel: "Ready", tradeEnabled: false });
    expect(tradeStatus(view({ ready: { mine: true, theirs: false } }))).toMatchObject({ line: "Waiting for Bob to press Ready…", readyLabel: "Not ready" });
    expect(tradeStatus(view({ ready: { mine: false, theirs: true } })).line).toMatch(/Bob is ready/);
    const both = tradeStatus(view({ ready: { mine: true, theirs: true } }));
    expect(both).toMatchObject({ tradeEnabled: true, tone: "ok" });
    expect(tradeStatus(view({ ready: { mine: true, theirs: true }, confirmed: { mine: true, theirs: false } }))).toMatchObject({ tradeEnabled: false, line: "Waiting for Bob to press Trade…" });
    expect(tradeStatus(view({ ready: { mine: true, theirs: true }, confirmed: { mine: false, theirs: true } })).line).toMatch(/Bob pressed Trade/);
  });

  it("never enables Trade with nothing on the table", () => {
    const empty = view({ mine: { items: [], coins: 0 }, theirs: { items: [], coins: 0 }, ready: { mine: true, theirs: true } });
    expect(tradeStatus(empty).tradeEnabled).toBe(false);
  });

  it("badges each side", () => {
    expect(sideBadge(false, false)).toEqual({ text: "Not ready", state: "wait" });
    expect(sideBadge(true, false)).toEqual({ text: "Ready", state: "ready" });
    expect(sideBadge(true, true)).toEqual({ text: "Accepted", state: "done" });
  });
});

describe("trade window helpers", () => {
  it("shows the bag minus what's offered, from the last slots first", () => {
    const inv = { coins: 0, slots: [{ item: "turnip", qty: 5 }, null, { item: "turnip", qty: 3 }, { item: "stone", qty: 1 }] };
    const left = bagLeft(inv, { items: [{ item: "turnip", qty: 4 }, { item: "stone", qty: 1 }], coins: 0 });
    expect(left).toEqual([{ item: "turnip", qty: 4 }, null, null, null]);
    expect(inv.slots[2]).toEqual({ item: "turnip", qty: 3 });
  });

  it("reads typed coins as a whole number up to what you carry", () => {
    expect(coinInput("25", 100)).toBe(25);
    expect(coinInput("1,000", 100)).toBe(100);
    expect(coinInput("abc", 100)).toBe(0);
    expect(coinInput("-5", 100)).toBe(5);
  });

  it("words the request and counts it down", () => {
    expect(askText("Bob")).toBe("Bob wants to trade with you.");
    expect(secondsLeft(10_500, 1_000)).toBe(10);
    expect(secondsLeft(0, 1_000)).toBe(0);
  });

  it("offers Add 1 / Add 10 / Add all in the right-click menu while trading", () => {
    expect(tradeMenuChoices(1)).toEqual([{ label: "Add to trade", qty: null, action: "trade" }]);
    expect(tradeMenuChoices(5).map((c) => c.label)).toEqual(["Add 1 to trade", "Add all (5) to trade"]);
    expect(tradeMenuChoices(40).map((c) => c.qty)).toEqual([1, 10, null]);
  });
});
