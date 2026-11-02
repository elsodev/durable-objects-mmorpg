// The home's two maps (yard + house): sub-map rules, the furniture save migration, and door
// transitions on a real HomeRoom (owner, visitor and guest).
import { getMap } from "../src/shared/maps";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectOwner, createRooms, FakeCtx, installWorkersGlobals, sendMsg, wsRequest, type FakeWs, type Rooms } from "./do-harness";
import { HomeRoom } from "../src/worker/home";
import { H_GUEST, H_SESSION, H_SPAWN, H_USER_ID, H_USER_NAME, H_VISIT_OWNER, H_VISIT_RETURN, H_ZONE } from "../src/worker/env";
import { doorArrival, doorTarget, HOME_IN, HOME_OUT, resolveHomeArrival, SubMaps, emptyObjects } from "../src/worker/home/submaps";
import { BED_ID, ensureBed, HOME_LAYOUT, mapForItem, migrateObjects, validateObjects } from "../src/worker/home/migrate";
import { addNote, addParcel, emptyMail, takeParcels, unreadCount } from "../src/worker/home/mailbox";
import { HOME_DOOR } from "../src/shared/maps/home";
import { canPlace, canStand, dayIndex, farmNow, interiorTint, isFarmable, objectRect } from "../src/shared/engine";
import type { FarmTile, PlacedObject } from "../src/shared/types";
import { INVITE_TTL_MS } from "../src/shared/visits";

const T0 = 1_700_000_000_000;
const door = HOME_OUT.exits.find((e) => e.map === "home_in")!;
const doorIn = HOME_IN.exits[0]!;

describe("home maps", () => {
  it("the yard door leads inside and the inside door leads to the doorstep", () => {
    expect(doorTarget(door)).toBe("home_in");
    expect(doorTarget(doorIn)).toBe("home");
    expect(doorTarget(HOME_OUT.exits.find((e) => e.to === "village")!)).toBeNull();
    const grids = new SubMaps(emptyObjects());
    const inside = doorArrival("home_in", door.spawn, grids.grids.home_in);
    expect(inside).toEqual(HOME_IN.spawns.from_home);
    const out = doorArrival("home", doorIn.spawn, grids.grids.home);
    expect(out).toEqual({ x: HOME_DOOR.x + 0.5, y: HOME_DOOR.y + 2.5 });
    // Arriving is never on the door itself (no bouncing straight back).
    expect(Math.floor(out.y)).not.toBe(door.y);
    expect(canStand(grids.grids.home, door.x + 0.5, door.y + 0.5)).toBe(true);
  });

  it("a blocked arrival falls back to the map's default spawn", () => {
    const objects = emptyObjects();
    const s = HOME_IN.spawns.from_home!;
    objects.home_in.push({ id: "x", item: "table_wood", x: Math.floor(s.x) - 1, y: Math.floor(s.y), rotation: 0 });
    const grids = new SubMaps(objects);
    expect(doorArrival("home_in", "nope", grids.grids.home_in)).toEqual(HOME_IN.spawns.default);
  });

  it("reconnects resume the saved home map; a road arrival is always the yard", () => {
    const saved = { zone: "home" as const, x: 4.5, y: 6.5, homeMap: "home_in" as const };
    expect(resolveHomeArrival("default", saved, null, T0)).toEqual({ map: "home_in", at: { x: 4.5, y: 6.5 } });
    expect(resolveHomeArrival("default", { zone: "home", x: 4.5, y: 6.5 }, null, T0).map).toBe("home");
    const transfer = { to: "home" as const, spawn: "from_village", at: T0 };
    expect(resolveHomeArrival("from_village", saved, transfer, T0)).toEqual({ map: "home", at: HOME_OUT.spawns.from_village });
    expect(resolveHomeArrival("default", { zone: "village" }, null, T0)).toEqual({ map: "home", at: HOME_OUT.spawns.default });
  });

  it("indoor things go inside, yard things outside; placement agrees", () => {
    expect(mapForItem("chair_wood")).toBe("home_in");
    expect(mapForItem("bed_simple")).toBe("home_in");
    expect(mapForItem("fence")).toBe("home");
    expect(mapForItem("scarecrow")).toBe("home");
    expect(canPlace(HOME_IN, [], [], "chair_wood", 5, 6, 0).ok).toBe(true);
    expect(canPlace(HOME_IN, [], [], "fence", 5, 6, 0)).toEqual({ ok: false, reason: "This goes outdoors." });
    expect(canPlace(HOME_OUT, [], [], "chair_wood", 30, 20, 0)).toEqual({ ok: false, reason: "This goes indoors." });
    expect(canPlace(HOME_OUT, [], [], "fence", 30, 18, 0).ok).toBe(true);
  });

  it("any yard grass can be tilled, except the doorstep, road, house and exits", () => {
    expect(isFarmable(HOME_OUT, 3, 20)).toBe(true);
    expect(isFarmable(HOME_OUT, 25, 6)).toBe(true);
    expect(isFarmable(HOME_OUT, door.x, door.y)).toBe(false);
    expect(isFarmable(HOME_OUT, door.x, door.y + 1)).toBe(false);
    const mailbox = HOME_OUT.props.find((p) => p.id === "mailbox")!;
    expect(isFarmable(HOME_OUT, mailbox.x, mailbox.y + 1)).toBe(false);
    expect(isFarmable(HOME_OUT, 39, 12)).toBe(false);
    expect(isFarmable(HOME_IN, 5, 6)).toBe(false);
  });

  it("indoors is lit warm and dims at night without going blue", () => {
    expect(interiorTint(12 * 60)).toBe(0xffffff);
    const night = interiorTint(25 * 60);
    const r = night >> 16;
    const b = night & 255;
    expect(night).not.toBe(0xffffff);
    expect(r).toBeGreaterThan(b);
  });

});

