import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectOwner, createRooms, sendMsg } from "./do-harness";
import { CELL_SPAWN, JAIL_ZONE, JAILED_REFUSAL, jailEndsAt } from "../src/shared/jail";

const T0 = Date.UTC(2026, 10, 2, 12);

describe("jail in the player's HomeRoom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("saves the sentence and walks an owner at home straight to the cell", async () => {
    const r = createRooms();
    const ws = await connectOwner(r, "bob", "Bob");
    const ans = await r.room("bob").jail("bob", jailEndsAt(T0, 5), "You've been sent to jail for 5 minutes.");
    expect(ans).toEqual({ ok: true });
    expect(ws.of("notice").some((n: any) => n.text === "You've been sent to jail for 5 minutes.")).toBe(true);
    expect(ws.last("zone")).toEqual({ t: "zone", to: JAIL_ZONE, spawn: CELL_SPAWN });
    const peek = await r.room("bob").peekPlayer("bob");
    expect(peek.zone).toBe(JAIL_ZONE);
    expect(peek.jailedUntil).toBe(T0 + 5 * 60_000);
  });

  it("sends a jailed owner who comes home back to the cell, and refuses travel", async () => {
    const r = createRooms();
    await connectOwner(r, "bob", "Bob");
    await r.room("bob").jail("bob", jailEndsAt(T0, 5), "jailed");
    const again = await connectOwner(r, "bob", "Bob");
    expect(again.of("notice").map((n: any) => n.text)).toContain(JAILED_REFUSAL);
    expect(again.last("zone")).toEqual({ t: "zone", to: JAIL_ZONE, spawn: CELL_SPAWN });
    expect(again.closed).not.toBeNull();
  });

  it("forgets the sentence once the time is up, and /unjail ends it early", async () => {
    const r = createRooms();
    await connectOwner(r, "bob", "Bob");
    await r.room("bob").jail("bob", jailEndsAt(T0, 5), "jailed");
    vi.setSystemTime(T0 + 5 * 60_000 + 1);
    expect((await r.room("bob").peekPlayer("bob")).jailedUntil).toBeUndefined();
    vi.setSystemTime(T0);
    await r.room("bob").jail("bob", jailEndsAt(T0, 30), "jailed");
    expect(await r.room("bob").unjail("bob")).toEqual({ ok: true });
    expect((await r.room("bob").peekPlayer("bob")).jailedUntil).toBeUndefined();
    expect(await r.room("bob").unjail("bob")).toEqual({ ok: false });
  });

  it("refuses travel from home while jailed", async () => {
    const r = createRooms();
    const ws = await connectOwner(r, "bob", "Bob");
    // Jailed while the socket stays open (as if the zone message were still on its way).
    (r.room("bob") as any).save.jailedUntil = jailEndsAt(T0, 5);
    await sendMsg(r, "bob", ws, { t: "travel", to: "village" });
    expect(ws.of("notice").map((n: any) => n.text)).toContain(JAILED_REFUSAL);
    expect(ws.of("zone")).toHaveLength(0);
  });

  it("caps a far-off or bogus end and only takes a sentence for this home's owner", async () => {
    const r = createRooms();
    expect(await r.room("nobody").jail("nobody", jailEndsAt(T0, 5), "x")).toEqual({ ok: false, noSave: true });
    await connectOwner(r, "bob", "Bob");
    await expect(r.room("bob").jail("eve", jailEndsAt(T0, 5), "x")).rejects.toThrow();
    expect(await r.room("bob").jail("bob", T0 - 1, "x")).toEqual({ ok: false });
    await r.room("bob").jail("bob", T0 + 1e12, "x");
    expect((await r.room("bob").peekPlayer("bob")).jailedUntil).toBe(T0 + 1440 * 60_000);
  });
});
