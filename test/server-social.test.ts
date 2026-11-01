import { describe, expect, it } from "vitest";
import { Presence, ZONE_TTL_MS } from "../src/worker/social/presence";
import { DailyStats, utcDay } from "../src/worker/social/stats";
import { ChatGuard, MUTE_MS } from "../src/worker/game/chat";
import { checkName } from "../src/worker/names";

const ann = { userId: "u1", name: "Ann", guest: false };
const bob = { userId: "u2", name: "Bob", guest: false };

describe("presence", () => {
  it("tracks sockets per user", () => {
    const p = new Presence();
    expect(p.connect("c1", ann)).toBe(true);
    expect(p.connect("c2", ann)).toBe(false); // second tab
    expect(p.isOnline("u1")).toBe(true);
    expect(p.disconnect("c1")).toEqual({ userId: "u1", wentOffline: false });
    expect(p.disconnect("c2")).toEqual({ userId: "u1", wentOffline: true });
    expect(p.isOnline("u1")).toBe(false);
    expect(p.disconnect("nope")).toBeNull();
  });

  it("finds players by name ignoring case", () => {
    const p = new Presence();
    p.connect("c1", ann);
    p.connect("c2", bob);
    expect(p.findByName("bob")?.userId).toBe("u2");
    expect(p.findByName("ANN")?.userId).toBe("u1");
    expect(p.findByName("Cid")).toBeNull();
  });

  it("prefers server-reported zones over client claims", () => {
    const p = new Presence();
    p.connect("c1", ann);
    expect(p.setClientZone("u1", "caves", 0)).toBe(true);
    expect(p.zoneOf("u1")).toBe("caves");
    expect(p.setServerZone("u1", "village", true, 0)).toBe(true);
    expect(p.setClientZone("u1", "caves", 0)).toBe(false);
    expect(p.zoneOf("u1")).toBe("village");
  });

  it("ignores a late leave from the zone a player already left", () => {
    const p = new Presence();
    p.setServerZone("u1", "village", true, 0);
    p.setServerZone("u1", "home", true, 1); // join home arrives before the village leave
    expect(p.setServerZone("u1", "village", false, 2)).toBe(false);
    expect(p.zoneOf("u1")).toBe("home");
    expect(p.setServerZone("u1", "home", false, 3)).toBe(true);
    expect(p.zoneOf("u1")).toBeNull();
  });

  it("counts online users and zones", () => {
    const p = new Presence();
    p.connect("c1", ann);
    p.connect("c2", bob);
    p.setServerZone("u1", "village", true, 0);
    p.setServerZone("u2", "village", true, 0);
    p.setServerZone("u3", "caves", true, 0); // in a zone but no social socket (yet)
    expect(p.counts()).toEqual({ online: 3, zones: { village: 2, caves: 1 } });
  });

  it("drops client claims with the socket and prunes stale server zones", () => {
    const p = new Presence();
    p.connect("c1", ann);
    p.setClientZone("u1", "riverside", 0);
    p.disconnect("c1");
    expect(p.zoneOf("u1")).toBeNull();
    expect(p.setClientZone("u1", "caves", 0)).toBe(false); // no socket: ignored
    p.setServerZone("u9", "caves", true, 0);
    expect(p.prune(ZONE_TTL_MS + 1)).toEqual(["u9"]);
    expect(p.isOnline("u9")).toBe(false);
  });
});

describe("daily stats", () => {
  const day = Date.UTC(2026, 10, 1, 12);
  it("counts per UTC day and rolls over", () => {
    const s = DailyStats.from(null, day);
    expect(s.record("crops_shipped", 3, day)).toBe(true);
    expect(s.record("crops_shipped", 2, day + 1000)).toBe(true);
    expect(s.snapshot(day).counts).toEqual({ crops_shipped: 5 });
    expect(s.snapshot(day).day).toBe(utcDay(day));
    expect(s.snapshot(day + 24 * 3600_000).counts).toEqual({});
  });

  it("rejects bad keys and amounts", () => {
    const s = DailyStats.from(null, day);
    for (const [k, n] of [
      ["Crops", 1],
      ["__proto__", 1],
      ["a b", 1],
      ["ok", 0],
      ["ok", -1],
      ["ok", 1.5],
      ["ok", 1e9],
      ["ok", Number.NaN],
    ] as [string, number][])
      expect(s.record(k, n, day)).toBe(false);
  });

  it("restores from storage and ignores junk", () => {
    const s = DailyStats.from({ day: utcDay(day), counts: { crops_shipped: 7, "bad key": 3, x: -1 } }, day);
    expect(s.snapshot(day).counts).toEqual({ crops_shipped: 7 });
  });
});

describe("chat guard (world chat / whispers)", () => {
  it("limits to one line per second", () => {
    const g = new ChatGuard();
    expect(g.check("a", 0)).toBe("ok");
    expect(g.check("b", 500)).toBe("tooFast");
    expect(g.check("b", 1000)).toBe("ok");
  });

  it("mutes alternating spam and restores mutes after a restart", () => {
    const g = new ChatGuard();
    const lines = ["a", "b", "a", "b", "a"];
    const verdicts = lines.map((l, i) => g.check(l, i * 1000));
    expect(verdicts.at(-1)).toBe("muted");
    const fresh = new ChatGuard();
    fresh.muteUntil(4000 + MUTE_MS);
    expect(fresh.check("hello", 5000)).toBe("muted");
    expect(fresh.check("hello", 4000 + MUTE_MS + 1)).toBe("ok");
  });
});

/** Minimal D1 stand-in for the name lookup query. */
function fakeDb(users: { id: string; name: string; isAnonymous: number }[]): D1Database {
  return {
    prepare: () => ({
      bind: (name: string) => ({
        first: async () => users.find((u) => u.name.toLowerCase() === name.toLowerCase()) ?? null,
      }),
    }),
  } as unknown as D1Database;
}

describe("server name checks", () => {
  const db = fakeDb([
    { id: "a1", name: "Ann", isAnonymous: 0 },
    { id: "g1", name: "Moss", isAnonymous: 1 },
  ]);

  it("rejects invalid names", async () => {
    expect(await checkName(db, "Old Tom", { forAccount: true })).toMatchObject({ ok: false, code: "INVALID_NAME" });
    expect(await checkName(db, "ab", { forAccount: true })).toMatchObject({ ok: false, code: "INVALID_NAME" });
    expect(await checkName(db, " Ann2 ", { forAccount: true })).toMatchObject({ ok: false, code: "INVALID_NAME" });
    expect(await checkName(db, 42, { forAccount: true })).toMatchObject({ ok: false });
  });

  it("rejects taken names ignoring case", async () => {
    expect(await checkName(db, "ANN", { forAccount: true })).toEqual({ ok: false, code: "NAME_TAKEN", reason: "That name is taken." });
    expect(await checkName(db, "Cid", { forAccount: true })).toEqual({ ok: true });
  });

  it("lets a user change the case of their own name", async () => {
    expect(await checkName(db, "aNN", { forAccount: false, selfId: "a1" })).toEqual({ ok: true });
  });

  it("lets accounts (not guests) take a name a guest holds", async () => {
    expect(await checkName(db, "moss", { forAccount: true })).toEqual({ ok: true });
    expect(await checkName(db, "moss", { forAccount: false })).toMatchObject({ ok: false, code: "NAME_TAKEN" });
  });
});
