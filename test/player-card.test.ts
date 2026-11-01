// Player card endpoint (privacy, guests, rate limit), mute storage and routes, and the server-side
// drops of whispers, friend requests and home invites from muted players.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "./d1-sqlite";
import { connectOwner, createRooms, FakeCtx, FakeWs, installWorkersGlobals, wsRequest, type Rooms } from "./do-harness";
import type { AuthUser } from "../src/worker/auth";
import { handlePlayerCard, parseCardPath } from "../src/worker/players/card";
import { handleMutes, GUEST_MUTES_ERROR, MUTE_RATE_MAX } from "../src/worker/mutes/routes";
import * as muteStore from "../src/worker/mutes/store";
import { handleFriends } from "../src/worker/friends/routes";
import { handleHomeApi } from "../src/worker/visit/routes";
import { SocialRoom } from "../src/worker/social/room";
import { H_GUEST, H_SESSION, H_USER_ID, H_USER_NAME } from "../src/worker/env";
import {
  bumpStat,
  CARD_RATE_MAX,
  CARD_RATE_WINDOW_MS,
  cleanStats,
  joinDay,
  MAX_MUTES,
  mergeStats,
  parseMuteCommand,
  type PlayerCard,
} from "../src/shared/players";

const ORIGIN = "http://localhost:8787";
const T0 = 1_700_000_000_000;

const account = (id: string, name: string, isGuest = false): AuthUser => ({
  id,
  name,
  email: isGuest ? null : `${id}@test.local`,
  isGuest,
  sessionId: `s-${id}`,
});
const alice = account("alice", "Alice");
const bob = account("bob", "Bob");
const carol = account("carol", "Carol");
const gus = account("gus", "Gus", true);

let t: TestDb;
let r: Rooms;
let pushed: { userId: string; payload: any }[];
let presence: Map<string, string>;