describe("furniture migration", () => {
  const legacy: PlacedObject[] = [
    { id: "o1", item: "chair_wood", x: 6, y: 8, rotation: 0 },
    { id: BED_ID, item: "bed_simple", x: 4, y: 6, rotation: 0 },
    { id: "o2", item: "fence", x: 30, y: 18, rotation: 0 },
    // Where the house now stands: no longer valid in the yard.
    { id: "o3", item: "fence", x: 7, y: 9, rotation: 0 },
    { id: "o4", item: "lamp", x: 14, y: 14, rotation: 0 },
  ];

  it("moves floor furniture inside (keeping its place in the room), keeps yard things, returns the rest", () => {
    const { objects, returned } = migrateObjects(legacy, []);
    const byId = (id: string) => [...objects.home, ...objects.home_in].find((o) => o.id === id);
    expect(objects.home_in.map((o) => o.id).sort()).toEqual(["bed", "o1", "o4"]);
    expect(objects.home.map((o) => o.id)).toEqual(["o2"]);
    // Old cottage floor started at (3,5); the house floor at (1,3).
    expect(byId("o1")).toMatchObject({ x: 4, y: 6 });
    expect(byId(BED_ID)).toMatchObject({ x: 2, y: 4 });
    expect(returned).toEqual(["fence"]);
    // Everything that stayed is valid where it is.
    expect(validateObjects(objects, []).returned).toEqual([]);
    expect(migrateObjects(legacy, [])).toEqual({ objects, returned }); // deterministic
  });

  it("finds another spot inside when the old one is taken, and hands back what can't fit", () => {
    const tables: PlacedObject[] = Array.from({ length: 80 }, (_, i) => ({ id: `t${i}`, item: "table_wood", x: 3, y: 5, rotation: 0 }));
    const { objects, returned } = migrateObjects([{ id: BED_ID, item: "bed_simple", x: 4, y: 6, rotation: 0 }, ...tables], []);
    expect(objects.home_in.some((o) => o.id === BED_ID)).toBe(true);
    expect(objects.home_in.length).toBeGreaterThan(10);
    expect(returned.length).toBe(81 - objects.home_in.length);
    expect(returned.every((i) => i === "table_wood")).toBe(true);
    expect(validateObjects(objects, []).returned).toEqual([]);
  });

  it("keeps yard things off farm tiles", () => {
    const farm: FarmTile[] = [{ x: 30, y: 18, crop: null, plantedAt: null, wateredDays: 0, lastWateredDay: null }];
    expect(migrateObjects([legacy[2]!], farm).returned).toEqual(["fence"]);
  });

  it("every home ends up with a bed inside", () => {
    const objects = emptyObjects();
    objects.home.push({ id: BED_ID, item: "bed_simple", x: 30, y: 18, rotation: 0 });
    expect(ensureBed(objects)).toBe(true);
    expect(objects.home).toEqual([]);
    expect(objects.home_in).toEqual([{ id: BED_ID, item: "bed_simple", x: 2, y: 3, rotation: 0 }]);
    expect(ensureBed(objects)).toBe(false);
  });
});

