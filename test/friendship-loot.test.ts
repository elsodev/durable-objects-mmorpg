import { describe, expect, it } from "vitest";
import {
  bondView,
  dueMilestones,
  GIFT_MILESTONES,
  GIFTS_PER_DAY,
  giftGain,
  heartCurve,
  heartsFor,
  MAX_HEARTS,
  MAX_PENDING,
  maxPoints,
  newBond,
  sanitizeBonds,
  talkGain,
  TALK_COOLDOWN_MS,
  TALK_DAILY_CAP,
  TALK_FIRST_PTS,
  TALK_MORE_PTS,
} from "../src/shared/hearts";
import { allowedRotations, getItem, ITEMS, normalizeRotation, stepRotation } from "../src/shared/items";
import { canPlace, footprint, wallFaceRow } from "../src/shared/engine";
import { NPC_IDS } from "../src/worker/npc/bible";
import { weekOf } from "../src/shared/calendar";
import { GIFT_TABLES, giftProfile, rarityOf, rollMilestoneGift } from "../src/worker/npc/giftTables";
import { bondGift, bondList, bondTalk } from "../src/worker/game/bonds";
import { CHEST_COINS, CHEST_FURNITURE, CHEST_RESPAWN_MS, ChestField, rollChestLoot } from "../src/worker/game/chestField";
import { buildCollision, isBlocked } from "../src/shared/engine";
import { getMap } from "../src/shared/maps";
import { Ground, type Inventory, type PlacedObject } from "../src/shared/types";
import { makeMap, rng } from "./engine-fixtures";
import { mapForItem } from "../src/worker/home/migrate";
import catalog from "../src/client/public/assets/lpc/catalog.json";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 1, 9);

describe("heart curves (seeded per villager)", () => {
  it("is deterministic, rising, and differs between villagers", () => {
    for (const id of NPC_IDS) {
      const c = heartCurve(id);
      expect(c.at).toHaveLength(MAX_HEARTS + 1);
      expect(c.at[0]).toBe(0);
      for (let h = 1; h <= MAX_HEARTS; h++) expect(c.at[h]!).toBeGreaterThan(c.at[h - 1]!);
      expect(heartCurve(id)).toEqual(c);
      expect(c.base).toBeGreaterThanOrEqual(50);
      expect(c.base).toBeLessThanOrEqual(150);
    }
    const totals = new Set(NPC_IDS.map((id) => maxPoints(id)));
    expect(totals.size).toBeGreaterThan(NPC_IDS.length / 2);
    // Some warm up clearly faster than others.
    const firsts = NPC_IDS.map((id) => heartCurve(id).at[1]!);
    expect(Math.max(...firsts) - Math.min(...firsts)).toBeGreaterThan(30);
  });

  it("maps points to hearts and progress", () => {
    const at = heartCurve("rue").at;
    expect(heartsFor("rue", 0)).toEqual({ hearts: 0, into: 0, need: at[1] });
    expect(heartsFor("rue", at[1]! - 1).hearts).toBe(0);
    expect(heartsFor("rue", at[3]! + 5)).toEqual({ hearts: 3, into: 5, need: at[4]! - at[3]! });
    expect(heartsFor("rue", at[MAX_HEARTS]!)).toEqual({ hearts: MAX_HEARTS, into: 0, need: 0 });
    expect(heartsFor("rue", at[MAX_HEARTS]! * 2).hearts).toBe(MAX_HEARTS);
  });
});

