import { describe, expect, it } from "vitest";
import {
  catchUpMorning,
  clockAtMinutes,
  clockMinutes,
  cropView,
  dayIndex,
  dayOver,
  dayPhase,
  daylightTint,
  DAY_END_MIN,
  DAY_START_MIN,
  eatGain,
  farmNow,
  formatClock,
  GAME_HOUR_MS,
  harvestCrop,
  harvestable,
  HOME_DAY_MS,
  lampStrength,
  MAX_STAMINA,
  nextMorning,
  passOutPenalty,
  plantTile,
  protectedByScarecrow,
  crowTargets,
  CROW_CHANCE,
  CROW_FULL_CROPS,
  rollFarmDay,
  staminaCost,
  tillTile,
  waterTile,
} from "../src/shared/engine";
import { baseItem, getItem, qualityItem } from "../src/shared/items";
import type { FarmTile, PlacedObject } from "../src/shared/types";
import { binPayout, sanitizeBin, shipSlot, unshipLast, type BinEntry } from "../src/worker/game/shipping";
import { endHomeDay } from "../src/worker/game/homeDay";
import { sanitizeClock } from "../src/worker/game/homeState";
import { sanitizeFarm } from "../src/worker/game/sanitize";
import { sellTo } from "../src/worker/game/shop";
import { decodeClient } from "../src/shared/protocol";
import { snapshotEntity } from "../src/worker/game/diff";

/** Deterministic rand from a list of values (repeats the last). */
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[Math.min(i++, v.length - 1)];
};

function planted(seed: string, day: number, x = 3, y = 3): FarmTile {
  const t = tillTile(x, y);
  plantTile(t, seed, farmNow(day));
  return t;
}

describe("home clock", () => {
  it("runs 6:00 to 2:00 at GAME_HOUR_MS per hour", () => {
    const c = { day: 1, startAt: 1_000 };
    expect(HOME_DAY_MS).toBe(20 * GAME_HOUR_MS);
    expect(clockMinutes(c, 1_000)).toBe(DAY_START_MIN);
    expect(clockMinutes(c, 1_000 + GAME_HOUR_MS)).toBe(7 * 60);
    expect(clockMinutes(c, 1_000 + 10 * HOME_DAY_MS)).toBe(DAY_END_MIN);
    expect(dayOver(c, 1_000 + HOME_DAY_MS - 1)).toBe(false);
    expect(dayOver(c, 1_000 + HOME_DAY_MS)).toBe(true);
  });
  it("formats like a farm clock, in 10 minute steps", () => {
    expect(formatClock(6 * 60)).toBe("6:00 AM");
    expect(formatClock(12 * 60 + 7)).toBe("12:00 PM");
    expect(formatClock(13 * 60 + 25)).toBe("1:20 PM");
    expect(formatClock(24 * 60 + 30)).toBe("12:30 AM");
    expect(formatClock(25 * 60 + 59)).toBe("1:50 AM");
  });
  it("next morning and catch-up after an absence", () => {
    const c = { day: 4, startAt: 0 };
    expect(nextMorning(c, 500)).toEqual({ day: 5, startAt: 500 });
    // Ended a little while ago: the new day started when the old one ended.
    expect(catchUpMorning(c, HOME_DAY_MS + 10)).toEqual({ day: 5, startAt: HOME_DAY_MS });
    // Gone for days: one day passes and the next starts now.
    expect(catchUpMorning(c, 5 * HOME_DAY_MS)).toEqual({ day: 5, startAt: 5 * HOME_DAY_MS });
  });
  it("dev clock setter and sanitizer", () => {
    const c = clockAtMinutes({ day: 2, startAt: 0 }, 21 * 60, 10_000_000);
    expect(clockMinutes(c, 10_000_000)).toBeCloseTo(21 * 60);
    expect(sanitizeClock(null, 5)).toEqual({ day: 1, startAt: 5 });
    expect(sanitizeClock({ day: -3, startAt: 99 }, 5)).toEqual({ day: 1, startAt: 5 });
    expect(sanitizeClock({ day: 7, startAt: 3 }, 5)).toEqual({ day: 7, startAt: 3 });
  });
  it("farm time maps home day N to day index N", () => {
    for (const d of [1, 2, 37]) expect(dayIndex(farmNow(d))).toBe(d);
  });
  it("lighting: white by day, tinted at night, lamps on after dusk", () => {
    expect(daylightTint(12 * 60)).toBe(0xffffff);
    expect(daylightTint(23 * 60)).not.toBe(0xffffff);
    expect(lampStrength(12 * 60)).toBe(0);
    expect(lampStrength(22 * 60)).toBe(1);
    expect(dayPhase(7 * 60)).toBe("morning");
    expect(dayPhase(18 * 60)).toBe("evening");
    expect(dayPhase(23 * 60)).toBe("night");
  });
});

