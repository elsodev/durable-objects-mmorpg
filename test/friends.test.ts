import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "./d1-sqlite";
import { handleFriends, GUEST_FRIENDS_ERROR } from "../src/worker/friends/routes";
import { friendIds } from "../src/worker/friends/store";
import { normalisePresence, socialAdapter } from "../src/worker/social-adapter";
import type { AuthUser } from "../src/worker/auth";
import {
  cleanFriendName,
  FRIEND_REQ_RATE_MAX,
  FRIEND_REQ_RATE_WINDOW_MS,
  MAX_FRIENDS,
  MAX_PENDING_OUT,
  parseFriendCommand,
  sortFriends,
  type FriendsList,
} from "../src/shared/friends";

const ORIGIN = "http://localhost:8795";

function account(id: string, name: string): AuthUser {
  return { id, name, email: `${id}@test.local`, isGuest: false, sessionId: `s-${id}` };
}

interface Sent {
  userId: string;
  payload: unknown;
}

/** Fake SOCIAL namespace: records notify() and reports `online` users as in the village. */
function fakeSocial(online: Set<string>, sent: Sent[]) {
  const stub = {
    async notify(userId: string, payload: unknown) {
      sent.push({ userId, payload });
    },
    async presenceOf(ids: string[]) {
      return ids.map((userId) => ({ userId, online: online.has(userId), zone: online.has(userId) ? "village" : null }));
    },
  };
  return { idFromName: (n: string) => ({ name: n }) as unknown as DurableObjectId, get: () => stub };
}

let t: TestDb;
let env: { DB: D1Database; BETTER_AUTH_URL: string; DMMO_ENV: string; SOCIAL?: unknown };
let sent: Sent[];
let online: Set<string>;
let now: number;

const alice = account("alice", "Alice");
const bob = account("bob", "Bob");
const carol = account("carol", "carol_9");

async function call(user: AuthUser | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { origin: ORIGIN, ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] ??= "application/json";
  }
  const res = await handleFriends(new Request(`${ORIGIN}${path}`, init), env, user, now);
  return { status: res.status, body: (await res.json()) as any };
}
const list = async (u: AuthUser) => (await call(u, "GET", "/api/friends")).body as FriendsList;
const ask = (u: AuthUser, name: string) => call(u, "POST", "/api/friends/request", { name });
const respond = (u: AuthUser, fromId: string, accept: boolean) => call(u, "POST", "/api/friends/respond", { fromId, accept });

beforeEach(() => {
  t = createTestDb();
  t.addUser("alice", "Alice");
  t.addUser("bob", "Bob");
  t.addUser("carol", "carol_9");
  sent = [];
  online = new Set();
  now = 1_700_000_000_000;
  env = { DB: t.db, BETTER_AUTH_URL: ORIGIN, DMMO_ENV: "", SOCIAL: fakeSocial(online, sent) };
});

