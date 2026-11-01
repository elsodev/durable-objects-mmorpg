import { describe, expect, it } from "vitest";
import { classifyTarget, resolveToolUse } from "../src/shared/engine/toolRules";
import {
  clearDeadCrop,
  CROP_DEATH_DAYS,
  cropDays,
  cropLook,
  cropView,
  farmNow,
  growthStage,
  harvestable,
  harvestCrop,
  plantTile,
  rollFarmDay,
  tillTile,
  waterTile,
} from "../src/shared/engine";
import type { FarmTile } from "../src/shared/types";
import { sanitizeFarm } from "../src/worker/game/sanitize";
import { endHomeDay } from "../src/worker/game/homeDay";

const noCrows = () => 0.99;

function planted(seed: string, day: number): FarmTile {
  const t = tillTile(3, 3);
  expect(plantTile(t, seed, farmNow(day))).toBe(true);
  return t;
}

/** Ends `day` for one tile, as the home day roll does. */
function endDay(t: FarmTile, day: number) {
  return rollFarmDay([t], [], day, noCrows);
}

describe("growthStage", () => {
  it("seedling on day 0, ready only when fully grown", () => {
    for (const days of [1, 2, 3, 4, 5, 8]) {
      expect(growthStage(0, days)).toBe(0);
      expect(growthStage(days, days)).toBe(3);
      expect(growthStage(days + 3, days)).toBe(3);
      for (let g = 0; g < days; g++) expect(growthStage(g, days)).toBeLessThan(3);
    }
  });

  it("spreads seedling, small and medium evenly over the watered days", () => {
    expect([0, 1, 2, 3].map((g) => growthStage(g, 3))).toEqual([0, 1, 2, 3]);
    expect([0, 1, 2, 3, 4].map((g) => growthStage(g, 4))).toEqual([0, 0, 1, 2, 3]);
    expect([0, 1, 2, 3, 4, 5].map((g) => growthStage(g, 5))).toEqual([0, 0, 1, 1, 2, 3]);
    expect([0, 1, 2].map((g) => growthStage(g, 2))).toEqual([0, 1, 3]);
    expect([0, 1, 2, 3, 4, 5, 6].map((g) => growthStage(g, 6))).toEqual([0, 0, 1, 1, 2, 2, 3]);
  });

  it("never goes backwards", () => {
    for (const days of [2, 3, 4, 5, 7]) {
      let prev = 0;
      for (let g = 0; g <= days; g++) {
        const s = growthStage(g, days);
        expect(s).toBeGreaterThanOrEqual(prev);
        prev = s;
      }
    }
  });

  it("matches what cropView shows for every crop", () => {
    for (const seed of ["seed_turnip", "seed_carrot", "seed_strawberry", "seed_pumpkin"]) {
      const t = planted(seed, 0);
      const days = cropDays(t.crop!)!;
      for (let d = 0; d < days; d++) {
        expect(cropView(t, farmNow(d)).stage).toBe(growthStage(d, days));
        waterTile(t, farmNow(d));
      }
      expect(cropView(t, farmNow(days))).toMatchObject({ stage: 3, ready: true });
    }
  });
});

describe("wilting", () => {
  it("a crop not watered yesterday wilts and doesn't grow", () => {
    const t = planted("seed_carrot", 0); // 3 days
    waterTile(t, farmNow(0));
    endDay(t, 0);
    expect(cropView(t, farmNow(1))).toMatchObject({ stage: 1, wilted: false });
    // Day 1 passes dry.
    const r = endDay(t, 1);
    expect(r.wilted).toBe(1);
    expect(t.dryDays).toBe(1);
    expect(cropView(t, farmNow(2))).toMatchObject({ stage: 1, wilted: true, dead: false });
    expect(cropLook(cropView(t, farmNow(2)))).toBe("wilted");
  });

  it("watering a wilted crop restores it at once; growth resumes the next night", () => {
    const t = planted("seed_carrot", 0);
    waterTile(t, farmNow(0));
    endDay(t, 0);
    endDay(t, 1);
    expect(cropView(t, farmNow(2)).wilted).toBe(true);
    waterTile(t, farmNow(2));
    expect(cropView(t, farmNow(2))).toMatchObject({ stage: 1, wilted: false, wateredToday: true });
    endDay(t, 2);
    expect(t.dryDays).toBe(0);
    expect(cropView(t, farmNow(3))).toMatchObject({ stage: 2, wilted: false });
  });

  it("a seed planted and never watered wilts the next morning", () => {
    const t = planted("seed_turnip", 0);
    endDay(t, 0);
    expect(cropView(t, farmNow(1))).toMatchObject({ stage: 0, wilted: true });
  });

  it("a seed sown on soil watered today starts fresh, not wilted", () => {
    const t = tillTile(1, 1);
    t.dryDays = 2;
    waterTile(t, farmNow(0));
    plantTile(t, "seed_turnip", farmNow(0));
    expect(t.dryDays).toBe(0);
    expect(cropView(t, farmNow(0)).wilted).toBe(false);
  });

  it("ripe crops don't need water: they never wilt or die", () => {
    const t = planted("seed_turnip", 0);
    waterTile(t, farmNow(0));
    endDay(t, 0);
    waterTile(t, farmNow(1));
    endDay(t, 1);
    for (let d = 2; d < 2 + CROP_DEATH_DAYS + 2; d++) endDay(t, d);
    expect(cropView(t, farmNow(10))).toMatchObject({ ready: true, wilted: false, dead: false });
    expect(harvestable(t, farmNow(10))).toBe("turnip");
  });
});