describe("growth on home days", () => {
  it("advances one stage per watered day only", () => {
    const t = planted("seed_turnip", 1); // 2 days
    expect(waterTile(t, farmNow(1))).toBe(true);
    expect(waterTile(t, farmNow(1))).toBe(false); // once a day
    expect(cropView(t, farmNow(1)).stage).toBe(0);
    expect(cropView(t, farmNow(2))).toMatchObject({ stage: 1, wateredToday: false }); // soil dried
    // Day 2 not watered: no growth on day 3.
    expect(cropView(t, farmNow(3)).ready).toBe(false);
    waterTile(t, farmNow(3));
    expect(cropView(t, farmNow(4)).ready).toBe(true);
  });
});

describe("soil revert", () => {
  it("empty tilled soil reverts after 2 (maybe) or 3 dry days; planted soil never does", () => {
    const empty = tillTile(1, 1);
    const crop = planted("seed_turnip", 1, 2, 2);
    let farm: FarmTile[] = [empty, crop];
    const noCrows = () => 0.99;
    farm = rollFarmDay(farm, [], 1, noCrows).farm;
    expect(farm).toHaveLength(2);
    expect(empty.dryDays).toBe(1);
    // Day 2: 50% roll fails (0.99), stays.
    farm = rollFarmDay(farm, [], 2, noCrows).farm;
    expect(farm).toHaveLength(2);
    // Day 3: always reverts.
    const r = rollFarmDay(farm, [], 3, noCrows);
    expect(r.reverted).toEqual([{ x: 1, y: 1 }]);
    expect(r.farm).toEqual([crop]);
  });
  it("watered empty soil stays damp: its dry count starts over", () => {
    const t = { ...tillTile(0, 0), dryDays: 2 };
    waterTile(t, farmNow(1));
    const r = rollFarmDay([t], [], 1, () => 0);
    expect(r.reverted).toHaveLength(0);
    expect(t.dryDays).toBe(0);
  });
  it("may revert on the second dry day", () => {
    const t = { ...tillTile(0, 0), dryDays: 1 };
    // rand: revert roll 0.1 (< 0.5), crow roll irrelevant.
    expect(rollFarmDay([t], [], 1, seq(0.1, 0.99)).reverted).toHaveLength(1);
  });
  it("counts crops that grew", () => {
    const t = planted("seed_carrot", 1);
    waterTile(t, farmNow(1));
    expect(rollFarmDay([t], [], 1, () => 0.99).grown).toBe(1);
    expect(rollFarmDay([t], [], 2, () => 0.99).grown).toBe(0);
  });
});