describe("talking: daily cap and cooldown", () => {
  it("first chat of the day is worth most, later ones less, with a cooldown", () => {
    const b = newBond();
    expect(talkGain("bram", b, T0)).toBe(TALK_FIRST_PTS);
    expect(talkGain("bram", b, T0 + 1000)).toBe(0); // cooldown
    expect(talkGain("bram", b, T0 + TALK_COOLDOWN_MS)).toBe(TALK_MORE_PTS);
  });

  it("caps talk points per villager per day, and resets the next day", () => {
    const b = newBond();
    let total = 0;
    for (let i = 0; i < 50; i++) total += talkGain("pip", b, T0 + i * TALK_COOLDOWN_MS);
    expect(total).toBe(TALK_DAILY_CAP);
    expect(bondView("pip", "Pip", b, T0 + 50 * TALK_COOLDOWN_MS).talkLeft).toBe(0);
    expect(talkGain("pip", b, T0 + DAY)).toBe(TALK_FIRST_PTS);
    // The cap is per villager: another one still gives full points.
    expect(talkGain("rue", newBond(), T0)).toBe(TALK_FIRST_PTS);
  });

  it("never passes the curve's maximum", () => {
    const b = newBond();
    b.pts = maxPoints("iris") - 3;
    expect(talkGain("iris", b, T0)).toBe(3);
    expect(b.pts).toBe(maxPoints("iris"));
  });
});

describe("gifts to villagers", () => {
  it("scores by taste, one a day, never below zero", () => {
    const b = newBond();
    expect(giftGain("grumm", b, "loved", T0)).toBe(80);
    expect(GIFTS_PER_DAY).toBe(1);
    expect(giftGain("grumm", b, "loved", T0)).toBe(0); // second gift today
    expect(giftGain("grumm", b, "disliked", T0 + DAY)).toBe(-25);
    const c = newBond();
    expect(giftGain("grumm", c, "hated", T0)).toBe(0);
    expect(c.pts).toBe(0);
  });
});