describe("mailbox", () => {
  it("counts letters and invites since the last look, and parcels until taken", () => {
    const mail = emptyMail();
    addNote(mail, "hello", T0);
    const invite = { fromId: "b", fromName: "Basil", expiresAt: T0 + INVITE_TTL_MS };
    expect(unreadCount(mail, [invite])).toBe(2);
    mail.readAt = T0 + 1;
    expect(unreadCount(mail, [invite])).toBe(0);
    addParcel(mail, "chair_wood");
    addParcel(mail, "chair_wood");
    expect(unreadCount(mail, [])).toBe(1);
    const inv = { coins: 0, slots: [] };
    expect(takeParcels(mail, inv)).toEqual([{ item: "chair_wood", qty: 2 }]);
    expect(mail.parcels).toEqual([]);
    expect(inv.slots).toEqual([{ item: "chair_wood", qty: 2 }]);
  });

});

// ------------------------------------------------------------------ HomeRoom

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

let active: any = null;
/** Puts someone on a door tile and lets one tick run (an idle home has stopped ticking). */
async function stepOnto(who: { entity: { x: number; y: number } }, exit: { x: number; y: number }): Promise<void> {
  who.entity.x = exit.x + 0.5;
  who.entity.y = exit.y + 0.5;
  // Through the harness proxy: resolves once the room has run it.
  await active?.startTick();
  vi.advanceTimersByTime(150);
}

async function visitor(room: any, owner: string, userId: string, name: string): Promise<FakeWs> {
  await room.createInvite(owner, owner, { id: userId, name });
  const res = await room.fetch(
    wsRequest("http://localhost:8787/ws/visit/" + owner, {
      [H_USER_ID]: userId,
      [H_USER_NAME]: name,
      [H_ZONE]: "home",
      [H_SPAWN]: "default",
      [H_GUEST]: "0",
      [H_SESSION]: `s-${userId}`,
      [H_VISIT_OWNER]: owner,
      [H_VISIT_RETURN]: "village",
    }),
  );
  expect(res.status).toBe(101);
  return r.ctx(owner).sockets.at(-1)!;
}