describe("death and clearing", () => {
  function dried(): FarmTile {
    const t = planted("seed_pumpkin", 0);
    waterTile(t, farmNow(0));
    endDay(t, 0);
    return t;
  }

  it(`dies after ${CROP_DEATH_DAYS} dry days in a row`, () => {
    const t = dried();
    for (let d = 1; d < CROP_DEATH_DAYS; d++) {
      const r = endDay(t, d);
      expect(r.died).toEqual([]);
      expect(cropView(t, farmNow(d + 1)).wilted).toBe(true);
    }
    const r = endDay(t, CROP_DEATH_DAYS);
    expect(r.died).toEqual([{ x: 3, y: 3, crop: "pumpkin" }]);
    expect(r.farm).toContain(t);
    expect(t.dead).toBe(true);
    const v = cropView(t, farmNow(CROP_DEATH_DAYS + 1));
    expect(v).toMatchObject({ dead: true, wilted: false, ready: false });
    expect(cropLook(v)).toBe("dead");
  });

  it("one watered day resets the count", () => {
    const t = dried();
    endDay(t, 1);
    endDay(t, 2);
    waterTile(t, farmNow(3));
    endDay(t, 3);
    endDay(t, 4);
    endDay(t, 5);
    expect(t.dead).toBeUndefined();
    expect(t.dryDays).toBe(2);
  });

  function dead(): FarmTile {
    const t = dried();
    for (let d = 1; d <= CROP_DEATH_DAYS; d++) endDay(t, d);
    expect(t.dead).toBe(true);
    return t;
  }

  it("a dead crop can't be watered, harvested or eaten by crows, and stays put", () => {
    const t = dead();
    const now = farmNow(10);
    expect(waterTile(t, now)).toBe(false);
    expect(harvestable(t, now)).toBeNull();
    expect(harvestCrop(t, now)).toBe(false);
    const r = rollFarmDay([t], [], 10, () => 0);
    expect(r.eaten).toEqual([]);
    expect(r.farm).toEqual([t]);
    expect(t.dead).toBe(true);
  });

  it("clearDeadCrop leaves empty tilled soil", () => {
    const t = dead();
    expect(clearDeadCrop(t)).toBe(true);
    expect(t).toEqual({ ...tillTile(3, 3), dryDays: 0 });
    expect(clearDeadCrop(t)).toBe(false);
    expect(plantTile(t, "seed_turnip", farmNow(20))).toBe(true);
  });

  it("clearDeadCrop does nothing to a living crop", () => {
    const t = planted("seed_carrot", 0);
    expect(clearDeadCrop(t)).toBe(false);
    expect(t.crop).toBe("carrot");
  });

  it("the hoe, or anything in hand, clears a dead crop at home only", () => {
    const t = dead();
    const target = classifyTarget({ soil: t }, farmNow(10));
    expect(target).toEqual({ kind: "soil", crop: "dead" });
    for (const key of ["hoe", "water", "seed", "other", "axe"] as const) {
      expect(resolveToolUse(key, target, { farm: true })).toEqual({ ok: true, effect: "clear" });
    }
    expect(resolveToolUse("hoe", target, { farm: false }).ok).toBe(false);
  });

  it("save data keeps dryDays on crops and the dead flag", () => {
    const t = dead();
    const [out] = sanitizeFarm([t, { ...tillTile(5, 5), dead: true }]);
    expect(out).toMatchObject({ crop: "pumpkin", dead: true, dryDays: CROP_DEATH_DAYS });
    const empty = sanitizeFarm([{ ...tillTile(5, 5), dead: true }])[0]!;
    expect(empty.dead).toBeUndefined();
  });

  it("the morning summary reports wilted and dead crops", () => {
    const wilting = dried();
    const dying = dried();
    dying.x = 4;
    dying.dryDays = CROP_DEATH_DAYS - 1;
    const st = { clock: { day: 1, startAt: 0 }, farm: [wilting, dying], objects: [], bin: [] };
    const res = endHomeDay(st, "sleep", 0, 1_000, noCrows);
    expect(res.summary.wilted).toBe(1);
    expect(res.summary.died).toEqual([{ x: 4, y: 3, crop: "pumpkin" }]);
  });
});