describe("milestone furniture gifts", () => {
  it("tables only hold placeable furniture with art", () => {
    const cat = catalog as unknown as { furniture: Record<string, unknown>; props: Record<string, unknown> };
    for (const id of NPC_IDS) {
      expect(GIFT_TABLES[id].length).toBeGreaterThanOrEqual(4);
      for (const item of GIFT_TABLES[id]) {
        const def = getItem(item);
        expect(def?.kind, item).toBe("furniture");
        expect(def?.footprint, item).toBeTruthy();
        expect(item in cat.furniture || item in cat.props, `${item} has art`).toBe(true);
      }
    }
  });

  it("profiles are seeded: same villager, same odds; odds rise; the last milestone always gives", () => {
    for (const id of NPC_IDS) {
      const p = giftProfile(id);
      expect(giftProfile(id)).toBe(p);
      expect(p.chance).toHaveLength(GIFT_MILESTONES.length);
      for (let i = 1; i < p.chance.length; i++) expect(p.chance[i]!).toBeGreaterThanOrEqual(p.chance[i - 1]!);
      expect(p.chance[0]!).toBeGreaterThanOrEqual(0.35);
      expect(p.chance.at(-1)).toBe(1);
    }
    expect(new Set(NPC_IDS.map((id) => giftProfile(id).chance[0])).size).toBeGreaterThan(1);
  });

  it("rolls from the villager's own table, leaning rare at high hearts and avoiding repeats", () => {
    const r = rng(7);
    const tally = (m: number, given: string[] = []) => {
      const out = new Map<string, number>();
      for (let i = 0; i < 4000; i++) {
        const item = rollMilestoneGift("fenwick", m, { given }, r);
        if (item) out.set(item, (out.get(item) ?? 0) + 1);
      }
      return out;
    };
    const low = tally(2);
    const high = tally(10);
    for (const item of [...low.keys(), ...high.keys()]) expect(GIFT_TABLES.fenwick).toContain(item);
    const rareShare = (t: Map<string, number>) => {
      let rare = 0;
      let all = 0;
      for (const [item, n] of t) {
        all += n;
        if (rarityOf(item) === "rare") rare += n;
      }
      return rare / all;
    };
    expect(rareShare(high)).toBeGreaterThan(rareShare(low));
    expect([...high.values()].reduce((a, b) => a + b, 0)).toBe(4000); // heart 10 always gives
    const fresh = tally(10, []);
    const repeat = tally(10, ["smith_anvil"]);
    expect(repeat.get("smith_anvil") ?? 0).toBeLessThan(fresh.get("smith_anvil") ?? 0);
  });

  it("delivers milestone gifts to the bag, or keeps them for later when it is full", () => {
    const bonds = {};
    const inv: Inventory = { coins: 0, slots: [] };
    // Max points in one go: every milestone is due at once.
    let delivered: string[] = [];
    const r = rng(3);
    const b0 = bondTalk(bonds, "rue", inv, T0, r)!;
    expect(b0.delta).toBe(TALK_FIRST_PTS);
    (bonds as Record<string, { pts: number }>).rue!.pts = maxPoints("rue") - 1;
    const out = bondTalk(bonds, "rue", inv, T0 + TALK_COOLDOWN_MS, r)!;
    delivered = out.delivered;
    expect(out.heartsAfter).toBe(MAX_HEARTS);
    expect(delivered.length).toBeGreaterThanOrEqual(1);
    for (const item of delivered) expect(inv.slots.some((s) => s?.item === item)).toBe(true);
    expect((bonds as Record<string, { milestones: number[] }>).rue!.milestones.sort((a, b) => a - b)).toEqual([...GIFT_MILESTONES]);

    // A full bag: the gift waits with the villager and comes on the next talk once there's room.
    const full: Inventory = { coins: 0, slots: Array.from({ length: 24 }, () => ({ item: "stone", qty: 99 })) };
    const fb = {};
    bondTalk(fb, "tess", full, T0, r);
    (fb as Record<string, { pts: number }>).tess!.pts = maxPoints("tess");
    const owed = bondTalk(fb, "tess", full, T0 + TALK_COOLDOWN_MS, r)!;
    expect(owed.delivered).toEqual([]);
    expect(owed.owed.length).toBeGreaterThanOrEqual(1);
    expect(owed.view.pending).toBe(owed.owed.length);
    full.slots.pop();
    const later = bondTalk(fb, "tess", full, T0 + 2 * TALK_COOLDOWN_MS, r)!;
    expect(later.delivered).toHaveLength(1);
    expect(later.owed).toEqual([]);
    expect(MAX_PENDING).toBeGreaterThanOrEqual(GIFT_MILESTONES.length);
  });

  it("ignores non-villagers and lists villagers met, warmest first", () => {
    const bonds = {};
    const inv: Inventory = { coins: 0, slots: [] };
    expect(bondTalk(bonds, "not_an_npc", inv, T0, rng(1))).toBeNull();
    bondTalk(bonds, "pip", inv, T0, rng(1));
    bondGift(bonds, "odette", "loved", inv, T0, rng(1));
    expect(bondList(bonds, T0).map((v) => v.npc)).toEqual(["odette", "pip"]);
  });

  it("sanitizes bonds from storage", () => {
    const got = sanitizeBonds({
      rue: { pts: 1e12, day: "2026-11-01", talkPts: 999, gifts: -3, lastTalk: "x", milestones: [2, 3, 2, 10], given: ["barrel", "turnip", 5], pending: ["candle"] },
      "Bad Key": { pts: 5 },
      __proto__: { pts: 5 },
    });
    expect(Object.keys(got)).toEqual(["rue"]);
    // Old saves keyed the day as a UTC date string: it becomes the world day index.
    const day = Math.floor(Date.UTC(2026, 10, 1) / 86_400_000);
    expect(got.rue).toEqual({
      pts: maxPoints("rue"),
      day,
      talkPts: TALK_DAILY_CAP,
      gifts: 0,
      talked: true,
      week: weekOf(day),
      weekGifts: 0,
      lastTalk: 0,
      milestones: [2, 10],
      given: ["barrel"],
      pending: ["candle"],
    });
    expect(sanitizeBonds(null)).toEqual({});
    expect(dueMilestones(got.rue!, 6)).toEqual([4, 6]);
  });
});