describe("HomeRoom door transitions", () => {
  it("welcome is the yard (farm, bin, mailbox flag); the door loads the house on the same socket and back", async () => {
    const ws = await connectOwner(r, "alice", "Alice");
    const room = (active = r.room("alice") as any);
    const w0 = ws.last("welcome");
    expect(w0.homeMap).toBe("home");
    expect(ws.last("mail")).toMatchObject({ unread: 1 }); // the welcome letter
    room.farm.push({ x: 25, y: 6, crop: null, plantedAt: null, wateredDays: 0, lastWateredDay: null });

    ws.sent = [];
    await stepOnto(room.player, door);
    expect(ws.closed).toBeNull();
    const w1 = ws.last("welcome");
    expect(w1).toMatchObject({ zone: "home", homeMap: "home_in", farm: [], brokenRocks: [] });
    expect(w1.objects.map((o: any) => o.id)).toContain(BED_ID);
    expect(room.player.map).toBe("home_in");
    expect(room.player.entity).toMatchObject(HOME_IN.spawns.from_home);
    expect(ws.of("zone")).toEqual([]);
    expect(ws.deserializeAttachment()).toMatchObject({ homeMap: "home_in" });

    ws.sent = [];
    await stepOnto(room.player, doorIn);
    const w2 = ws.last("welcome");
    expect(w2.homeMap).toBe("home");
    expect(w2.farm).toHaveLength(1);
    expect(w2.objects.some((o: any) => o.id === BED_ID)).toBe(false);
    expect(room.player.entity).toMatchObject({ x: HOME_DOOR.x + 0.5, y: HOME_DOOR.y + 2.5 });
  });

  it("sleeps only inside by the bed; passing out in the yard wakes you inside", async () => {
    const ws = await connectOwner(r, "alice", "Alice");
    const room = (active = r.room("alice") as any);
    const day = room.clock.day;
    await sendMsg(r, "alice", ws, { t: "sleep" });
    expect(ws.last("reject").reason).toMatch(/Walk up to your bed/);
    await stepOnto(room.player, door);
    const bed = room.objects.home_in.find((o: any) => o.id === BED_ID);
    const rect = objectRect(bed.item, bed.x, bed.y, bed.rotation);
    room.player.entity.x = rect.x + rect.w + 0.5;
    room.player.entity.y = rect.y + rect.h - 0.5;
    await sendMsg(r, "alice", ws, { t: "sleep" });
    expect(room.clock.day).toBe(day + 1);

    await stepOnto(room.player, doorIn);
    expect(room.player.map).toBe("home");
    ws.sent = [];
    await room.endDay("passout", Date.now());
    expect(room.player.map).toBe("home_in");
    expect(ws.last("welcome").homeMap).toBe("home_in");
    expect(ws.of("farmAll")).toEqual([]); // the farm isn't drawn on the house floor
  });

  it("furniture is per map: floor items inside only, tools do nothing inside", async () => {
    const ws = await connectOwner(r, "alice", "Alice");
    const room = (active = r.room("alice") as any);
    room.save.inventory.slots[10] = { item: "chair_wood", qty: 2 };
    room.save.inventory.slots[11] = { item: "fence", qty: 2 };
    await sendMsg(r, "alice", ws, { t: "place", slot: 10, x: 4, y: 14, rotation: 0 });
    expect(ws.last("reject").reason).toBe("This goes indoors.");
    vi.advanceTimersByTime(250);
    await sendMsg(r, "alice", ws, { t: "place", slot: 11, x: 4, y: 14, rotation: 0 });
    expect(room.objects.home.map((o: any) => o.item)).toEqual(["fence"]);
    await stepOnto(room.player, door);
    vi.advanceTimersByTime(250);
    ws.sent = [];
    await sendMsg(r, "alice", ws, { t: "place", slot: 10, x: 6, y: 6, rotation: 0 });
    expect(room.objects.home_in.some((o: any) => o.item === "chair_wood")).toBe(true);
    expect(ws.last("objects").upd[0]).toMatchObject({ item: "chair_wood", x: 6, y: 6 });
    vi.advanceTimersByTime(250);
    // Moving the yard fence from inside: not on this map.
    const fence = room.objects.home[0];
    await sendMsg(r, "alice", ws, { t: "moveObject", id: fence.id, x: 7, y: 7, rotation: 0 });
    expect(ws.last("reject").reason).toBe("That isn't here any more.");
    vi.advanceTimersByTime(250);
    await sendMsg(r, "alice", ws, { t: "use", slot: 0, x: 9, y: 8 });
    expect(ws.last("reject").reason).toBe("Nothing to do here.");
    expect(room.farm).toEqual([]);
  });

  it("ticks are per map: yard and house only see their own people", async () => {
    const owner = await connectOwner(r, "alice", "Alice");
    const room = (active = r.room("alice") as any);
    const guest = await visitor(room, "alice", "basil", "Basil");
    expect(guest.last("welcome").entities.map((e: any) => e.id).sort()).toEqual(["p:alice", "p:basil"]);
    vi.advanceTimersByTime(150);
    await stepOnto(room.player, door);
    vi.advanceTimersByTime(150);
    // Alice left the yard: Basil's ticks drop her; Alice inside sees only herself.
    expect(guest.of("tick").some((t: any) => t.del.includes("p:alice"))).toBe(true);
    expect(owner.last("welcome").entities.map((e: any) => e.id)).toEqual(["p:alice"]);
    owner.sent = [];
    room.visitors.byUser("basil").entity.x += 1;
    vi.advanceTimersByTime(150);
    expect(owner.of("tick").flatMap((t: any) => t.upd.map((e: any) => e.id))).not.toContain("p:basil");
  });

  it("a visitor can go inside (no harvesting there) and harvest outside", async () => {
    await connectOwner(r, "alice", "Alice");
    const room = (active = r.room("alice") as any);
    const guest = await visitor(room, "alice", "basil", "Basil");
    const v = room.visitors.byUser("basil");
    room.clock = { day: 5, startAt: Date.now() };
    const ripe = { x: HOME_DOOR.x + 3, y: HOME_DOOR.y + 4, crop: "turnip", plantedAt: farmNow(1), wateredDays: 9, lastWateredDay: dayIndex(farmNow(1)) };
    room.farm.push(ripe);
    await stepOnto(v, door);
    expect(v.map).toBe("home_in");
    expect(guest.last("welcome")).toMatchObject({ homeMap: "home_in", visit: { ownerId: "alice" } });
    expect(guest.closed).toBeNull();
    await sendMsg(r, "alice", guest, { t: "use", slot: 0, x: 6, y: 9 });
    expect(guest.last("reject").reason).toMatch(/Crops grow outside/);
    await stepOnto(v, doorIn);
    expect(v.map).toBe("home");
    v.entity.x = ripe.x + 0.5;
    v.entity.y = ripe.y - 0.5;
    vi.advanceTimersByTime(250);
    await sendMsg(r, "alice", guest, { t: "use", slot: 0, x: ripe.x, y: ripe.y });
    expect(ripe.crop).toBeNull();
    // The road out still ends the visit.
    await stepOnto(v, { x: 39, y: 12 });
    expect(guest.last("zone")).toEqual({ t: "zone", to: "village", spawn: "default" });
  });

  it("guests roam both maps but can't leave home", async () => {
    const ws = await connectOwner(r, "gus", "Gus", { guest: true });
    const room = (active = r.room("gus") as any);
    await stepOnto(room.player, door);
    expect(room.player.map).toBe("home_in");
    await stepOnto(room.player, doorIn);
    expect(room.player.map).toBe("home");
    await stepOnto(room.player, { x: 39, y: 12 });
    expect(ws.last("needAccount")).toBeDefined();
    expect(ws.closed).toBeNull();
  });

  it("mailbox: interact opens it and marks it read; parcels go to the bag", async () => {
    const ws = await connectOwner(r, "alice", "Alice");
    const room = (active = r.room("alice") as any);
    const box = HOME_OUT.props.find((p) => p.id === "mailbox")!;
    room.player.entity.x = box.x + 0.5;
    room.player.entity.y = box.y + 1.5;
    addParcel(room.mail, "lamp");
    await sendMsg(r, "alice", ws, { t: "interact", target: "mailbox" });
    expect(ws.last("mail")).toMatchObject({ open: true, unread: 1, parcels: [{ item: "lamp", qty: 1 }] });
    await sendMsg(r, "alice", ws, { t: "interact", target: "mailbox:take" });
    expect(ws.last("mail")).toMatchObject({ unread: 0, parcels: [] });
    expect(room.save.inventory.slots.some((s: any) => s?.item === "lamp")).toBe(true);
    // From inside the house the mailbox is out of reach.
    await stepOnto(room.player, door);
    ws.sent = [];
    await sendMsg(r, "alice", ws, { t: "interact", target: "mailbox" });
    expect(ws.of("mail")).toEqual([]);
  });

  it("a hibernated home puts the owner back on the map their socket was on", async () => {
    const ws = await connectOwner(r, "alice", "Alice");
    const room = (active = r.room("alice") as any);
    await stepOnto(room.player, door);
    const ctx = r.ctx("alice");
    const woken = new HomeRoom(ctx as any, r.env) as any;
    await ctx.ready;
    expect(woken.player.ws).toBe(ws);
    expect(woken.player.map).toBe("home_in");
  });

  it("fast travel saves the destination and the hand-off before sending the zone switch", async () => {
    const ws = await connectOwner(r, "alice", "Alice");
    const room = (active = r.room("alice") as any);
    await sendMsg(r, "alice", ws, { t: "travel", to: "home" });
    expect(ws.last("notice").text).toMatch(/already here/);
    expect(ws.closed).toBeNull();
    await sendMsg(r, "alice", ws, { t: "travel", to: "caves" });
    expect(ws.last("zone")).toEqual({ t: "zone", to: "caves", spawn: "default" });
    const saved = r.ctx("alice").storage.data.get("save") as { zone: string; x: number; y: number };
    expect(saved.zone).toBe("caves");
    expect([saved.x, saved.y]).toEqual([getMap("caves").spawns.default!.x, getMap("caves").spawns.default!.y]);
    expect(r.ctx("alice").storage.data.get("transfer")).toMatchObject({ to: "caves", spawn: "default" });
    expect(room.player).toBeNull();
  });
});