describe("harvest, quality and regrow", () => {
  it("quality items stack separately and sell for more", () => {
    expect(qualityItem("turnip", 0)).toBe("turnip");
    expect(qualityItem("turnip", 1)).toBe("turnip_silver");
    expect(qualityItem("turnip", 2)).toBe("turnip_gold");
    expect(baseItem("turnip_gold")).toBe("turnip");
    expect(getItem("turnip_silver")!.sell).toBe(Math.round(25 * 1.25));
    expect(getItem("turnip_gold")!.sell).toBe(Math.round(25 * 1.5));
    expect(getItem("pumpkin_gold")!.quality).toBe(2);
  });
  it("NPCs who buy a crop buy its quality versions too", () => {
    const inv = { coins: 0, slots: [{ item: "turnip_gold", qty: 2 }] };
    const r = sellTo(inv, { sells: [], buys: ["turnip"] }, 0, 2);
    expect(r.ok).toBe(true);
    expect(inv.coins).toBe(2 * getItem("turnip_gold")!.sell);
  });
  it("harvests only a ready crop", () => {
    const t = planted("seed_turnip", 1);
    expect(harvestable(t, farmNow(1))).toBeNull();
    waterTile(t, farmNow(1));
    waterTile(t, farmNow(2));
    expect(harvestable(t, farmNow(3))).toBe("turnip");
    expect(t.crop).toBe("turnip");
    expect(harvestCrop(t, farmNow(3))).toBe(true);
    expect(t.crop).toBeNull();
  });
  it("strawberries regrow every 3 watered days after the first harvest", () => {
    const t = planted("seed_strawberry", 1); // 4 days
    for (let d = 1; d <= 4; d++) waterTile(t, farmNow(d));
    expect(cropView(t, farmNow(5)).ready).toBe(true);
    expect(harvestCrop(t, farmNow(5))).toBe(true);
    expect(t.crop).toBe("strawberry");
    expect(cropView(t, farmNow(5)).ready).toBe(false);
    for (let d = 5; d <= 7; d++) {
      expect(cropView(t, farmNow(d)).ready).toBe(false);
      waterTile(t, farmNow(d));
    }
    expect(cropView(t, farmNow(8)).ready).toBe(true);
  });
  it("regrow keeps today's watering counting tomorrow", () => {
    const t = planted("seed_strawberry", 1);
    for (let d = 1; d <= 4; d++) waterTile(t, farmNow(d));
    waterTile(t, farmNow(5)); // watered, then harvested the same day
    harvestCrop(t, farmNow(5));
    waterTile(t, farmNow(6));
    waterTile(t, farmNow(7));
    expect(cropView(t, farmNow(8)).ready).toBe(true);
  });
});

describe("crows and scarecrows", () => {
  const scarecrow: PlacedObject = { id: "o1", item: "scarecrow", x: 10, y: 10, rotation: 0 };
  it("radius 8 protects", () => {
    expect(protectedByScarecrow({ x: 18, y: 10 }, [scarecrow])).toBe(true);
    expect(protectedByScarecrow({ x: 16, y: 16 }, [scarecrow])).toBe(false); // ~8.49
  });
  it("eat only unprotected crops, with CROW_CHANCE", () => {
    const near = planted("seed_turnip", 1, 12, 10);
    const far = planted("seed_turnip", 1, 30, 10);
    expect(crowTargets([near, far], [scarecrow], seq(0.9))).toEqual([]); // no visit
    expect(crowTargets([near, far], [scarecrow], seq(0.02, 0))).toEqual([far]);
    expect(crowTargets([near], [scarecrow], seq(0.0, 0))).toEqual([]);
  });
  it("eaten crops leave empty soil and show up in the result", () => {
    const far = planted("seed_carrot", 1, 30, 10);
    const r = rollFarmDay([far], [], 1, seq(0.01, 0));
    expect(r.eaten).toEqual([{ x: 30, y: 10, crop: "carrot" }]);
    expect(far.crop).toBeNull();
  });
  it("small plots draw crows less: the chance scales with the crop count up to CROW_FULL_CROPS", () => {
    const one = [planted("seed_turnip", 1, 30, 10)];
    expect(crowTargets(one, [], seq(CROW_CHANCE / CROW_FULL_CROPS - 0.001, 0))).toHaveLength(1);
    expect(crowTargets(one, [], seq(CROW_CHANCE / CROW_FULL_CROPS + 0.001, 0))).toEqual([]);
    const full = Array.from({ length: CROW_FULL_CROPS }, (_, i) => planted("seed_turnip", 1, i, 0));
    expect(crowTargets(full, [], seq(CROW_CHANCE - 0.001, 0))).toHaveLength(1);
  });
  it("more crops, more crows", () => {
    const many = Array.from({ length: 32 }, (_, i) => planted("seed_turnip", 1, i, 0));
    expect(crowTargets(many, [], seq(0.1, 0.5)).length).toBe(3);
  });
});