describe("friend request lifecycle", () => {
  it("request -> pending on both sides -> accept -> friends", async () => {
    const r = await ask(alice, "Bob");
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ status: "requested", user: { userId: "bob", name: "Bob" } });
    expect(sent).toEqual([{ userId: "bob", payload: { t: "friendRequest", fromId: "alice", fromName: "Alice" } }]);

    expect((await list(alice)).outgoing.map((x) => x.userId)).toEqual(["bob"]);
    expect((await list(bob)).incoming).toEqual([{ userId: "alice", name: "Alice", at: now }]);

    const a = await respond(bob, "alice", true);
    expect(a.status).toBe(200);
    expect(a.body.status).toBe("accepted");
    expect(sent[1]).toEqual({ userId: "alice", payload: { t: "friendAccepted", userId: "bob", name: "Bob" } });

    const la = await list(alice);
    const lb = await list(bob);
    expect(la.friends.map((f) => f.name)).toEqual(["Bob"]);
    expect(lb.friends.map((f) => f.name)).toEqual(["Alice"]);
    expect(la.incoming).toEqual([]);
    expect(la.outgoing).toEqual([]);
    expect(lb.incoming).toEqual([]);
  });

  it("refuses a duplicate request and requests to existing friends", async () => {
    await ask(alice, "Bob");
    const dup = await ask(alice, "bob");
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already asked/);
    await respond(bob, "alice", true);
    const again = await ask(alice, "Bob");
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already your friend/);
  });

  it("auto-accepts when the other side already asked you", async () => {
    await ask(alice, "Bob");
    sent.length = 0;
    const r = await ask(bob, "ALICE");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "accepted", user: { userId: "alice", name: "Alice" } });
    expect(sent).toEqual([{ userId: "alice", payload: { t: "friendAccepted", userId: "bob", name: "Bob" } }]);
    expect((await list(alice)).friends.map((f) => f.userId)).toEqual(["bob"]);
    expect((await list(bob)).outgoing).toEqual([]);
  });

  it("decline removes the request silently", async () => {
    await ask(alice, "Bob");
    sent.length = 0;
    const d = await respond(bob, "alice", false);
    expect(d).toEqual({ status: 200, body: { status: "declined" } });
    expect(sent).toEqual([]);
    expect((await list(alice)).outgoing).toEqual([]);
    expect((await list(bob)).friends).toEqual([]);
    expect((await respond(bob, "alice", true)).status).toBe(404);
    // Alice may ask again later.
    expect((await ask(alice, "Bob")).status).toBe(201);
  });

  it("can't accept a request that was never sent, or your own", async () => {
    expect((await respond(bob, "alice", true)).status).toBe(404);
    await ask(alice, "Bob");
    expect((await respond(alice, "bob", true)).status).toBe(404);
  });

  it("remove ends the friendship for both and notifies the other", async () => {
    await ask(alice, "Bob");
    await respond(bob, "alice", true);
    sent.length = 0;
    const r = await call(alice, "DELETE", "/api/friends/bob");
    expect(r).toEqual({ status: 200, body: { status: "removed" } });
    expect(sent).toEqual([{ userId: "bob", payload: { t: "friendRemoved", userId: "alice" } }]);
    expect((await list(alice)).friends).toEqual([]);
    expect((await list(bob)).friends).toEqual([]);
    expect((await call(alice, "DELETE", "/api/friends/bob")).status).toBe(404);
  });

  it("DELETE also cancels an outgoing request", async () => {
    await ask(alice, "Bob");
    expect((await call(alice, "DELETE", "/api/friends/bob")).status).toBe(200);
    expect((await list(bob)).incoming).toEqual([]);
  });

  it("friendships disappear when an account is deleted", async () => {
    await ask(alice, "Bob");
    await respond(bob, "alice", true);
    await ask(alice, "carol_9");
    t.raw.prepare(`DELETE FROM "user" WHERE id = ?`).run("bob");
    t.raw.prepare(`DELETE FROM "user" WHERE id = ?`).run("carol");
    const l = await list(alice);
    expect(l.friends).toEqual([]);
    expect(l.outgoing).toEqual([]);
  });
});

describe("name lookup", () => {
  it("is case-insensitive and returns the stored spelling", async () => {
    const r = await ask(alice, "CAROL_9");
    expect(r.status).toBe(201);
    expect(r.body.user).toEqual({ userId: "carol", name: "carol_9" });
  });
  it("unknown name -> 404, yourself -> 400", async () => {
    expect((await ask(alice, "Nobody")).status).toBe(404);
    const self = await ask(alice, "alice");
    expect(self.status).toBe(400);
    expect(self.body.error).toMatch(/yourself/);
  });
  it("never finds guests", async () => {
    t.addUser("g1", "GuestPal", { guest: true });
    expect((await ask(alice, "GuestPal")).status).toBe(404);
  });
  it("can't become ambiguous: names are unique ignoring case (migrations/0006_unique_names.sql)", async () => {
    expect(() => t.addUser("bob2", "BOB")).toThrow(/UNIQUE/);
    expect((await ask(alice, "BOB")).status).toBe(201);
  });
});

