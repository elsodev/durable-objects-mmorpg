import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "./d1-sqlite";
import { connectOwner, createRooms, sendMsg, wsRequest, type FakeWs, type Rooms, FakeCtx } from "./do-harness";
import type { AuthUser } from "../src/worker/auth";
import { handleHomeApi } from "../src/worker/visit/routes";
import { forwardVisit, parseVisitPath } from "../src/worker/visit/ws";
import { VISITOR_RULES, visitorVerdict } from "../src/worker/visit/permissions";
import { addInvite, markLeft, markVisiting, pruneInvites, takeInviteQuota, type Invite } from "../src/worker/visit/invites";
import { canCredit, creditHarvest, HarvestTally } from "../src/worker/visit/harvest";
import { sleepCountdownFor } from "../src/worker/visit/visitors";
import { HomeRoom, SLEEP_COUNTDOWN_MS } from "../src/worker/home";
import { H_VISIT_OWNER, H_VISIT_RETURN } from "../src/worker/env";
import { stripIdentityHeaders } from "../src/worker/http/util";
import { dayIndex, farmNow, isFarmable, objectRect } from "../src/shared/engine";
import { getMap } from "../src/shared/maps";
import { decodeClient, type ClientMsg } from "../src/shared/protocol";
import {
  countLabel,
  INVITE_RATE_MAX,
  INVITE_TTL_MS,
  MAX_INVITES,
  MAX_VISITORS,
  REJOIN_GRACE_MS,
} from "../src/shared/visits";
import { BIN_MAX } from "../src/worker/game/shipping";
import type { FarmTile, Inventory } from "../src/shared/types";
import { EMOTES } from "../src/shared/emotes";

const EMOTE_CODE = EMOTES[0];

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
const basil = account("basil", "Basil");
const gus = account("gus", "Gus", true);

let t: TestDb;
let r: Rooms;
let pushed: { userId: string; payload: any }[];