describe("stamina", () => {
  it("tools cost 2-3 per swing, eating restores up to the max", () => {
    expect(staminaCost("hoe")).toBe(2);
    expect(staminaCost("water")).toBe(2);
    expect(staminaCost("pickaxe")).toBe(2);
    expect(staminaCost("axe")).toBe(2);
    expect(staminaCost(undefined)).toBe(0);
    expect(eatGain("turnip", 50)).toBe(getItem("turnip")!.eat);
    expect(eatGain("turnip_gold", 50)).toBeGreaterThan(eatGain("turnip", 50));
    expect(eatGain("turnip", MAX_STAMINA - 3)).toBe(3);
    expect(eatGain("hoe", 10)).toBe(0);
  });
  it("pass-out penalty is 10% capped at 100", () => {
    expect(passOutPenalty(300)).toBe(30);
    expect(passOutPenalty(5000)).toBe(100);
    expect(passOutPenalty(0)).toBe(0);
  });
});

describe("shipping bin", () => {
  it("ships whole stacks, groups the payout, and gives back the last one", () => {
    const inv = { coins: 0, slots: [{ item: "hoe", qty: 1 }, { item: "turnip", qty: 3 }, { item: "turnip_gold", qty: 1 }] };
    const bin: BinEntry[] = [];
    expect(shipSlot(inv, bin, 0).ok).toBe(false); // tools can't be shipped
    expect(shipSlot(inv, bin, 1).ok).toBe(true);
    expect(shipSlot(inv, bin, 1).ok).toBe(false); // slot 1 is now empty: slots never shift
    expect(shipSlot(inv, bin, 2).ok).toBe(true);
    expect(inv.slots).toEqual([{ item: "hoe", qty: 1 }, null, null]);
    const pay = binPayout(bin);
    expect(pay.lines).toEqual([
      { item: "turnip", qty: 3, coins: 75 },
      { item: "turnip_gold", qty: 1, coins: getItem("turnip_gold")!.sell },
    ]);
    expect(pay.total).toBe(75 + getItem("turnip_gold")!.sell);
    expect(unshipLast(inv, bin).ok).toBe(true);
    expect(inv.slots[1]).toEqual({ item: "turnip_gold", qty: 1 }); // first empty slot
    expect(bin).toEqual([{ item: "turnip", qty: 3 }]);
    expect(inv.coins).toBe(0); // nothing paid before the day ends
    expect(unshipLast(inv, []).ok).toBe(false);
  });
  it("merges the same item into one bin entry, so the bin fills by kinds of item", () => {
    const inv = { coins: 0, slots: [{ item: "turnip", qty: 2 }, { item: "carrot", qty: 1 }, { item: "turnip", qty: 5 }] };
    const bin: BinEntry[] = [];
    expect(shipSlot(inv, bin, 0).ok).toBe(true);
    expect(shipSlot(inv, bin, 1).ok).toBe(true); // carrot (slots stay put)
    expect(shipSlot(inv, bin, 2).ok).toBe(true); // more turnips join the first entry, now last
    expect(bin).toEqual([
      { item: "carrot", qty: 1 },
      { item: "turnip", qty: 7 },
    ]);
    expect(unshipLast(inv, bin).ok).toBe(true);
    expect(inv.slots).toEqual([{ item: "turnip", qty: 7 }, null, null]);
    // A full bin still takes more of an item it already holds.
    const packed: BinEntry[] = [{ item: "turnip", qty: 1 }, ...Array.from({ length: 47 }, (_, i) => ({ item: i % 2 ? "carrot" : "stone", qty: 1 }))];
    expect(shipSlot({ coins: 0, slots: [{ item: "turnip", qty: 1 }] }, packed, 0).ok).toBe(true);
    expect(packed.length).toBe(48);
    expect(shipSlot({ coins: 0, slots: [{ item: "pumpkin", qty: 1 }] }, packed, 0).ok).toBe(false);
  });
  it("sanitizes stored bins", () => {
    expect(sanitizeBin([{ item: "turnip", qty: 2 }, { item: "nope", qty: 1 }, { item: "carrot", qty: -1 }, null])).toEqual([
      { item: "turnip", qty: 2 },
    ]);
  });
});

