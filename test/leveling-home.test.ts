// Level and XP in the player's HomeRoom save: defaults for old saves, the jail penalty, zone saves
// across a jailing, and shipping XP at day end with the daily selling cap.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectOwner, createRooms } from "./do-harness";
import { jailEndsAt } from "../src/shared/jail";
import { worldDay } from "../src/shared/calendar";
import { salesXpTotal, SELL_XP_DAY_MAX, xpToNext } from "../src/shared/leveling";

const T0 = Date.UTC(2026, 10, 2, 12);

describe("level in the HomeRoom save", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("a save without level fields loads as level 1 with no XP, and says so on welcome", async () => {
    const r = createRooms();
    const ws = await connectOwner(r, "bob", "Bob");
    const room = r.room("bob") as any;
    expect(room.save.level).toBeUndefined();
    expect(ws.last("xp")).toEqual({ t: "xp", level: 1, xp: 0, next: xpToNext(1) });
    expect(room.player.entity.level).toBe(1);
    expect((await r.room("bob").cardPeek()).level).toBe(1);
  });

  it("jail takes the XP toward the next level and keeps the level", async () => {
    const r = createRooms();
    const ws = await connectOwner(r, "bob", "Bob");
    const room = r.room("bob") as any;
    Object.assign(room.save, { level: 6, xp: 200 });
    await r.room("bob").jail("bob", jailEndsAt(T0, 5), "You've been sent to jail for 5 minutes.");
    expect(room.save).toMatchObject({ level: 6, xp: 0, levelEpoch: 1 });
    expect(ws.last("xp")).toMatchObject({ level: 6, xp: 0, reason: "jail", lost: 200 });
    expect(ws.of("notice").map((n: any) => n.text)).toContain("You've been sent to jail for 5 minutes. You lost your progress toward level 7.");
  });

  it("a zone save made before the jailing can't bring the XP back; one made after it can", async () => {
    const r = createRooms();
    await connectOwner(r, "bob", "Bob");
    const home = r.room("bob");
    const room = home as any;
    const save = await home.loadPlayer("bob", "Bob");
    // The zone has been hunting: level 4 with 100 XP, still on the old epoch.
    Object.assign(room.save, { level: 4, xp: 100 });
    await home.jail("bob", jailEndsAt(T0, 5), "jailed");
    expect(room.save).toMatchObject({ level: 4, xp: 0, levelEpoch: 1 });
    expect(await home.savePlayer({ ...save, level: 4, xp: 120, levelEpoch: 0 })).toBe(true);
    expect(room.save).toMatchObject({ level: 4, xp: 0 });
    // The zone took the penalty too (lockUp) and kept hunting: its saves count again.
    expect(await home.savePlayer({ ...save, level: 5, xp: 10, levelEpoch: 1 })).toBe(true);
    expect(room.save).toMatchObject({ level: 5, xp: 10, levelEpoch: 1 });
    // Tampered numbers are cleaned.
    expect(await home.savePlayer({ ...save, level: 5, xp: 1e9, levelEpoch: 1 })).toBe(true);
    expect(room.save.xp).toBe(xpToNext(5) - 1);
  });

  it("zone sales merge into the day's ledger without rolling it back", async () => {
    const r = createRooms();
    await connectOwner(r, "bob", "Bob");
    const home = r.room("bob");
    const room = home as any;
    const save = await home.loadPlayer("bob", "Bob");
    const day = worldDay(T0);
    expect(await home.savePlayer({ ...save, sales: { day, coins: 300 } })).toBe(true);
    expect(room.save.sales).toEqual({ day, coins: 300 });
    expect(await home.savePlayer({ ...save, sales: { day, coins: 100 } })).toBe(true);
    expect(room.save.sales).toEqual({ day, coins: 300 });
  });

  it("the day's shipment pays XP on the square-root scale, sharing the daily cap with shop sales", async () => {
    const r = createRooms();
    const ws = await connectOwner(r, "bob", "Bob");
    const room = r.room("bob") as any;
    room.bin = [{ item: "turnip", qty: 10 }];
    await room.endDay("sleep", Date.now());
    const coins = ws.last("daySummary").summary.total;
    expect(coins).toBeGreaterThan(0);
    const first = salesXpTotal(coins);
    expect(room.save.sales).toEqual({ day: worldDay(T0), coins });
    expect(ws.last("xp")).toMatchObject({ gain: first, reason: "ship" });
    // Already sold a fortune at the shops today: the bin pays only what is left under the cap.
    room.save.sales = { day: worldDay(T0), coins: 1e7 };
    room.bin = [{ item: "turnip", qty: 10 }];
    ws.sent = [];
    await room.endDay("sleep", Date.now());
    expect(ws.of("xp")).toHaveLength(0);
    expect(salesXpTotal(1e7)).toBe(SELL_XP_DAY_MAX);
  });

  it("a level reached at day end plays the level-up for everyone in the home", async () => {
    const r = createRooms();
    const ws = await connectOwner(r, "bob", "Bob");
    const room = r.room("bob") as any;
    Object.assign(room.save, { level: 1, xp: xpToNext(1) - 1 });
    room.bin = [{ item: "turnip", qty: 10 }];
    await room.endDay("sleep", Date.now());
    expect(room.save.level).toBe(2);
    expect(ws.last("levelUp")).toEqual({ t: "levelUp", id: room.player.entity.id, level: 2 });
    expect(room.player.entity.level).toBe(2);
  });
});