describe("HomeRoom save migration", () => {
  it("splits an old save's furniture between yard and house once, with a letter", async () => {
    installWorkersGlobals();
    const ctx = new FakeCtx();
    const save = { userId: "olga", name: "Olga", inventory: { coins: 5, slots: [] }, hp: 100, maxHp: 100, sprite: "ninja_blue", zone: "home", x: 8.5, y: 10.5 };
    ctx.storage.data.set("owner", "olga");
    ctx.storage.data.set("save", save);
    ctx.storage.data.set("objects", [
      { id: BED_ID, item: "bed_simple", x: 4, y: 6, rotation: 0 },
      { id: "o1", item: "chair_wood", x: 6, y: 8, rotation: 0 },
      { id: "o2", item: "fence", x: 7, y: 9, rotation: 0 },
    ]);
    ctx.storage.data.set("objSeq", 2);
    const room = new HomeRoom(ctx as any, r.env) as any;
    await ctx.ready;
    expect(room.objects.home_in.map((o: any) => o.id).sort()).toEqual(["bed", "o1"]);
    expect(room.objects.home).toEqual([]);
    expect(room.save.inventory.slots.filter(Boolean)).toEqual([{ item: "fence", qty: 1 }]);
    expect(room.mail.notes.at(-1).text).toMatch(/moved into your new house.*Fence/);
    expect(ctx.storage.data.get("layout")).toBe(HOME_LAYOUT);
    expect((ctx.storage.data.get("homeObjects") as any).home_in).toHaveLength(2);

    // Loading again does not migrate twice.
    const again = new HomeRoom(ctx as any, r.env) as any;
    await ctx.ready;
    expect(again.save.inventory.slots.filter(Boolean)).toEqual([{ item: "fence", qty: 1 }]);
    expect(again.objects.home_in).toHaveLength(2);
    expect(again.mail.notes).toHaveLength(1);
  });

  it("guest upgrade export/import keeps both maps", async () => {
    const ws = await connectOwner(r, "alice", "Alice");
    const room = (active = r.room("alice") as any);
    void ws;
    room.objects.home_in.push({ id: "o9", item: "lamp", x: 8, y: 5, rotation: 0 });
    const data = await room.exportHome("alice");
    expect(data.objectsIn.map((o: any) => o.id).sort()).toEqual(["bed", "o9"]);
    const target = r.room("bob") as any;
    await target.importHome("bob", "Bob", data);
    expect(target.objects.home_in.map((o: any) => o.id).sort()).toEqual(["bed", "o9"]);
    // An old export (one list, old layout) is migrated on import.
    const old = { ...data, objects: [{ id: "o1", item: "lamp", x: 6, y: 8, rotation: 0 }] };
    delete old.objectsIn;
    const t2 = r.room("cleo") as any;
    await t2.importHome("cleo", "Cleo", old);
    expect(t2.objects.home_in.map((o: any) => o.id).sort()).toEqual(["bed", "o1"]);
  });
});