describe("limits", () => {
  it(`at most ${MAX_PENDING_OUT} pending outgoing requests`, async () => {
    for (let i = 0; i < MAX_PENDING_OUT + 1; i++) t.addUser(`u${i}`, `user_${i}`);
    for (let i = 0; i < MAX_PENDING_OUT; i++) {
      // Spread over windows so the hourly rate limit doesn't interfere.
      now += FRIEND_REQ_RATE_WINDOW_MS;
      expect((await ask(alice, `user_${i}`)).status).toBe(201);
    }
    now += FRIEND_REQ_RATE_WINDOW_MS;
    const r = await ask(alice, `user_${MAX_PENDING_OUT}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/requests waiting/);
  });

  it(`rate limit: ${FRIEND_REQ_RATE_MAX} requests per hour, then 429, then resets`, async () => {
    for (let i = 0; i < FRIEND_REQ_RATE_MAX; i++) {
      // Failed lookups count too (bounds probing for names).
      expect((await ask(alice, `nobody_${i}`)).status).toBe(404);
    }
    const r = await ask(alice, "Bob");
    expect(r.status).toBe(429);
    // Another user has their own budget.
    expect((await ask(carol, "Bob")).status).toBe(201);
    now += FRIEND_REQ_RATE_WINDOW_MS;
    expect((await ask(alice, "Bob")).status).toBe(201);
  });

  it(`at most ${MAX_FRIENDS} friends (both sides checked)`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_FRIENDS; i++) {
      const id = `f${String(i).padStart(3, "0")}`;
      t.addUser(id, `friend_${i}`);
      ids.push(id);
      const [a, b] = id < "bob" ? [id, "bob"] : ["bob", id];
      t.raw.prepare(`INSERT INTO "friendship" (a_id, b_id, created_at) VALUES (?, ?, 1)`).run(a, b);
    }
    // Bob is full: Alice's request is stored, but Bob can't accept it.
    expect((await ask(alice, "Bob")).status).toBe(201);
    const acc = await respond(bob, "alice", true);
    expect(acc.status).toBe(409);
    expect(acc.body.error).toMatch(/Your friends list is full/);
    // ...and Bob asking someone new is refused up front.
    const r = await ask(bob, "carol_9");
    expect(r.status).toBe(409);
    expect((await list(bob)).friends).toHaveLength(MAX_FRIENDS);
  });
});

describe("guests and auth", () => {
  it("guests are refused with a friendly message", async () => {
    const guest: AuthUser = { id: "g", name: "Guest", email: null, isGuest: true, sessionId: "sg" };
    for (const [m, p, b] of [
      ["GET", "/api/friends", undefined],
      ["POST", "/api/friends/request", { name: "Bob" }],
      ["POST", "/api/friends/respond", { fromId: "bob", accept: true }],
      ["DELETE", "/api/friends/bob", undefined],
    ] as const) {
      const r = await call(guest, m, p, b);
      expect(r.status).toBe(403);
      expect(r.body.error).toBe(GUEST_FRIENDS_ERROR);
    }
  });
  it("signed-out callers get 401", async () => {
    expect((await call(null, "GET", "/api/friends")).status).toBe(401);
  });
  it("cross-site writes are refused", async () => {
    const r = await call(alice, "POST", "/api/friends/request", { name: "Bob" }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });
});

describe("privacy and presence", () => {
  it("zone is shown only for accepted friends", async () => {
    online.add("bob");
    online.add("carol");
    await ask(alice, "Bob");
    await ask(carol, "Alice");
    let l = await list(alice);
    // Pending entries carry no presence at all.
    expect(l.outgoing[0]).toEqual({ userId: "bob", name: "Bob", at: now });
    expect(l.incoming[0]).toEqual({ userId: "carol", name: "carol_9", at: now });
    expect(JSON.stringify(l)).not.toContain("village");

    await respond(bob, "alice", true);
    l = await list(alice);
    expect(l.friends).toEqual([{ userId: "bob", name: "Bob", online: true, zone: "village", since: now }]);
    expect(JSON.stringify(l)).not.toMatch(/carol.*village/);
  });

  it("without the SOCIAL binding everyone is offline and nothing breaks", async () => {
    delete env.SOCIAL;
    await ask(alice, "Bob");
    await respond(bob, "alice", true);
    const l = await list(alice);
    expect(l.friends).toEqual([{ userId: "bob", name: "Bob", online: false, zone: null, since: now }]);
    expect(socialAdapter({}).available).toBe(false);
  });

  it("normalisePresence never trusts zone for offline users and fills gaps", () => {
    const out = normalisePresence(["a", "b", "c"], [
      { userId: "a", online: false, zone: "village" },
      { userId: "b", online: true, zone: "x".repeat(100) },
      "junk",
    ]);
    expect(out[0]).toEqual({ userId: "a", online: false, zone: null });
    expect(out[1]!.zone).toHaveLength(32);
    expect(out[2]).toEqual({ userId: "c", online: false, zone: null });
    expect(normalisePresence(["a"], null)).toEqual([{ userId: "a", online: false, zone: null }]);
  });

  it("a failing SocialRoom degrades to offline", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    env.SOCIAL = {
      idFromName: () => ({}),
      get: () => ({
        notify: async () => {
          throw new Error("down");
        },
        presenceOf: async () => {
          throw new Error("down");
        },
      }),
    };
    expect((await ask(alice, "Bob")).status).toBe(201);
    await respond(bob, "alice", true);
    expect((await list(alice)).friends[0]!.online).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("API validation", () => {
  it("rejects bad bodies", async () => {
    const bad = [
      ["/api/friends/request", { name: "ab" }],
      ["/api/friends/request", { name: "has space" }],
      ["/api/friends/request", { name: "x".repeat(17) }],
      ["/api/friends/request", { name: 42 }],
      ["/api/friends/request", {}],
      ["/api/friends/request", "not json"],
      ["/api/friends/request", "[1]"],
      ["/api/friends/respond", { fromId: "bob" }],
      ["/api/friends/respond", { fromId: "bob", accept: "yes" }],
      ["/api/friends/respond", { fromId: "../x", accept: true }],
      ["/api/friends/respond", { accept: true }],
    ] as const;
    for (const [p, b] of bad) expect((await call(alice, "POST", p, b)).status, JSON.stringify(b)).toBe(400);
  });
  it("requires application/json and caps the body", async () => {
    expect((await call(alice, "POST", "/api/friends/request", JSON.stringify({ name: "Bob" }), { "content-type": "text/plain" })).status).toBe(400);
    expect((await call(alice, "POST", "/api/friends/request", { name: "Bob", pad: "x".repeat(2000) })).status).toBe(400);
  });
  it("wrong methods and paths", async () => {
    expect((await call(alice, "POST", "/api/friends", {})).status).toBe(405);
    expect((await call(alice, "GET", "/api/friends/request")).status).toBe(405);
    expect((await call(alice, "GET", "/api/friends/bob")).status).toBe(405);
    expect((await call(alice, "DELETE", "/api/friends/a/b")).status).toBe(404);
    expect((await call(alice, "DELETE", "/api/friends/bad%20id")).status).toBe(400);
    expect((await call(alice, "DELETE", "/api/friends/alice")).status).toBe(400);
  });
  it("trims names", async () => {
    expect((await ask(alice, "  Bob ")).status).toBe(201);
  });
});

describe("shared helpers", () => {
  it("cleanFriendName / parseFriendCommand / sortFriends", () => {
    expect(cleanFriendName(" Ann_1 ")).toBe("Ann_1");
    expect(cleanFriendName("<b>")).toBeNull();
    expect(parseFriendCommand("/friend Bob")).toEqual({ name: "Bob" });
    expect(parseFriendCommand("/FRIEND  Bob ")).toEqual({ name: "Bob" });
    expect(parseFriendCommand("/friend")).toEqual({ name: "" });
    expect(parseFriendCommand("/friends")).toBeNull();
    expect(parseFriendCommand("hello /friend Bob")).toBeNull();
    const s = sortFriends([
      { userId: "1", name: "zed", online: false, zone: null, since: 0 },
      { userId: "2", name: "Amy", online: false, zone: null, since: 0 },
      { userId: "3", name: "Max", online: true, zone: "village", since: 0 },
    ]);
    expect(s.map((f) => f.name)).toEqual(["Max", "Amy", "zed"]);
  });
});

describe("friendIds (SocialRoom presence pushes)", () => {
  it("lists only friends, from either side of the pair", async () => {
    expect(await friendIds(t.db, "alice")).toEqual([]);
    await ask(alice, "Bob");
    expect(await friendIds(t.db, "bob")).toEqual([]); // a pending request is not a friendship
    await respond(bob, "alice", true);
    expect(await friendIds(t.db, "alice")).toEqual(["bob"]);
    expect(await friendIds(t.db, "bob")).toEqual(["alice"]);
    expect(await friendIds(t.db, "carol")).toEqual([]);
  });
});
