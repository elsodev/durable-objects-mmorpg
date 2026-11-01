import { describe, expect, it } from "vitest";
import { checkConsume, isDay, parseDailyLimit, pruneBefore, utcDay, validUserId, DEFAULT_DAILY_UNITS } from "../src/worker/npc/budget-logic";

describe("budget logic", () => {
  it("parses the daily limit with a default", () => {
    expect(parseDailyLimit(undefined)).toBe(DEFAULT_DAILY_UNITS);
    expect(parseDailyLimit("abc")).toBe(9000);
    expect(parseDailyLimit("")).toBe(9000);
    expect(parseDailyLimit("120.7")).toBe(120);
    expect(parseDailyLimit("0")).toBe(0);
  });
  it("enforces global and per-user limits", () => {
    expect(checkConsume({ globalUnits: 0, userReplies: 0, units: 6, dailyLimit: 9000 })).toBe(6);
    expect(checkConsume({ globalUnits: 8995, userReplies: 0, units: 6, dailyLimit: 9000 })).toBeNull();
    expect(checkConsume({ globalUnits: 8994, userReplies: 0, units: 6, dailyLimit: 9000 })).toBe(6);
    expect(checkConsume({ globalUnits: 0, userReplies: 39, units: 6, dailyLimit: 9000 })).toBe(6);
    expect(checkConsume({ globalUnits: 0, userReplies: 40, units: 6, dailyLimit: 9000 })).toBeNull();
  });
  it("rejects bad unit values", () => {
    for (const units of [NaN, -1, Infinity, 1e6]) expect(checkConsume({ globalUnits: 0, userReplies: 0, units, dailyLimit: 9000 })).toBeNull();
  });
  it("validates days and user ids", () => {
    expect(isDay("2026-11-01")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-1-1")).toBe(false);
    expect(validUserId("")).toBe(false);
    expect(validUserId("x".repeat(129))).toBe(false);
    expect(validUserId("user_1")).toBe(true);
    expect(utcDay(Date.UTC(2026, 10, 1, 23, 59))).toBe("2026-11-01");
  });
  it("prunes across month boundaries", () => {
    expect(pruneBefore("2026-11-03", 7)).toBe("2026-10-28");
  });
});