describe("day end", () => {
  const state = () => {
    const t = planted("seed_turnip", 3);
    waterTile(t, farmNow(3));
    return {
      clock: { day: 3, startAt: 0 },
      farm: [t, tillTile(9, 9)],
      objects: [] as PlacedObject[],
      bin: [{ item: "carrot", qty: 2 }] as BinEntry[],
    };
  };
  it("sleep: pays the bin, grows crops, full stamina, next morning", () => {
    const st = state();
    const res = endHomeDay(st, "sleep", 100, 5_000, () => 0.99);
    expect(res.coinsDelta).toBe(80);
    expect(res.stamina).toBe(MAX_STAMINA);
    expect(st.bin).toEqual([]);
    expect(st.clock).toEqual({ day: 4, startAt: 5_000 });
    expect(res.summary).toMatchObject({ day: 3, total: 80, grown: 1, passedOut: false, penalty: 0 });
    expect(cropView(st.farm[0], farmNow(st.clock.day)).stage).toBe(1);
  });
  it("passing out costs coins and stamina", () => {
    const st = state();
    const res = endHomeDay(st, "passout", 200, HOME_DAY_MS, () => 0.99);
    expect(res.summary.passedOut).toBe(true);
    expect(res.summary.penalty).toBe(28); // 10% of 200 + 80 payout
    expect(res.coinsDelta).toBe(80 - 28);
    expect(res.stamina).toBeLessThan(MAX_STAMINA);
  });
  it("away: one day settles, the clock catches up", () => {
    const st = state();
    const res = endHomeDay(st, "away", 0, 10 * HOME_DAY_MS, () => 0.99);
    expect(res.summary.away).toBe(true);
    expect(st.clock).toEqual({ day: 4, startAt: 10 * HOME_DAY_MS });
  });
});

describe("protocol and saves", () => {
  it("validates the new client messages", () => {
    expect(decodeClient(JSON.stringify({ t: "eat", slot: 3 }))).toEqual({ t: "eat", slot: 3 });
    expect(decodeClient(JSON.stringify({ t: "eat", slot: 99 }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "sleep", extra: 1 }))).toEqual({ t: "sleep" });
    expect(decodeClient(JSON.stringify({ t: "unship", req: "r1" }))).toEqual({ t: "unship", req: "r1" });
    expect(decodeClient(JSON.stringify({ t: "unship", req: 5 }))).toBeNull();
  });
  it("farm tiles keep dryDays and never hold a quality crop", () => {
    const out = sanitizeFarm([
      { x: 1, y: 1, crop: null, plantedAt: null, wateredDays: 0, lastWateredDay: null, dryDays: 2 },
      { x: 2, y: 1, crop: "turnip_gold", plantedAt: 1, wateredDays: 1, lastWateredDay: 1 },
    ]);
    expect(out[0].dryDays).toBe(2);
    expect(out[1].crop).toBeNull();
  });
  it("entity snapshots carry the action field", () => {
    const e = { id: "p:1", kind: "player" as const, name: "A", sprite: "s", x: 1, y: 1, facing: "down" as const, moving: false };
    expect(snapshotEntity({ ...e, act: { k: "hoe", at: 5 } }).act).toEqual({ k: "hoe", at: 5 });
    expect("act" in snapshotEntity(e)).toBe(false);
  });
});