function fakeSocial() {
  const stub = {
    async notify(userId: string, payload: unknown) {
      pushed.push({ userId, payload });
    },
    async presenceOf(ids: string[]) {
      return ids.map((userId) => ({ userId, online: false, zone: null }));
    },
  };
  return { idFromName: (n: string) => ({ name: n }), get: () => stub };
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  // Normal-quality harvests and no crows, so results are exact.
  vi.spyOn(Math, "random").mockReturnValue(0.99);
  t = createTestDb();
  t.addUser("alice", "Alice");
  t.addUser("basil", "Basil");
  t.addUser("gus", "Gus", { guest: true });
  for (let i = 0; i < 12; i++) t.addUser(`u${i}`, `user_${i}`);
  pushed = [];
  r = createRooms({ DB: t.db, BETTER_AUTH_URL: ORIGIN, DMMO_ENV: "", SOCIAL: fakeSocial() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function api(user: AuthUser | null, path: string, body: unknown) {
  const req = new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await handleHomeApi(req, r.env, user, Date.now());
  return { status: res.status, body: (await res.json()) as any };
}
const invite = (from: AuthUser, name: string) => api(from, "/api/home/invite", { name });

async function visit(user: AuthUser | null, ownerId: string, headers: Record<string, string> = { origin: ORIGIN }) {
  const before = r.ctx(ownerId).sockets.length;
  const res = await forwardVisit(wsRequest(`${ORIGIN}/ws/visit/${ownerId}`, headers), r.env, ownerId, user, Date.now());
  const ws = r.ctx(ownerId).sockets.length > before ? r.ctx(ownerId).sockets.at(-1)! : null;
  return { res, ws };
}

/** Alice at home, Basil invited and visiting. */
async function aliceHostsBasil(): Promise<{ owner: FakeWs; guest: FakeWs }> {
  const owner = await connectOwner(r, "alice", "Alice");
  expect((await invite(alice, "Basil")).status).toBe(201);
  const { res, ws } = await visit(basil, "alice");
  expect(res.status).toBe(101);
  return { owner, guest: ws! };
}

function readyTurnip(x: number, y: number): FarmTile {
  return { x, y, crop: "turnip", plantedAt: farmNow(1), wateredDays: 9, lastWateredDay: dayIndex(farmNow(1)) };
}

/** Puts a ripe crop next to the visitor spawn (37,12) on Alice's farm, on day 5. */
function ripeCropFor(room: HomeRoom, x = 36, y = 12): FarmTile {
  const anyRoom = room as any;
  anyRoom.clock = { day: 5, startAt: Date.now() };
  const tile = readyTurnip(x, y);
  anyRoom.farm.push(tile);
  return tile;
}

// ------------------------------------------------------------------ pure pieces

describe("invite book", () => {
  const owner = { id: "alice", name: "Alice", guest: false };
  const p = (id: string, guest = false) => ({ id, name: id, guest });

  it("refuses guests on either side and self-invites", () => {
    const list: Invite[] = [];
    expect(addInvite(list, { ...owner, guest: true }, p("basil"), T0)).toMatchObject({ ok: false, status: 403 });
    expect(addInvite(list, owner, p("gus", true), T0)).toMatchObject({ ok: false, status: 403 });
    expect(addInvite(list, owner, p("alice"), T0)).toMatchObject({ ok: false, status: 400 });
    expect(list).toEqual([]);
  });

  it("caps live invites at MAX_INVITES, renews instead of duplicating, expires after the TTL", () => {
    const list: Invite[] = [];
    for (let i = 0; i < MAX_INVITES; i++) expect(addInvite(list, owner, p(`u${i}`), T0).ok).toBe(true);
    expect(addInvite(list, owner, p("extra"), T0)).toMatchObject({ ok: false, status: 409 });
    const again = addInvite(list, owner, p("u3"), T0 + 1000);
    expect(again).toMatchObject({ ok: true, renewed: true });
    expect(list).toHaveLength(MAX_INVITES);
    // Everyone but u3 (renewed) runs out at T0 + TTL.
    expect(pruneInvites(list, T0 + INVITE_TTL_MS)).toBe(true);
    expect(list.map((i) => i.userId)).toEqual(["u3"]);
  });

  it("an invite in use doesn't expire; a dropped socket gets a grace period; a deliberate leave uses it up", () => {
    const list: Invite[] = [];
    addInvite(list, owner, p("basil"), T0);
    markVisiting(list, "basil");
    expect(pruneInvites(list, T0 + 10 * INVITE_TTL_MS)).toBe(false);
    markLeft(list, "basil", T0, false);
    expect(list[0]!.expiresAt).toBe(T0 + REJOIN_GRACE_MS);
    markLeft(list, "basil", T0, true);
    expect(list).toEqual([]);
  });

  it("rate limits invite attempts", () => {
    const times: number[] = [];
    for (let i = 0; i < INVITE_RATE_MAX; i++) expect(takeInviteQuota(times, T0)).toBe(true);
    expect(takeInviteQuota(times, T0)).toBe(false);
  });
});

describe("visitor permission matrix", () => {
  const samples: { [K in ClientMsg["t"]]: Extract<ClientMsg, { t: K }> } = {
    move: { t: "move", dx: 1, dy: 0 },
    moveTo: { t: "moveTo", x: 3, y: 3 },
    chat: { t: "chat", text: "hi" },
    use: { t: "use", slot: 0, x: 1, y: 1 },
    interact: { t: "interact", target: "shipping_bin" },
    place: { t: "place", slot: 0, x: 1, y: 1, rotation: 0 },
    moveObject: { t: "moveObject", id: "bed", x: 1, y: 1, rotation: 0 },
    pickup: { t: "pickup", id: "bed" },
    buy: { t: "buy", npc: "n", item: "seed_turnip", qty: 1 },
    sell: { t: "sell", npc: "n", slot: 0, qty: 1 },
    donate: { t: "donate", goal: "bridge", slot: 0, qty: 1 },
    setLook: { t: "setLook", look: undefined as never },
    ping: { t: "ping", at: 1 },
    eat: { t: "eat", slot: 0 },
    sleep: { t: "sleep" },
    unship: { t: "unship" },
    giftNpc: { t: "giftNpc", npc: "n", slot: 0 },
    emote: { t: "emote", code: EMOTE_CODE },
    moveSlot: { t: "moveSlot", from: 0, to: 1 },
    hold: { t: "hold", slot: 0 },
  };

  it("allows only walking, chat, ping and harvest-use", () => {
    const allowed = Object.entries(VISITOR_RULES)
      .filter(([, v]) => "allow" in v)
      .map(([k]) => k)
      .sort();
    expect(allowed).toEqual(["chat", "emote", "hold", "move", "moveTo", "ping", "use"]);
    for (const m of Object.values(samples)) expect(visitorVerdict(m as ClientMsg)).toBe(VISITOR_RULES[m.t]);
  });

  it("server refuses every owner-only message from a visitor and changes nothing", async () => {
    const { owner, guest } = await aliceHostsBasil();
    const room = r.room("alice") as any;
    const before = JSON.stringify({ inv: room.save.inventory, objects: room.objects, farm: room.farm, bin: room.bin, clock: room.clock });
    const denied = Object.values(samples).filter((m) => "deny" in VISITOR_RULES[m.t]);
    expect(denied.map((m) => m.t).sort()).toEqual(
      ["buy", "donate", "eat", "giftNpc", "interact", "moveObject", "pickup", "place", "sell", "setLook", "sleep", "unship", "moveSlot"].sort(),
    );
    for (const m of denied) {
      const msg = m.t === "setLook" ? { t: "setLook", look: { body: "x" } } : m;
      guest.sent = [];
      await sendMsg(r, "alice", guest, msg);
      vi.advanceTimersByTime(250);
      // setLook with a bogus look fails validation (dropped); everything valid is rejected by name.
      if (decodeClient(JSON.stringify(msg))) expect(guest.of("reject").map((x) => x.action)).toContain(m.t);
    }
    // Tools on an untilled tile do nothing either: `use` only harvests.
    guest.sent = [];
    await sendMsg(r, "alice", guest, { t: "use", slot: 0, x: 36, y: 13 });
    expect(guest.last("reject").reason).toMatch(/only help harvest/);
    const after = JSON.stringify({ inv: room.save.inventory, objects: room.objects, farm: room.farm, bin: room.bin, clock: room.clock });
    expect(after).toBe(before);
    expect(guest.closed).toBeNull();
    expect(owner.of("inventory")).toHaveLength(0);
  });

  it("an exit ends the visit instead of taking the visitor to the village", async () => {
    const { guest } = await aliceHostsBasil();
    const room = r.room("alice") as any;
    const v = room.visitors.byUser("basil");
    v.entity.x = 39.5;
    v.entity.y = 12.5;
    vi.advanceTimersByTime(150);
    expect(guest.last("zone")).toEqual({ t: "zone", to: "home", spawn: "default" });
    expect(guest.closed).not.toBeNull();
    expect(room.invites).toEqual([]);
  });
});

describe("harvest credit", () => {
  const inv = (): Inventory => ({ coins: 0, slots: [] });

  it("goes to the bag, then the shipping bin, then nowhere", () => {
    const bag = inv();
    const bin: { item: string; qty: number }[] = [];
    expect(creditHarvest(bag, bin, "turnip")).toBe("bag");
    const full: Inventory = { coins: 0, slots: Array.from({ length: 24 }, () => ({ item: "stone", qty: 999 })) };
    expect(creditHarvest(full, bin, "turnip")).toBe("bin");
    expect(creditHarvest(full, bin, "turnip")).toBe("bin");
    expect(bin).toEqual([{ item: "turnip", qty: 2 }]);
    const packed = Array.from({ length: BIN_MAX }, () => ({ item: "copper_ore", qty: 1 }));
    expect(canCredit(full, packed, "turnip")).toBe(false);
    expect(creditHarvest(full, packed, "turnip")).toBeNull();
  });

  it("batches owner notices per helper and crop", () => {
    const tally = new HarvestTally(2000);
    tally.add("Basil", "turnip", "bag", T0);
    tally.add("Basil", "turnip", "bag", T0 + 500);
    tally.add("Basil", "turnip", "bag", T0 + 900);
    expect(tally.flush(T0 + 1000)).toEqual([]);
    expect(tally.flush(T0 + 2000)).toEqual(["Basil helped harvest 3 turnips"]);
    expect(countLabel(1, "Turnip")).toBe("1 turnip");
  });

  it("a visitor's harvest lands in the owner's bag; the owner sees who helped", async () => {
    const { owner, guest } = await aliceHostsBasil();
    const room = r.room("alice") as any;
    const tile = ripeCropFor(room);
    const turnipsBefore = room.save.inventory.slots.filter((s: any) => s && /^turnip(_silver|_gold)?$/.test(s.item)).reduce((n: number, s: any) => n + s.qty, 0);
    guest.sent = [];
    await sendMsg(r, "alice", guest, { t: "use", slot: 5, x: tile.x, y: tile.y });
    expect(tile.crop).toBeNull();
    const turnipsAfter = room.save.inventory.slots.filter((s: any) => s && /^turnip(_silver|_gold)?$/.test(s.item)).reduce((n: number, s: any) => n + s.qty, 0);
    expect(turnipsAfter).toBe(turnipsBefore + 1);
    expect(owner.of("inventory")).toHaveLength(1);
    expect(guest.of("inventory")).toHaveLength(0); // visitors never see the owner's bag
    expect(guest.of("farm")).toHaveLength(1);
    vi.advanceTimersByTime(2500);
    expect(owner.of("notice").map((n) => n.text)).toContain("Basil helped harvest 1 turnip");
  });

  it("stamps the owner's tool results with the swing's impact, so watchers see them land mid-swing", async () => {
    const { owner, guest } = await aliceHostsBasil();
    const room = r.room("alice") as any;
    const home = getMap("home");
    let spot = { x: 0, y: 0 };
    for (let y = 1; y < home.height && !spot.x; y++) {
      for (let x = 0; x < home.width; x++) {
        if (isFarmable(home, x, y, room.objects.home) && !home.rocks?.some((k) => k.x === x && k.y === y)) {
          spot = { x, y };
          break;
        }
      }
    }
    room.player.entity.x = spot.x + 0.5;
    room.player.entity.y = spot.y - 0.5;
    guest.sent = [];
    await sendMsg(r, "alice", owner, { t: "use", slot: 0, x: spot.x, y: spot.y });
    const farm = guest.last("farm");
    expect(farm.tiles[0]).toMatchObject({ ...spot, crop: null });
    expect(farm.by).toBe("p:alice");
    expect(farm.impactAt - Date.now()).toBe(230); // facing down
  });

  it("with the owner's bag full the crop goes to the owner's shipping bin", async () => {
    const { owner, guest } = await aliceHostsBasil();
    const room = r.room("alice") as any;
    room.save.inventory.slots = Array.from({ length: 24 }, () => ({ item: "stone", qty: 999 }));
    const tile = ripeCropFor(room);
    await sendMsg(r, "alice", guest, { t: "use", slot: 0, x: tile.x, y: tile.y });
    expect(room.bin).toEqual([{ item: "turnip", qty: 1 }]);
    expect(owner.last("bin").items).toHaveLength(1);
    vi.advanceTimersByTime(2500);
    expect(owner.last("notice").text).toBe("Basil helped harvest 1 turnip (into your shipping bin, your bag was full)");
  });

  it("unripe crops and crops out of reach are refused", async () => {
    const { guest } = await aliceHostsBasil();
    const room = r.room("alice") as any;
    const far = ripeCropFor(room, 20, 12);
    await sendMsg(r, "alice", guest, { t: "use", slot: 0, x: far.x, y: far.y });
    expect(guest.last("reject").reason).toBe("Too far away.");
    expect(far.crop).toBe("turnip");
    vi.advanceTimersByTime(300);
    const green = { x: 36, y: 13, crop: "turnip", plantedAt: farmNow(5), wateredDays: 0, lastWateredDay: null };
    room.farm.push(green);
    await sendMsg(r, "alice", guest, { t: "use", slot: 0, x: 36, y: 13 });
    expect(guest.last("reject").reason).toMatch(/only help harvest ripe/);
    expect(green.crop).toBe("turnip");
  });
});

// ------------------------------------------------------------------ HTTP + routes

describe("invite lifecycle over HTTP", () => {
  it("invites by name, fills the invitee's inbox and pushes a social notice", async () => {
    const res = await invite(alice, "basil");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "invited", user: { userId: "basil", name: "Basil" }, expiresAt: T0 + INVITE_TTL_MS });
    expect(pushed).toEqual([{ userId: "basil", payload: { t: "invite", fromId: "alice", fromName: "Alice", expiresAt: T0 + INVITE_TTL_MS } }]);
    expect(await r.room("basil").pendingInvitesFor("basil")).toEqual([{ fromId: "alice", fromName: "Alice", expiresAt: T0 + INVITE_TTL_MS }]);
  });

  it("an invitee at home sees the invite right away, and on their next connect", async () => {
    const basilWs = await connectOwner(r, "basil", "Basil");
    await invite(alice, "Basil");
    expect(basilWs.last("invites").invites[0]).toMatchObject({ fromId: "alice" });
    const again = await connectOwner(r, "basil", "Basil");
    expect(again.last("invites").invites).toHaveLength(1);
  });

  it("refuses guests, unknown names and self-invites", async () => {
    expect((await invite(gus, "Basil")).status).toBe(403);
    expect((await invite(alice, "Gus")).status).toBe(404); // guests can't be found, so can't be invited
    expect((await invite(alice, "Alice")).status).toBe(400);
    expect((await invite(alice, "no")).status).toBe(400); // not a valid name
    expect((await api(null, "/api/home/invite", { name: "Basil" })).status).toBe(401);
    expect(pushed).toEqual([]);
  });

  it("holds at most 10 invites, and expired ones free their slot", async () => {
    for (let i = 0; i < MAX_INVITES; i++) expect((await invite(alice, `user_${i}`)).status).toBe(201);
    const eleventh = await invite(alice, "user_10");
    expect(eleventh.status).toBe(409);
    expect(eleventh.body.error).toMatch(/10 invites/);
    vi.advanceTimersByTime(INVITE_TTL_MS + 1);
    expect((await invite(alice, "user_10")).status).toBe(201);
  });

  it("an unused invite expires after 10 minutes", async () => {
    await connectOwner(r, "alice", "Alice");
    await invite(alice, "Basil");
    expect(await r.room("alice").checkInvite("alice", "basil")).toMatchObject({ ok: true });
    vi.advanceTimersByTime(INVITE_TTL_MS + 1);
    expect(await r.room("alice").checkInvite("alice", "basil")).toMatchObject({ ok: false });
    expect(await r.room("basil").pendingInvitesFor("basil")).toEqual([]);
    expect((await visit(basil, "alice")).res.status).toBe(403);
  });

  it("decline withdraws the invite and tells the owner", async () => {
    const owner = await connectOwner(r, "alice", "Alice");
    await invite(alice, "Basil");
    const res = await api(basil, "/api/home/invites/respond", { fromId: "alice", accept: false });
    expect(res.body).toEqual({ status: "declined", ownerId: "alice" });
    expect(owner.last("notice").text).toMatch(/Basil can't come over/);
    expect(await r.room("basil").pendingInvitesFor("basil")).toEqual([]);
    expect((await visit(basil, "alice")).res.status).toBe(403);
  });

  it("accept checks the invite is still good (owner home)", async () => {
    await invite(alice, "Basil");
    const away = await api(basil, "/api/home/invites/respond", { fromId: "alice", accept: true });
    expect(away.status).toBe(409);
    expect(away.body.error).toMatch(/isn't home/);
    await invite(alice, "Basil");
    await connectOwner(r, "alice", "Alice");
    const ok = await api(basil, "/api/home/invites/respond", { fromId: "alice", accept: true });
    expect(ok.body).toEqual({ status: "accepted", ownerId: "alice" });
  });

  it("uninvite removes the invite, clears the inbox and pushes inviteRevoked", async () => {
    await invite(alice, "Basil");
    const res = await api(alice, "/api/home/uninvite", { name: "BASIL" });
    expect(res.status).toBe(200);
    expect(pushed.at(-1)).toEqual({ userId: "basil", payload: { t: "inviteRevoked", fromId: "alice" } });
    expect(await r.room("basil").pendingInvitesFor("basil")).toEqual([]);
    expect((await api(alice, "/api/home/uninvite", { name: "Basil" })).status).toBe(404);
  });

  it("rate limits invite attempts, found or not", async () => {
    for (let i = 0; i < INVITE_RATE_MAX; i++) await invite(alice, "nobody_here");
    expect((await invite(alice, "Basil")).status).toBe(429);
  });

  it("requires POST, JSON and our origin", async () => {
    const bad = await handleHomeApi(
      new Request(`${ORIGIN}/api/home/invite`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }),
      r.env,
      alice,
    );
    expect(bad.status).toBe(403);
    const get = await handleHomeApi(new Request(`${ORIGIN}/api/home/invite`), r.env, alice);
    expect(get.status).toBe(405);
  });
});

describe("visit route", () => {
  it("parses /ws/visit/<ownerId>", () => {
    expect(parseVisitPath("/ws/visit/alice")).toBe("alice");
    expect(parseVisitPath("/ws/visit/alice/")).toBe("alice");
    expect(parseVisitPath("/ws/visit/")).toBeNull();
    expect(parseVisitPath("/ws/visit/a%2Fb")).toBeNull();
    expect(parseVisitPath("/ws/visit/a/b")).toBeNull();
  });

  it("checks session, account, self, invite, owner presence, upgrade and origin", async () => {
    expect((await visit(null, "alice")).res.status).toBe(401);
    expect((await visit(gus, "alice")).res.status).toBe(403);
    expect((await visit(alice, "alice")).res.status).toBe(403);
    expect((await visit(basil, "alice")).res.status).toBe(403); // no invite
    await invite(alice, "Basil");
    const away = await visit(basil, "alice");
    expect(away.res.status).toBe(403); // owner not home
    expect(await away.res.json()).toEqual({ error: "Alice isn't home right now. Try again later." });
    await connectOwner(r, "alice", "Alice");
    // A probe (plain GET) after a refused socket: 426 means "allowed, retry".
    const probe = await forwardVisit(new Request(`${ORIGIN}/ws/visit/alice`), r.env, "alice", basil);
    expect(probe.status).toBe(426);
    expect((await visit(basil, "alice", { origin: "https://evil.example" })).res.status).toBe(403);
    const ok = await visit(basil, "alice");
    expect(ok.res.status).toBe(101);
    const welcome = ok.ws!.last("welcome");
    expect(welcome).toMatchObject({ zone: "home", visit: { ownerId: "alice", ownerName: "Alice", returnTo: "home" } });
    expect(welcome.inventory).toEqual({ coins: 0, slots: [] });
    expect(welcome.entities.map((e: any) => e.id).sort()).toEqual(["p:alice", "p:basil"]);
  });

  it("a client can't mark itself a visitor: x-dmmo-* headers are stripped", () => {
    const h = stripIdentityHeaders(new Headers({ [H_VISIT_OWNER]: "alice", [H_VISIT_RETURN]: "caves", cookie: "a=b" }));
    expect(h.get(H_VISIT_OWNER)).toBeNull();
    expect(h.get(H_VISIT_RETURN)).toBeNull();
    expect(h.get("cookie")).toBe("a=b");
  });

  it("the home itself refuses a visitor socket without a live invite (race with uninvite)", async () => {
    await connectOwner(r, "alice", "Alice");
    const res = await r.room("alice").fetch(
      wsRequest(`${ORIGIN}/ws/visit/alice`, { "x-dmmo-user-id": "basil", "x-dmmo-user-name": "Basil", [H_VISIT_OWNER]: "alice" }),
    );
    expect(res.status).toBe(403);
    const wrong = await r.room("alice").fetch(
      wsRequest(`${ORIGIN}/ws/visit/x`, { "x-dmmo-user-id": "basil", "x-dmmo-user-name": "Basil", [H_VISIT_OWNER]: "mallory" }),
    );
    expect(wrong.status).toBe(403);
  });

  it("caps concurrent visitors at 10", async () => {
    await connectOwner(r, "alice", "Alice");
    const room = r.room("alice") as any;
    for (let i = 0; i < MAX_VISITORS; i++) {
      await invite(alice, `user_${i}`);
      expect((await visit(account(`u${i}`, `user_${i}`), "alice")).res.status).toBe(101);
    }
    expect(room.visitors.size).toBe(MAX_VISITORS);
    // All 10 invite slots are in use, so an 11th can't even be invited.
    expect((await invite(alice, "user_10")).status).toBe(409);
    expect(await r.room("alice").checkInvite("alice", "u10")).toMatchObject({ ok: false });
  });
});

// ------------------------------------------------------------------ leases + visit lifecycle

describe("visits never take the visitor's lease", () => {
  it("visiting reads the visitor's save without loadPlayer, and leaves their lease and save alone", async () => {
    const bRoom = r.room("basil");
    const save = await bRoom.loadPlayer("basil", "Basil"); // Basil is playing in the village
    await bRoom.savePlayer({ ...save, zone: "village", x: 12, y: 9 });
    const leaseBefore = r.ctx("basil").storage.data.get("lease");
    const saveBefore = JSON.stringify(r.ctx("basil").storage.data.get("save"));
    r.calls.length = 0;

    await connectOwner(r, "alice", "Alice");
    await invite(alice, "Basil");
    const { ws } = await visit(basil, "alice");
    expect(ws!.last("welcome").visit.returnTo).toBe("village");
    await sendMsg(r, "alice", ws!, { t: "move", dx: -1, dy: 0 });
    vi.advanceTimersByTime(500);

    const onBasil = r.calls.filter((c) => c.room === "basil").map((c) => c.method);
    expect(onBasil).not.toContain("loadPlayer");
    expect(onBasil).not.toContain("savePlayer");
    expect(onBasil).not.toContain("fetch");
    expect(onBasil).toContain("peekPlayer");
    expect(r.ctx("basil").storage.data.get("lease")).toBe(leaseBefore);
    expect(JSON.stringify(r.ctx("basil").storage.data.get("save"))).toBe(saveBefore);
    // The zone that holds Basil's lease can still save.
    expect(await bRoom.savePlayer({ ...save, zone: "village", x: 13, y: 9 })).toBe(true);
    // And Alice's own lease (her home) is untouched by Basil arriving.
    expect(r.ctx("alice").storage.data.get("lease")).toBeTypeOf("string");
  });

  it("peekPlayer takes no lease", async () => {
    const bRoom = r.room("basil");
    const save = await bRoom.loadPlayer("basil", "Basil");
    await bRoom.peekPlayer("basil");
    expect(await bRoom.savePlayer(save)).toBe(true);
    await expect(bRoom.peekPlayer("mallory")).rejects.toThrow();
  });
});

describe("visit endings send the visitor back", () => {
  async function basilFromVillage() {
    const bRoom = r.room("basil");
    const save = await bRoom.loadPlayer("basil", "Basil");
    await bRoom.savePlayer({ ...save, zone: "village", x: 12, y: 9 });
  }

  it("kick (by user id or name) returns the visitor to their zone and uses the invite up", async () => {
    await basilFromVillage();
    const { owner, guest } = await aliceHostsBasil();
    expect(owner.last("visitors")).toEqual({ t: "visitors", visitors: [{ userId: "basil", name: "Basil" }], max: MAX_VISITORS });
    const res = await api(alice, "/api/home/kick", { userId: "basil" });
    expect(res.body).toEqual({ status: "kicked", user: { userId: "basil", name: "Basil" } });
    expect(guest.last("zone")).toEqual({ t: "zone", to: "village", spawn: "default" });
    expect(guest.closed).not.toBeNull();
    expect(owner.last("visitors").visitors).toEqual([]);
    expect((await visit(basil, "alice")).res.status).toBe(403);
    expect((await api(alice, "/api/home/kick", { name: "Basil" })).status).toBe(404);
  });

  it("uninvite while visiting sends them home", async () => {
    const { guest } = await aliceHostsBasil();
    await api(alice, "/api/home/uninvite", { name: "basil" });
    expect(guest.last("zone")).toMatchObject({ t: "zone", to: "home" });
  });

  it("the owner leaving through the exit ends every visit", async () => {
    await basilFromVillage();
    const { owner, guest } = await aliceHostsBasil();
    const room = r.room("alice") as any;
    room.player.entity.x = 39.5;
    room.player.entity.y = 12.5;
    vi.advanceTimersByTime(150);
    expect(owner.last("zone")).toMatchObject({ to: "village" });
    expect(guest.last("zone")).toEqual({ t: "zone", to: "village", spawn: "default" });
    expect(room.visitors.size).toBe(0);
    expect(room.invites).toEqual([]);
  });

  it("the owner disconnecting ends every visit", async () => {
    const { owner, guest } = await aliceHostsBasil();
    await r.room("alice").webSocketClose(owner as any);
    expect(guest.last("zone")).toMatchObject({ t: "zone", to: "home" });
    expect(guest.last("notice").text).toMatch(/Alice left home/);
  });

  it("the owner joining a zone (loadPlayer) ends every visit", async () => {
    const { guest } = await aliceHostsBasil();
    await r.room("alice").loadPlayer("alice", "Alice");
    expect(guest.last("zone")).toMatchObject({ t: "zone", to: "home" });
  });

  it("the owner's second tab keeps the visitors", async () => {
    const { guest } = await aliceHostsBasil();
    const tab2 = await connectOwner(r, "alice", "Alice");
    expect(guest.closed).toBeNull();
    expect(tab2.last("visitors").visitors).toHaveLength(1);
    expect(tab2.last("welcome").entities).toHaveLength(2);
  });

  it("a visitor whose socket dropped may reconnect within the grace period", async () => {
    const { guest } = await aliceHostsBasil();
    await r.room("alice").webSocketClose(guest as any);
    expect((await visit(basil, "alice")).res.status).toBe(101);
    await r.room("alice").webSocketClose(r.ctx("alice").sockets.at(-1) as any);
    vi.advanceTimersByTime(REJOIN_GRACE_MS + 1);
    expect((await visit(basil, "alice")).res.status).toBe(403);
  });

  it("a woken home rebuilds its visitors, or sends them home if the owner is gone", async () => {
    const { owner, guest } = await aliceHostsBasil();
    const ctx: FakeCtx = r.ctx("alice");
    // A woken room re-checks sessions on the first message: answer "still signed in" (s-<userId>).
    const DB = {
      prepare: () => ({
        bind: (sid: string) => ({ first: async () => ({ userId: sid.slice(2), expiresAt: null }) }),
      }),
    };
    const env = { ...r.env, DB };
    const woken = new HomeRoom(ctx as any, env);
    await ctx.ready;
    guest.sent = [];
    await woken.webSocketMessage(guest as any, JSON.stringify({ t: "chat", text: "still here" }));
    expect(owner.last("chat")).toMatchObject({ name: "Basil", text: "still here" });
    expect(guest.closed).toBeNull();

    owner.close(1000, "gone");
    const again = new HomeRoom(ctx as any, env);
    await ctx.ready;
    expect(guest.last("zone")).toMatchObject({ t: "zone", to: "home" });
    expect((again as any).visitors.size).toBe(0);
  });
});

// ------------------------------------------------------------------ chat, clock, sleep

describe("at home together", () => {
  it("chat reaches everyone; home commands are never broadcast", async () => {
    const { owner, guest } = await aliceHostsBasil();
    await sendMsg(r, "alice", guest, { t: "chat", text: "nice farm!" });
    expect(owner.last("chat")).toMatchObject({ from: "p:basil", name: "Basil", text: "nice farm!" });
    vi.advanceTimersByTime(1500);
    owner.sent = [];
    await sendMsg(r, "alice", guest, { t: "chat", text: "/invite user_1" });
    expect(owner.of("chat")).toEqual([]);
    expect(guest.last("notice").text).toMatch(/didn't go through/);
  });

  it("visitor emotes reach everyone at home", async () => {
    const { owner, guest } = await aliceHostsBasil();
    await sendMsg(r, "alice", guest, { t: "emote", code: EMOTE_CODE });
    expect(owner.last("emote")).toEqual({ t: "emote", from: "p:basil", code: EMOTE_CODE });
    expect(guest.last("emote")).toEqual({ t: "emote", from: "p:basil", code: EMOTE_CODE });
  });

  it("visitors see the host's clock, not their own vitals", async () => {
    const { owner, guest } = await aliceHostsBasil();
    expect(guest.last("homeState").clock).toEqual(owner.last("homeState").clock);
    expect(guest.of("bin")).toEqual([]);
  });

  it("sleeping with visitors over runs a 5 s countdown everyone sees", async () => {
    const { owner, guest } = await aliceHostsBasil();
    const room = r.room("alice") as any;
    const bed = room.objects.home_in.find((o: any) => o.item === "bed_simple");
    const rect = objectRect(bed.item, bed.x, bed.y, bed.rotation);
    room.player.map = "home_in"; // the bed is inside the house
    room.player.entity.x = rect.x + rect.w + 0.5;
    room.player.entity.y = rect.y + rect.h - 0.5;
    const day = room.clock.day;
    await sendMsg(r, "alice", guest, { t: "sleep" });
    expect(guest.last("reject").reason).toMatch(/someone else's bed/);
    await sendMsg(r, "alice", owner, { t: "sleep" });
    const endsAt = Date.now() + SLEEP_COUNTDOWN_MS;
    expect(owner.last("sleeping")).toEqual({ t: "sleeping", host: "Alice", endsAt });
    expect(guest.last("sleeping")).toEqual({ t: "sleeping", host: "Alice", endsAt });
    expect(room.clock.day).toBe(day);
    vi.advanceTimersByTime(SLEEP_COUNTDOWN_MS + 200);
    expect(room.clock.day).toBe(day + 1);
    expect(owner.of("daySummary")).toHaveLength(1);
    expect(guest.of("daySummary")).toHaveLength(0);
    expect(guest.last("homeState").clock.day).toBe(day + 1);
  });

  it("sleeping alone ends the day at once", async () => {
    const owner = await connectOwner(r, "alice", "Alice");
    const room = r.room("alice") as any;
    const bed = room.objects.home_in.find((o: any) => o.item === "bed_simple");
    const rect = objectRect(bed.item, bed.x, bed.y, bed.rotation);
    room.player.map = "home_in"; // the bed is inside the house
    room.player.entity.x = rect.x + rect.w + 0.5;
    room.player.entity.y = rect.y + rect.h - 0.5;
    const day = room.clock.day;
    await sendMsg(r, "alice", owner, { t: "sleep" });
    expect(owner.of("sleeping")).toEqual([]);
    expect(room.clock.day).toBe(day + 1);
    expect(sleepCountdownFor(0)).toBe(0);
    expect(sleepCountdownFor(3)).toBe(SLEEP_COUNTDOWN_MS);
  });
});
