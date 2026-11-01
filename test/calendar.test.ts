import { describe, expect, it } from "vitest";
import {
  dateOfDay,
  DAYS_PER_SEASON,
  formatWorldDate,
  isBirthday,
  weekOf,
  WORLD_DAY_MS,
  worldDate,
  worldDay,
  worldHour,
} from "../src/shared/calendar";

const at = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h);

describe("world calendar", () => {
  it("year 1 starts on spring 1, a Monday", () => {
    const d = worldDate(at(2026, 1, 5));
    expect(d).toMatchObject({ year: 1, season: "spring", day: 1, weekday: "Mon" });
  });

  it("weekday is the real UTC weekday", () => {
    expect(worldDate(at(2026, 11, 1)).weekday).toBe("Sun"); // 1 Nov 2026 is a Sunday
    expect(worldDate(at(2026, 10, 30)).weekday).toBe("Fri");
    expect(worldDate(at(1970, 1, 1)).weekday).toBe("Thu");
  });

  it("28-day seasons, 4 seasons a year, and the weekday follows the day of the month", () => {
    const start = worldDay(at(2026, 1, 5));
    expect(dateOfDay(start + 27)).toMatchObject({ season: "spring", day: 28, weekday: "Sun" });
    expect(dateOfDay(start + 28)).toMatchObject({ season: "summer", day: 1, weekday: "Mon" });
    expect(dateOfDay(start + 3 * DAYS_PER_SEASON + 5)).toMatchObject({ season: "winter", day: 6, weekday: "Sat" });
    expect(dateOfDay(start + 4 * DAYS_PER_SEASON)).toMatchObject({ year: 2, season: "spring", day: 1 });
    expect(dateOfDay(start - 1)).toMatchObject({ year: 0, season: "winter", day: 28, weekday: "Sun" });
    for (let i = 0; i < 200; i++) {
      const d = dateOfDay(start + i * 3);
      expect(d.day).toBeGreaterThanOrEqual(1);
      expect(d.day).toBeLessThanOrEqual(28);
      expect(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][(d.day - 1) % 7]).toBe(d.weekday);
    }
  });

  it("the day changes exactly at UTC midnight, the hour follows UTC", () => {
    const mid = Date.UTC(2026, 4, 10);
    expect(worldDay(mid - 1)).toBe(worldDay(mid) - 1);
    expect(worldDay(mid + WORLD_DAY_MS - 1)).toBe(worldDay(mid));
    expect(worldHour(mid + 3.5 * 3_600_000)).toBe(3);
    expect(worldHour(mid - 1)).toBe(23);
  });

  it("weeks start on Sunday", () => {
    const sat = worldDay(at(2026, 10, 31));
    const sun = worldDay(at(2026, 11, 1));
    expect(weekOf(sun)).toBe(weekOf(sat) + 1);
    expect(weekOf(sun + 6)).toBe(weekOf(sun));
    expect(weekOf(sun + 7)).toBe(weekOf(sun) + 1);
  });

  it("birthdays and formatting", () => {
    const d = worldDate(at(2026, 1, 9));
    expect(formatWorldDate(d)).toBe("Fri, Spring 5");
    expect(isBirthday({ season: "spring", day: 5 }, d)).toBe(true);
    expect(isBirthday({ season: "summer", day: 5 }, d)).toBe(false);
    expect(isBirthday(undefined, d)).toBe(false);
  });
});

describe("seasonal seed shelf", () => {
  it("staples all year, every other store seed in exactly two seasons", async () => {
    const { STORE_SEEDS, STAPLE_SEEDS, seedSeasons, storeSeedsFor } = await import("../src/shared/seeds");
    const { SEASONS } = await import("../src/shared/calendar");
    expect(STAPLE_SEEDS).toContain("seed_turnip");
    for (const s of SEASONS) for (const st of STAPLE_SEEDS) expect(storeSeedsFor(s)).toContain(st);
    for (const id of STORE_SEEDS) {
      const n = seedSeasons(id).length;
      expect(n).toBe(STAPLE_SEEDS.includes(id) ? 4 : 2);
    }
    const union = new Set(SEASONS.flatMap((s) => storeSeedsFor(s)));
    expect(union.size).toBe(STORE_SEEDS.length);
    expect(seedSeasons("seed_moonberry")).toEqual([]);
  });
  it("the shop only sells this season's seeds", async () => {
    const { shopToday, buyFrom } = await import("../src/worker/game/shop");
    const { STORE_SEEDS, seedSeasons } = await import("../src/shared/seeds");
    const shop = { sells: STORE_SEEDS.map((item) => ({ item, price: 5 })), buys: [] };
    const now = Date.UTC(2026, 0, 6); // spring
    const today = shopToday(shop, now);
    expect(today.sells.every((o) => seedSeasons(o.item).includes("spring"))).toBe(true);
    const off = STORE_SEEDS.find((id) => !seedSeasons(id).includes("spring"))!;
    expect(buyFrom({ coins: 999, slots: [] }, today, off, 1).ok).toBe(false);
  });
});