describe("cave chests", () => {
  it("loot is coins plus ore, gems or (rarely) furniture", () => {
    const r = rng(11);
    let furniture = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const loot = rollChestLoot(r);
      expect(loot.coins).toBeGreaterThanOrEqual(CHEST_COINS.min);
      expect(loot.coins).toBeLessThanOrEqual(CHEST_COINS.max);
      expect(loot.items.length).toBeGreaterThanOrEqual(1);
      for (const d of loot.items) {
        const def = getItem(d.item);
        expect(def, d.item).toBeTruthy();
        expect(["ore", "gem", "furniture"]).toContain(def!.kind);
        if (def!.kind === "furniture") furniture++;
      }
    }
    expect(furniture).toBeGreaterThan(0);
    expect(furniture / N).toBeLessThan(0.15);
    for (const f of CHEST_FURNITURE) expect(getItem(f.value)?.kind).toBe("furniture");
  });

  const caves = getMap("caves");

  it("spawn on open cave floor, blocking their tile, never plugging a tunnel", () => {
    const grid = buildCollision(caves);
    const field = new ChestField(caves, 4);
    field.load(undefined, grid, rng(5));
    expect(field.chests).toHaveLength(4);
    for (const c of field.chests) {
      expect(caves.ground[c.y * caves.width + c.x]).toBe(Ground.Stone);
      expect(isBlocked(grid, c.x, c.y)).toBe(true);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(isBlocked(grid, c.x + dx, c.y + dy)).toBe(false);
    }
    const ids = new Set(field.chests.map((c) => `${c.x},${c.y}`));
    expect(ids.size).toBe(4);
  });

  it("opens once per player per spawn, then respawns elsewhere for everyone", () => {
    const grid = buildCollision(caves);
    const field = new ChestField(caves, 2);
    field.load(undefined, grid, rng(9));
    const c = field.chests[0]!;
    const before = { x: c.x, y: c.y };
    expect(field.open(c, "u1", T0)).toBe(true);
    expect(field.open(c, "u1", T0 + 1)).toBe(false);
    expect(field.open(c, "u2", T0 + 2)).toBe(true);
    expect(field.views("u1").find((v) => v.id === c.id)?.opened).toBe(true);
    expect(field.views("u3").find((v) => v.id === c.id)?.opened).toBe(false);
    expect(field.respawnDue(grid, T0 + CHEST_RESPAWN_MS - 1, [], rng(1))).toBe(false);
    expect(field.respawnDue(grid, T0 + CHEST_RESPAWN_MS, [], rng(1))).toBe(true);
    expect(c.gen).toBe(1);
    expect(c.openedBy).toEqual([]);
    expect(`${c.x},${c.y}`).not.toBe(`${before.x},${before.y}`);
    expect(isBlocked(grid, before.x, before.y)).toBe(false);
    expect(isBlocked(grid, c.x, c.y)).toBe(true);
    expect(field.open(c, "u1", T0 + CHEST_RESPAWN_MS + 1)).toBe(true);
    // The untouched chest stays put.
    expect(field.chests[1]!.gen).toBe(0);
  });

  it("restores stored chests (who opened them, timers) and replaces bad entries", () => {
    const grid = buildCollision(caves);
    const field = new ChestField(caves, 2);
    field.load(undefined, grid, rng(2));
    field.open(field.chests[0]!, "u1", T0);
    const saved = JSON.parse(JSON.stringify(field.record()));
    saved[1] = { id: "chest1", x: 0, y: 0, gen: 0, openedBy: [] }; // inside the rock wall
    const again = new ChestField(caves, 2);
    const grid2 = buildCollision(caves);
    again.load(saved, grid2, rng(3));
    expect(again.chests[0]).toEqual(field.chests[0]);
    expect(again.chests[1]!.x === 0 && again.chests[1]!.y === 0).toBe(false);
  });
});