function fakeSocial() {
  const stub = {
    async notify(userId: string, payload: unknown) {
      pushed.push({ userId, payload });
    },
    async presenceOf(ids: string[]) {
      return ids.map((userId) => ({ userId, online: presence.has(userId), zone: presence.get(userId) ?? null }));
    },
  };
  return { idFromName: (n: string) => ({ name: n }), get: () => stub };
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  t = createTestDb();
  for (const u of [alice, bob, carol]) t.addUser(u.id, u.name);
  t.addUser("gus", "Gus", { guest: true });
  pushed = [];
  presence = new Map();
  r = createRooms({ DB: t.db, BETTER_AUTH_URL: ORIGIN, DMMO_ENV: "", SOCIAL: fakeSocial() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function card(viewer: AuthUser | null, id: string, now = Date.now()) {
  const res = await handlePlayerCard(new Request(`${ORIGIN}/api/players/${id}/card`), r.env, viewer, now);
  return { status: res.status, body: (await res.json()) as PlayerCard & { error?: string } };
}

async function mutes(user: AuthUser | null, method: string, path = "/api/mutes", body?: unknown) {
  const init: RequestInit = { method, headers: { origin: ORIGIN } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const res = await handleMutes(new Request(`${ORIGIN}${path}`, init), r.env, user, Date.now());
  return { status: res.status, body: (await res.json()) as any };
}

async function friendReq(from: AuthUser, name: string) {
  const req = new Request(`${ORIGIN}/api/friends/request`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const res = await handleFriends(req, r.env, from, Date.now());
  return { status: res.status, body: (await res.json()) as any };
}

async function friendsOf(user: AuthUser) {
  const res = await handleFriends(new Request(`${ORIGIN}/api/friends`), r.env, user, Date.now());
  return (await res.json()) as any;
}

describe("player card endpoint", () => {
  it("parses only /api/players/:id/card with a sane id", () => {
    expect(parseCardPath("/api/players/bob/card")).toBe("bob");
    expect(parseCardPath("/api/players/bob")).toBeNull();
    expect(parseCardPath("/api/players/a%2Fb/card")).toBeNull();
    expect(parseCardPath("/api/players/" + "x".repeat(65) + "/card")).toBeNull();
  });

  it("needs a session and GET", async () => {
    expect((await card(null, "bob")).status).toBe(401);
    const res = await handlePlayerCard(new Request(`${ORIGIN}/api/players/bob/card`, { method: "POST" }), r.env, alice);
    expect(res.status).toBe(405);
    expect((await card(alice, "nobody")).status).toBe(404);
  });

  it("returns public info only: never an email, a position or an inventory", async () => {
    presence.set("bob", "caves");
    const { status, body } = await card(alice, "bob");
    expect(status).toBe(200);
    expect(body).toMatchObject({ userId: "bob", name: "Bob", self: false, guest: false, minimal: false, online: true, friendship: "none", muted: false });
    expect(Object.keys(body).sort()).toEqual(
      ["friendship", "guest", "homeDay", "joined", "minimal", "muted", "name", "online", "self", "stats", "userId", "zone"].sort(),
    );
    const text = JSON.stringify(body);
    expect(text).not.toContain("@test.local");
    expect(text).not.toMatch(/"(x|y|inventory|email|coins)"/);
  });

  it("shows the zone only to friends, yourself, or someone in the same shared zone", async () => {
    presence.set("bob", "caves");
    presence.set("alice", "village");
    expect((await card(alice, "bob")).body.zone).toBeNull();
    presence.set("alice", "caves");
    expect((await card(alice, "bob")).body.zone).toBe("caves");
    // "home" is everyone's own home: sharing the word says nothing.
    presence.set("bob", "home");
    presence.set("alice", "home");
    expect((await card(alice, "bob")).body.zone).toBeNull();
    t.raw.prepare(`INSERT INTO friendship (a_id, b_id, created_at) VALUES ('alice', 'bob', 1)`).run();
    expect((await card(alice, "bob")).body).toMatchObject({ zone: "home", friendship: "friends" });
    expect((await card(alice, "alice")).body).toMatchObject({ self: true, friendship: "self", zone: "home" });
  });

  it("gives guests minimal cards, both ways", async () => {
    const asGuest = (await card(gus, "bob")).body;
    expect(asGuest).toMatchObject({ name: "Bob", minimal: true, stats: null, joined: null, homeDay: null, zone: null, online: false });
    const ofGuest = (await card(alice, "gus")).body;
    expect(ofGuest).toMatchObject({ name: "Gus", guest: true, minimal: true, stats: null });
    // Your own card is never minimal.
    expect((await card(gus, "gus")).body.minimal).toBe(false);
  });

  it("reports friendship both ways and whether you muted them", async () => {
    await friendReq(alice, "Bob");
    expect((await card(alice, "bob")).body.friendship).toBe("outgoing");
    expect((await card(bob, "alice")).body.friendship).toBe("incoming");
    await muteStore.addMute(t.db, "bob", "alice", T0);
    // A request from someone you muted stays hidden on the card too.
    expect((await card(bob, "alice")).body).toMatchObject({ friendship: "none", muted: true });
    expect((await card(alice, "bob")).body.muted).toBe(false); // mute is one-way and silent
  });

  it("shows the home day and lifetime counters from the player's save", async () => {
    expect((await card(alice, "bob")).body).toMatchObject({ homeDay: null, stats: null }); // never played
    await r.room("bob").loadPlayer("bob", "Bob");
    const b = (await card(alice, "bob")).body;
    expect(b.homeDay).toBe(1);
    expect(b.stats).toEqual({ cropsHarvested: 0, monstersDefeated: 0, oresMined: 0 });
    expect(b.joined).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rate-limits lookups per viewer", async () => {
    for (let i = 0; i < CARD_RATE_MAX; i++) expect((await card(alice, "bob")).status).toBe(200);
    expect((await card(alice, "bob")).status).toBe(429);
    expect((await card(bob, "alice")).status).toBe(200); // per viewer
    expect((await card(alice, "bob", Date.now() + CARD_RATE_WINDOW_MS + 1)).status).toBe(200);
  });
});

describe("lifetime stats in the save", () => {
  it("counts up, cleans bad input and merges by max", () => {
    const s = cleanStats({ cropsHarvested: 2, oresMined: -4, monstersDefeated: "x" });
    expect(s).toEqual({ cropsHarvested: 2, monstersDefeated: 0, oresMined: 0 });
    bumpStat(s, "oresMined");
    expect(s.oresMined).toBe(1);
    expect(mergeStats({ cropsHarvested: 5 }, { cropsHarvested: 3, oresMined: 2 })).toEqual({ cropsHarvested: 5, monstersDefeated: 0, oresMined: 2 });
  });

  it("a zone save can't roll a counter back", async () => {
    const room = r.room("bob");
    const save = await room.loadPlayer("bob", "Bob");
    expect(await room.savePlayer({ ...save, stats: { cropsHarvested: 0, monstersDefeated: 4, oresMined: 2 } })).toBe(true);
    expect(await room.savePlayer({ ...save, stats: { cropsHarvested: 0, monstersDefeated: 1, oresMined: 3 } })).toBe(true);
    expect((await room.cardPeek()).stats).toEqual({ cropsHarvested: 0, monstersDefeated: 4, oresMined: 3 });
  });

  it("parses Better Auth join dates in every stored form", () => {
    expect(joinDay(Date.UTC(2026, 2, 4))).toBe("2026-03-04");
    expect(joinDay(Date.UTC(2026, 2, 4) / 1000)).toBe("2026-03-04");
    expect(joinDay("2026-03-04 10:00:00")).toBe("2026-03-04");
    expect(joinDay("2026-03-04T10:00:00.000Z")).toBe("2026-03-04");
    expect(joinDay("nope")).toBeNull();
    expect(joinDay(null)).toBeNull();
  });
});

describe("mute storage and routes", () => {
  it("mutes by id or name, lists newest first, unmutes", async () => {
    expect((await mutes(alice, "POST", "/api/mutes", { name: "bob" })).status).toBe(201);
    vi.advanceTimersByTime(1000);
    expect((await mutes(alice, "POST", "/api/mutes", { userId: "gus" })).status).toBe(201); // guests can be muted
    expect((await mutes(alice, "POST", "/api/mutes", { userId: "bob" })).status).toBe(200); // already
    const list = (await mutes(alice, "GET")).body.muted;
    expect(list.map((m: any) => m.name)).toEqual(["Gus", "Bob"]);
    expect(await muteStore.isMutedBy(t.db, "alice", "bob")).toBe(true);
    expect(await muteStore.isMutedBy(t.db, "bob", "alice")).toBe(false);
    const un = await mutes(alice, "DELETE", "/api/mutes/bob");
    expect(un).toMatchObject({ status: 200, body: { status: "unmuted", user: { userId: "bob", name: "Bob" } } });
    expect((await mutes(alice, "DELETE", "/api/mutes/bob")).status).toBe(404);
    expect(await muteStore.mutedIds(t.db, "alice")).toEqual(["gus"]);
  });

  it("tells only the muter's own sockets, never the muted player", async () => {
    await mutes(alice, "POST", "/api/mutes", { name: "Bob" });
    await mutes(alice, "DELETE", "/api/mutes/bob");
    expect(pushed).toEqual([
      { userId: "alice", payload: { t: "mutes" } },
      { userId: "alice", payload: { t: "mutes" } },
    ]);
  });

  it("refuses guests, yourself, unknown players and bad input", async () => {
    expect(await mutes(gus, "POST", "/api/mutes", { name: "Bob" })).toMatchObject({ status: 403, body: { error: GUEST_MUTES_ERROR } });
    expect((await mutes(null, "GET")).status).toBe(401);
    expect((await mutes(alice, "POST", "/api/mutes", { name: "Alice" })).status).toBe(400);
    expect((await mutes(alice, "POST", "/api/mutes", { name: "Nobody" })).status).toBe(404);
    expect((await mutes(alice, "POST", "/api/mutes", { userId: "../x" })).status).toBe(400);
    expect((await mutes(alice, "POST", "/api/mutes", { name: "a b" })).status).toBe(400);
    const res = await handleMutes(
      new Request(`${ORIGIN}/api/mutes`, { method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" }, body: "{}" }),
      r.env,
      alice,
    );
    expect(res.status).toBe(403);
  });

  it("caps the list and rate-limits changes", async () => {
    for (let i = 0; i < MAX_MUTES; i++) {
      t.addUser(`m${i}`, `muted_${i}`);
      t.raw.prepare(`INSERT INTO player_mute (muter_id, muted_id, created_at) VALUES ('carol', ?, 1)`).run(`m${i}`);
    }
    expect(await muteStore.addMute(t.db, "carol", "bob", T0)).toBe("full");
    expect((await mutes(carol, "POST", "/api/mutes", { name: "Bob" })).status).toBe(409);
    for (let i = 0; i < MUTE_RATE_MAX; i++) await mutes(bob, "POST", "/api/mutes", { name: "Carol" });
    expect((await mutes(bob, "POST", "/api/mutes", { name: "Carol" })).status).toBe(429);
  });

  it("goes away with either account", async () => {
    await muteStore.addMute(t.db, "alice", "bob", T0);
    t.raw.prepare(`DELETE FROM "user" WHERE id = 'bob'`).run();
    expect(await muteStore.mutedIds(t.db, "alice")).toEqual([]);
  });

  it("parses /mute and /unmute", () => {
    expect(parseMuteCommand("/mute Bob")).toEqual({ cmd: "mute", name: "Bob" });
    expect(parseMuteCommand("/UNMUTE  bob ")).toEqual({ cmd: "unmute", name: "bob" });
    expect(parseMuteCommand("/mute")).toEqual({ cmd: "mute", name: "" });
    expect(parseMuteCommand("/muted bob")).toBeNull();
    expect(parseMuteCommand("mute bob")).toBeNull();
  });
});

describe("server drops from muted players", () => {
  it("a friend request to someone who muted you: no push, hidden from them, looks normal to you", async () => {
    await muteStore.addMute(t.db, "bob", "alice", T0);
    const res = await friendReq(alice, "Bob");
    expect(res).toMatchObject({ status: 201, body: { status: "requested" } });
    expect(pushed).toEqual([]);
    expect((await friendsOf(bob)).incoming).toEqual([]);
    expect((await friendsOf(alice)).outgoing.map((o: any) => o.name)).toEqual(["Bob"]);
    // Unmuted, the request shows up.
    await muteStore.removeMute(t.db, "bob", "alice");
    expect((await friendsOf(bob)).incoming.map((o: any) => o.name)).toEqual(["Alice"]);
    // Others still get pushes.
    await friendReq(carol, "Bob");
    expect(pushed.map((p) => p.payload.t)).toEqual(["friendRequest"]);
  });

  it("a home invite from a muted player never reaches the muter, but looks sent", async () => {
    await muteStore.addMute(t.db, "bob", "alice", T0);
    const req = new Request(`${ORIGIN}/api/home/invite`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ name: "Bob" }),
    });
    const res = await handleHomeApi(req, r.env, alice, Date.now());
    expect(res.status).toBe(201);
    expect(pushed).toEqual([]);
    expect(await r.room("bob").pendingInvitesFor("bob")).toEqual([]);
    const bobWs = await connectOwner(r, "bob", "Bob");
    expect(bobWs.of("invites")).toEqual([]);
  });

  describe("whispers (SocialRoom)", () => {
    function socialRoom() {
      installWorkersGlobals();
      const g = globalThis as any;
      g.WebSocketRequestResponsePair ??= class {
        constructor(
          readonly request: string,
          readonly response: string,
        ) {}
      };
      const ctx = new FakeCtx() as any;
      ctx.setWebSocketAutoResponse = () => {};
      ctx.storage.list = async () => new Map();
      const room = new SocialRoom(ctx, { DB: t.db } as any);
      return { room, ctx };
    }
    async function join(s: ReturnType<typeof socialRoom>, u: AuthUser): Promise<FakeWs> {
      await s.ctx.ready;
      await s.room.fetch(
        wsRequest(`${ORIGIN}/ws/social`, { [H_USER_ID]: u.id, [H_USER_NAME]: u.name, [H_GUEST]: u.isGuest ? "1" : "0", [H_SESSION]: u.sessionId }),
      );
      return s.ctx.sockets.at(-1)!;
    }
    const flush = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };

    it("drops a whisper from a muted player silently; others still arrive", async () => {
      await muteStore.addMute(t.db, "bob", "alice", T0);
      const s = socialRoom();
      const a = await join(s, alice);
      const b = await join(s, bob);
      const c = await join(s, carol);
      await s.room.webSocketMessage(a as any, JSON.stringify({ t: "pm", to: "Bob", text: "hi bob" }));
      await flush();
      expect(a.of("pm")).toMatchObject([{ dir: "out", name: "Bob", text: "hi bob" }]); // looks sent
      expect(a.of("notice")).toEqual([]);
      expect(b.of("pm")).toEqual([]);
      await s.room.webSocketMessage(c as any, JSON.stringify({ t: "pm", to: "Bob", text: "hey" }));
      await flush();
      expect(b.of("pm")).toMatchObject([{ dir: "in", name: "Carol", text: "hey" }]);
      // Bob can still whisper Alice: mute is one-way.
      await s.room.webSocketMessage(b as any, JSON.stringify({ t: "pm", to: "Alice", text: "yo" }));
      await flush();
      expect(a.of("pm").at(-1)).toMatchObject({ dir: "in", name: "Bob" });
    });

    it("an unmute takes effect at once (the mutes notice drops the cache)", async () => {
      await muteStore.addMute(t.db, "bob", "alice", T0);
      const s = socialRoom();
      const a = await join(s, alice);
      const b = await join(s, bob);
      await s.room.webSocketMessage(a as any, JSON.stringify({ t: "pm", to: "Bob", text: "one" }));
      await flush();
      await muteStore.removeMute(t.db, "bob", "alice");
      await s.room.notify("bob", { t: "mutes" });
      vi.advanceTimersByTime(2000); // past the chat rate limit
      await s.room.webSocketMessage(a as any, JSON.stringify({ t: "pm", to: "Bob", text: "two" }));
      await flush();
      expect(b.of("pm").map((m: any) => m.text)).toEqual(["two"]);
    });
  });
});
