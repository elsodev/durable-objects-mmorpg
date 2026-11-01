import { describe, expect, it } from "vitest";
import {
  cropView,
  dayIndex,
  grownDays,
  harvestTile,
  isFarmable,
  passDay,
  plantTile,
  tillTile,
  waterTile,
} from "../src/shared/engine";
import { DAY_MS, Ground, type FarmTile } from "../src/shared/types";
import { makeMap } from "./engine-fixtures";

const T0 = 1_000 * DAY_MS; // start of some day
const day = (n: number, frac = 0.5) => T0 + (n + frac) * DAY_MS;

function planted(seed = "seed_turnip"): FarmTile {
  const t = tillTile(3, 3);
  expect(plantTile(t, seed, day(0))).toBe(true);
  return t;
}

describe("dayIndex", () => {
  it("floors by DAY_MS", () => {
    expect(dayIndex(0)).toBe(0);
    expect(dayIndex(DAY_MS - 1)).toBe(0);
    expect(dayIndex(DAY_MS)).toBe(1);
    expect(dayIndex(day(2))).toBe(1002);
  });
});

describe("crop growth", () => {
  it("empty tilled tile", () => {
    expect(cropView(tillTile(0, 0), day(0))).toEqual({ stage: 0, ready: false, wateredToday: false });
  });

  it("turnip (2 days): watered day 0 and day 1 → ready on day 2", () => {
    const t = planted();
    expect(cropView(t, day(0)).stage).toBe(0);
    waterTile(t, day(0));
    expect(cropView(t, day(0))).toEqual({ stage: 0, ready: false, wateredToday: true });
    expect(cropView(t, day(1)).stage).toBe(2); // 1/2 grown
    expect(cropView(t, day(1)).wateredToday).toBe(false);
    waterTile(t, day(1));
    expect(cropView(t, day(1)).ready).toBe(false); // today's water counts tomorrow
    expect(cropView(t, day(2))).toEqual({ stage: 3, ready: true, wateredToday: false });
  });

  it("pauses (never dies) on unwatered days", () => {
    const t = planted("seed_carrot"); // 3 days
    waterTile(t, day(0));
    // skip days 1..9
    expect(cropView(t, day(9))).toMatchObject({ stage: 1, ready: false });
    waterTile(t, day(10));
    expect(cropView(t, day(11)).stage).toBe(2);
    waterTile(t, day(11));
    expect(cropView(t, day(11)).ready).toBe(false);
    waterTile(t, day(30));
    expect(cropView(t, day(31)).ready).toBe(true);
  });

  it("watering twice the same day counts once", () => {
    const t = planted();
    expect(waterTile(t, day(0, 0.1))).toBe(true);
    expect(waterTile(t, day(0, 0.9))).toBe(false);
    expect(t.wateredDays).toBe(1);
    expect(grownDays(t, day(1))).toBe(1);
  });

  it("stages progress monotonically up to ready for every crop", () => {
    for (const [seed, days] of [
      ["seed_turnip", 2],
      ["seed_carrot", 3],
      ["seed_strawberry", 4],
      ["seed_pumpkin", 5],
    ] as const) {
      const t = planted(seed);
      let prev = 0;
      for (let d = 0; d < days; d++) {
        expect(cropView(t, day(d)).ready).toBe(false);
        waterTile(t, day(d));
        const s = cropView(t, day(d + 1)).stage;
        expect(s).toBeGreaterThanOrEqual(prev);
        prev = s;
      }
      expect(cropView(t, day(days)).ready).toBe(true);
      expect(cropView(t, day(days)).stage).toBe(3);
    }
  });

  it("plant rules: only seeds, only empty tiles", () => {
    const t = tillTile(0, 0);
    expect(plantTile(t, "turnip", day(0))).toBe(false);
    expect(plantTile(t, "seed_turnip", day(0))).toBe(true);
    expect(t.crop).toBe("turnip");
    expect(plantTile(t, "seed_carrot", day(0))).toBe(false);
    expect(waterTile(tillTile(0, 0), day(0))).toBe(false); // nothing to water
  });

  it("harvest returns crop only when ready and resets tile", () => {
    const t = planted();
    expect(harvestTile(t, day(0))).toBeNull();
    waterTile(t, day(0));
    waterTile(t, day(1));
    expect(harvestTile(t, day(2))).toBe("turnip");
    expect(t).toEqual(tillTile(3, 3));
  });
});

describe("passDay (local dev clock)", () => {
  it("grows a watered crop through every stage to harvest without waiting", () => {
    const t = planted("seed_turnip");
    const now = day(0);
    const stages: number[] = [];
    for (let i = 0; i < 10 && !cropView(t, now).ready; i++) {
      expect(waterTile(t, now)).toBe(true);
      expect(waterTile(t, now)).toBe(false); // still once per day
      expect(passDay(t)).toBe(true);
      stages.push(cropView(t, now).stage);
    }
    expect(cropView(t, now).ready).toBe(true);
    expect(stages.at(-1)).toBe(3);
    expect(harvestTile(t, now)).toBe("turnip");
  });
  it("leaves empty tiles alone and doesn't grow unwatered crops", () => {
    const empty = tillTile(1, 1);
    expect(passDay(empty)).toBe(false);
    const t = planted();
    passDay(t);
    expect(cropView(t, day(0)).stage).toBe(0);
  });
});

describe("isFarmable", () => {
  const map = makeMap(["#######", "#.....#", "#..~..#", "#.....#", "#######"], {
    farmArea: [{ x: 1, y: 1, w: 4, h: 3 }],
    props: [{ id: "well", type: "well", x: 4, y: 3, w: 1, h: 1 }],
  });
  it("inside farm area on soil, not under props or water", () => {
    expect(isFarmable(map, 1, 1)).toBe(true);
    expect(isFarmable(map, 2.7, 1.2)).toBe(true);
    expect(isFarmable(map, 3, 2)).toBe(false); // water
    expect(isFarmable(map, 4, 3)).toBe(false); // prop
    expect(isFarmable(map, 5, 1)).toBe(false); // outside area
    expect(isFarmable(map, -1, 1)).toBe(false);
  });
  it("tilled ground is still farmable", () => {
    const m2 = { ...map, ground: map.ground.slice() };
    m2.ground[1 * map.width + 1] = Ground.Tilled;
    expect(isFarmable(m2, 1, 1)).toBe(true);
  });
  it("no farmArea → nothing farmable", () => {
    expect(isFarmable({ ...map, farmArea: undefined }, 1, 1)).toBe(false);
  });
});