describe("furniture rotation and placement", () => {
  // Rows 0-2: north wall (a window piece over column 3), rows 3-4: floor, row 5: south wall.
  const room = makeMap(["##########", "##########", "##########", "#wwwwwwww#", "#wwwwwwww#", "####w#####"], {
    floorArea: [{ x: 1, y: 3, w: 8, h: 2 }],
    props: [
      { id: "wall_2", type: "iwall_plaster_plain", x: 2, y: 0, w: 1, h: 3 },
      { id: "wall_3", type: "iwall_plaster_window", x: 3, y: 0, w: 1, h: 3 },
    ],
    // No doorway here: the doorway margin has its own tests in engine-placement.
    spawns: {},
    exits: [],
  });
  const none: PlacedObject[] = [];

  it("every furniture item lists only rotations it has art for", () => {
    for (const def of Object.values(ITEMS)) {
      if (def.kind !== "furniture") continue;
      const rots = allowedRotations(def.id);
      expect(rots[0], def.id).toBe(0);
      if (def.placeOn === "wall") expect(rots).toEqual([0]);
      // A mirror image (3 without 1) only for 1x1 pieces, where the footprint doesn't change.
      if (rots.includes(3) && !rots.includes(1)) expect(def.footprint).toEqual({ w: 1, h: 1 });
    }
    expect(allowedRotations("wardrobe")).toEqual([0]);
    expect(allowedRotations("chair_wood")).toEqual([0, 1, 2, 3]);
    expect(stepRotation("table_wood", 0)).toBe(1);
    expect(stepRotation("table_wood", 1)).toBe(0);
    expect(stepRotation("chair_wood", 0, -1)).toBe(3);
    expect(stepRotation("grindstone", 0)).toBe(3);
    expect(stepRotation("wardrobe", 0)).toBe(0);
    expect(normalizeRotation("table_wood", 3)).toBe(1);
    expect(normalizeRotation("table_wood", 2)).toBe(0);
    expect(normalizeRotation("wardrobe", 1)).toBe(0);
  });

  it("rotation swaps the footprint, and canPlace checks the swapped one", () => {
    expect(footprint("workbench", 0)).toEqual({ w: 3, h: 1 });
    expect(footprint("table_wood", 1)).toEqual({ w: 1, h: 2 });
    // At the east wall a 2x1 table pokes into the wall; turned 1x2 it fits.
    expect(canPlace(room, none, [], "table_wood", 8, 3, 0).ok).toBe(false);
    expect(canPlace(room, none, [], "table_wood", 8, 3, 1)).toEqual({ ok: true });
    // Turned, it runs down into the south wall from row 4.
    expect(canPlace(room, none, [], "table_wood", 2, 4, 1).ok).toBe(false);
    expect(canPlace(room, none, [], "table_wood", 2, 4, 0)).toEqual({ ok: true });
  });

  it("refuses rotations without art, out-of-map tiles, overlaps and people", () => {
    expect(canPlace(room, none, [], "wardrobe", 2, 3, 1)).toEqual({ ok: false, reason: "It doesn't turn that way." });
    expect(canPlace(room, none, [], "wardrobe", 2, 3, 0)).toEqual({ ok: true });
    expect(canPlace(room, none, [], "barrel", -1, 3, 0)).toEqual({ ok: false, reason: "Out of bounds." });
    expect(canPlace(room, none, [], "workbench", 8, 4, 0)).toEqual({ ok: false, reason: "Out of bounds." });
    const bench: PlacedObject[] = [{ id: "o1", item: "workbench", x: 2, y: 3, rotation: 0 }];
    expect(canPlace(room, bench, [], "table_wood", 4, 2, 1).ok).toBe(false);
    expect(canPlace(room, bench, [], "barrel", 3, 3, 0)).toEqual({ ok: false, reason: "Overlaps other furniture." });
    expect(canPlace(room, none, [], "barrel", 6, 4, 0, { occupied: [{ x: 6.5, y: 4.6 }] })).toEqual({ ok: false, reason: "Someone is standing there." });
    // Moving an object ignores itself.
    expect(canPlace(room, bench, [], "workbench", 3, 3, 0, { ignoreId: "o1" })).toEqual({ ok: true });
  });

  it("wall pieces hang only on the wall facing the room", () => {
    expect(wallFaceRow(room, 2, 1)).toBe(3);
    expect(wallFaceRow(room, 2, 2)).toBe(3);
    expect(wallFaceRow(room, 2, 0)).toBeNull(); // too high
    expect(wallFaceRow(room, 0, 3)).toBeNull(); // side wall
    expect(wallFaceRow(room, 5, 5)).toBeNull(); // south wall
    expect(canPlace(room, none, [], "painting_portrait", 2, 1, 0)).toEqual({ ok: true });
    expect(canPlace(room, none, [], "painting_portrait", 2, 2, 0)).toEqual({ ok: true });
    expect(canPlace(room, none, [], "painting_portrait", 2, 0, 0).ok).toBe(false);
    expect(canPlace(room, none, [], "painting_portrait", 5, 3, 0).ok).toBe(false); // floor
    expect(canPlace(room, none, [], "painting_portrait", 0, 2, 0).ok).toBe(false); // corner
    expect(canPlace(room, none, [], "painting_portrait", 3, 1, 0)).toEqual({ ok: false, reason: "Something is in the way." }); // window
    expect(canPlace(room, none, [], "painting_landscape", 8, 1, 0).ok).toBe(false); // half over the side wall
    expect(canPlace(room, none, [], "painting_landscape", 6, 1, 0)).toEqual({ ok: true });
    expect(canPlace(room, none, [], "painting_portrait", 2, 1, 1)).toEqual({ ok: false, reason: "It doesn't turn that way." });
    const hung: PlacedObject[] = [{ id: "p", item: "painting_landscape", x: 6, y: 1, rotation: 0 }];
    expect(canPlace(room, hung, [], "mirror", 7, 1, 0)).toEqual({ ok: false, reason: "Overlaps something on the wall." });
    // A floor piece below a painting is fine (they're on different tiles).
    expect(canPlace(room, hung, [], "barrel", 6, 3, 0)).toEqual({ ok: true });
    // Floor pieces never go on the wall.
    expect(canPlace(room, none, [], "barrel", 2, 2, 0).ok).toBe(false);
  });

  it("the house interior (home_in) takes wall pieces on its north wall and turned floor pieces", () => {
    const house = getMap("home_in");
    const spots: number[] = [];
    for (let x = 0; x < house.width; x++) if (canPlace(house, none, [], "mirror", x, 1, 0).ok) spots.push(x);
    expect(spots.length).toBeGreaterThan(4);
    // Never over a window, the built-in shelf, or the painting that already hangs there.
    for (const p of house.props) {
      if (!/window|shelf/.test(p.type) && p.type !== "painting_landscape") continue;
      expect(spots).not.toContain(p.x);
    }
    expect(canPlace(house, none, [], "mirror", 0, 1, 0).ok).toBe(false); // corner / side wall
    // Wall pieces belong to the house, and the yard has no inside walls to hang them on.
    expect(mapForItem("painting_sea")).toBe("home_in");
    const yard = getMap("home");
    for (let y = 0; y < yard.height; y++) for (let x = 0; x < yard.width; x++) expect(canPlace(yard, none, [], "mirror", x, y, 0).ok).toBe(false);
    expect(canPlace(house, none, [], "mirror", 4, 5, 0).ok).toBe(false); // floor
    // A table turned 1x2 fits against the east wall where the 2x1 doesn't.
    const east = house.width - 2;
    expect(canPlace(house, none, [], "table_wood", east, 6, 0).ok).toBe(false);
    expect(canPlace(house, none, [], "table_wood", east, 6, 1)).toEqual({ ok: true });
  });
});
