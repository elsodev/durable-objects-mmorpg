// Eating on the server: the shared eatFrom rules (slot, food, cooldown, cap), the HomeRoom eat
// intent, the zone -> home stamina round trip through savePlayer, and the eat act others see.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EAT_COOLDOWN_MS, eatFrom, eatNotice } from "../src/shared/engine/eating";
import { clampStamina, MAX_STAMINA } from "../src/shared/engine";
import { getItem } from "../src/shared/items";
import { snapshotEntity } from "../src/worker/game/diff";
import { validateClientMsg } from "../src/shared/validate";
import { EAT_MS } from "../src/client/render/eat-logic";
import { connectOwner, createRooms, sendMsg, type Rooms } from "./do-harness";
import type { EntityState, Inventory } from "../src/shared/types";

const bag = (): Inventory => ({
  coins: 0,
  slots: [{ item: "inn_stew", qty: 2 }, { item: "coffee", qty: 1 }, { item: "hoe", qty: 1 }, { item: "turnip", qty: 3 }, null],
});

describe("eatFrom", () => {
  it("eats one, adds its energy and reports it", () => {
    const inv = bag();
    const r = eatFrom(inv, 0, 20, 10_000, -Infinity);
    expect(r).toEqual({ ok: true, item: "inn_stew", name: "Mossy Mug Stew", gain: 50, stamina: 70 });
    expect(inv.slots[0]).toEqual({ item: "inn_stew", qty: 1 });
    if (r.ok) expect(eatNotice(r)).toBe("Ate Mossy Mug Stew (+50 energy)");
    const d = eatFrom(inv, 1, 20, 10_000, -Infinity);
    if (d.ok) expect(eatNotice(d)).toBe("Drank Coffee (+12 energy)");
    expect(inv.slots[1]).toBeNull();
  });

  it("raw crops still work, at their own value", () => {
    const inv = bag();
    expect(eatFrom(inv, 3, 50, 0, -Infinity)).toMatchObject({ ok: true, gain: getItem("turnip")!.eat, stamina: 50 + getItem("turnip")!.eat! });
  });

  it("caps at the max and refuses when full", () => {
    const inv = bag();
    expect(eatFrom(inv, 0, MAX_STAMINA - 5, 0, -Infinity)).toMatchObject({ ok: true, gain: 5, stamina: MAX_STAMINA });
    expect(eatFrom(inv, 0, MAX_STAMINA, EAT_COOLDOWN_MS, 0)).toEqual({ ok: false, reason: "You're not hungry." });
    expect(inv.slots[0]).toEqual({ item: "inn_stew", qty: 1 }); // the refused one is still there
  });

  it("refuses empty, missing and bad slots and things you can't eat, taking nothing", () => {
    for (const slot of [4, 24, -1, 1.5, NaN]) expect(eatFrom(bag(), slot, 10, 0, -Infinity), String(slot)).toEqual({ ok: false, reason: "Nothing in that slot." });
    const inv = bag();
    expect(eatFrom(inv, 2, 10, 0, -Infinity)).toEqual({ ok: false, reason: "You can't eat that." });
    expect(inv).toEqual(bag());
  });

  it("can't be spammed: one bite per EAT_COOLDOWN_MS, as long as the animation", () => {
    const inv = bag();
    expect(eatFrom(inv, 0, 0, 1000, -Infinity).ok).toBe(true);
    expect(eatFrom(inv, 0, 50, 1000 + EAT_COOLDOWN_MS - 1, 1000)).toEqual({ ok: false, reason: "Still chewing." });
    expect(inv.slots[0]).toEqual({ item: "inn_stew", qty: 1 });
    expect(eatFrom(inv, 0, 50, 1000 + EAT_COOLDOWN_MS, 1000).ok).toBe(true);
    expect(EAT_COOLDOWN_MS).toBe(EAT_MS);
  });

  it("the eat intent is valid in every room (slot only, no smuggled item)", () => {
    expect(validateClientMsg({ t: "eat", slot: 3, item: "roast_dinner" })).toEqual({ t: "eat", slot: 3 });
    expect(validateClientMsg({ t: "eat", slot: "3" })).toBeNull();
  });
});

describe("the eat act", () => {
  it("rides the entity snapshot, so everyone in the room sees what is eaten", () => {
    const e: EntityState = { id: "p:a", kind: "player", name: "A", sprite: "player_1", x: 3, y: 4, facing: "left", moving: false };
    e.act = { k: "eat", at: 1234, item: "fish_pie" };
    expect(snapshotEntity(e).act).toEqual({ k: "eat", at: 1234, item: "fish_pie" });
  });
});

describe("HomeRoom eat and the stamina round trip", () => {
  const T0 = 1_700_000_000_000;
  let r: Rooms;
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    r = createRooms();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("eats at home: one taken, energy up and capped, the act set, spam and non-food refused", async () => {
    const ws = await connectOwner(r, "alice", "Alice");
    const room = r.room("alice") as any;
    room.save.stamina = 30;
    room.save.inventory.slots[10] = { item: "roast_dinner", qty: 2 };
    await sendMsg(r, "alice", ws, { t: "eat", slot: 10 });
    expect(room.save.stamina).toBe(100);
    expect(room.save.inventory.slots[10]).toEqual({ item: "roast_dinner", qty: 1 });
    expect(room.player.entity.act).toMatchObject({ k: "eat", item: "roast_dinner" });
    expect(ws.last("notice").text).toBe("Ate Roast Dinner (+70 energy)");

    room.save.stamina = 10;
    await sendMsg(r, "alice", ws, { t: "eat", slot: 10 });
    expect(ws.last("reject").reason).toBe("Still chewing.");
    vi.advanceTimersByTime(EAT_COOLDOWN_MS);
    await sendMsg(r, "alice", ws, { t: "eat", slot: 0 }); // the hoe
    expect(ws.last("reject").reason).toBe("You can't eat that.");
    await sendMsg(r, "alice", ws, { t: "eat", slot: 10 });
    expect(room.save.stamina).toBe(80);
    expect(room.save.inventory.slots[10]).toBeNull();
  });

  it("stamina eaten back in a zone reaches the home save through savePlayer, and loads back", async () => {
    const room = r.room("alice");
    const save = await room.loadPlayer("alice", "Alice");
    expect(clampStamina(save.stamina)).toBe(MAX_STAMINA); // a new save has none: full, as the zone reads it
    // What ZoneRoom does: spend on mining, then eat bought food from the zone's copy of the bag.
    const inv = structuredClone(save.inventory);
    inv.slots[10] = { item: "fish_pie", qty: 1 };
    const r1 = eatFrom(inv, 10, 25, T0, -Infinity);
    expect(r1).toMatchObject({ ok: true, stamina: 85 });
    expect(await room.savePlayer({ ...save, inventory: inv, stamina: r1.ok ? r1.stamina : 0, zone: "village", x: 10, y: 10 })).toBe(true);
    const again = await room.loadPlayer("alice", "Alice");
    expect(again.stamina).toBe(85);
    expect(again.inventory.slots[10]).toBeNull();
    // An out-of-range stamina from a zone is clamped, never trusted.
    expect(await room.savePlayer({ ...again, stamina: 999 })).toBe(true);
    expect((await room.loadPlayer("alice", "Alice")).stamina).toBe(MAX_STAMINA);
  });
});
