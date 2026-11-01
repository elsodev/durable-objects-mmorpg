// Home day clock. Each home keeps its own clock: a day starts at 6:00 and ends at 2:00 the next
// morning, at GAME_HOUR_MS real ms per game hour. Pure: callers pass `now`.
import { DAY_MS } from "../types";

/** Real milliseconds per game hour (~50 s, so a full day is about 17 real minutes). */
export const GAME_HOUR_MS = 50_000;
export const GAME_MINUTE_MS = GAME_HOUR_MS / 60;
/** Minutes after midnight of the day's first and last moment (26:00 = 2:00 next morning). */
export const DAY_START_MIN = 6 * 60;
export const DAY_END_MIN = 26 * 60;
/** Real length of a full home day, 6:00 to 2:00. */
export const HOME_DAY_MS = ((DAY_END_MIN - DAY_START_MIN) / 60) * GAME_HOUR_MS;

export interface HomeClock {
  /** Day number, from 1. */
  day: number;
  /** Real time (server ms) at which 6:00 of `day` began. */
  startAt: number;
}

export function newClock(now: number): HomeClock {
  return { day: 1, startAt: now };
}

/** Minutes after midnight of the current day, DAY_START_MIN..DAY_END_MIN. */
export function clockMinutes(c: HomeClock, now: number): number {
  const m = DAY_START_MIN + (now - c.startAt) / GAME_MINUTE_MS;
  return Math.min(DAY_END_MIN, Math.max(DAY_START_MIN, m));
}

/** True once the clock has reached 2:00. */
export function dayOver(c: HomeClock, now: number): boolean {
  return now - c.startAt >= HOME_DAY_MS;
}

/** Real time at which the current day hits 2:00. */
export function dayEndsAt(c: HomeClock): number {
  return c.startAt + HOME_DAY_MS;
}

/** Clock for the morning after: day + 1, starting at `now`. */
export function nextMorning(c: HomeClock, now: number): HomeClock {
  return { day: c.day + 1, startAt: now };
}

/**
 * The day after one that ended while nobody was home. If the next day would already be over too,
 * it starts now instead, so a long absence costs one day, not dozens.
 */
export function catchUpMorning(c: HomeClock, now: number): HomeClock {
  const start = dayEndsAt(c);
  return { day: c.day + 1, startAt: now - start >= HOME_DAY_MS ? now : start };
}

/** Sets the clock so that it reads `minutes` at `now` (dev tool). */
export function clockAtMinutes(c: HomeClock, minutes: number, now: number): HomeClock {
  const m = Math.min(DAY_END_MIN, Math.max(DAY_START_MIN, minutes));
  return { day: c.day, startAt: now - (m - DAY_START_MIN) * GAME_MINUTE_MS };
}

/** "6:00 AM" .. "1:50 AM", in 10 minute steps. */
export function formatClock(minutes: number): string {
  const m = Math.floor(minutes / 10) * 10;
  const h24 = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm.toString().padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** The virtual farm time for home day `day`: farm engine functions see day index == `day`. */
export function farmNow(day: number): number {
  return day * DAY_MS + DAY_MS / 2;
}

export type DayPhase = "morning" | "day" | "evening" | "night";

export function dayPhase(minutes: number): DayPhase {
  if (minutes < 9 * 60) return "morning";
  if (minutes < 17 * 60) return "day";
  if (minutes < 20 * 60) return "evening";
  return "night";
}

/** Multiply tint keyframes (minutes -> RGB). Between keys the tint is interpolated. */
const TINT_KEYS: [number, number][] = [
  [6 * 60, 0xc9c4e6], // dawn: cool, a bit dim
  [8 * 60, 0xfff1dc], // warm morning
  [10 * 60, 0xffffff],
  [16 * 60, 0xffffff],
  [18 * 60, 0xffd2a0], // golden evening
  [19 * 60 + 30, 0xb98fa8], // dusk
  [21 * 60, 0x5a5f9a], // night
  [24 * 60, 0x3b4078], // deep night
  [26 * 60, 0x343a70],
];

function lerpRgb(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Screen tint at a time of day (white = no tint). */
export function daylightTint(minutes: number): number {
  if (minutes <= TINT_KEYS[0][0]) return TINT_KEYS[0][1];
  for (let i = 1; i < TINT_KEYS.length; i++) {
    const [m1, c1] = TINT_KEYS[i];
    if (minutes <= m1) {
      const [m0, c0] = TINT_KEYS[i - 1];
      return lerpRgb(c0, c1, (minutes - m0) / (m1 - m0));
    }
  }
  return TINT_KEYS[TINT_KEYS.length - 1][1];
}

/** Indoor tint keyframes: lamplit warmth that only dims (never goes blue) as the night deepens. */
const INDOOR_KEYS: [number, number][] = [
  [6 * 60, 0xf2e4d0],
  [9 * 60, 0xffffff],
  [17 * 60, 0xffffff],
  [19 * 60 + 30, 0xf2d6b0], // lamps lit
  [22 * 60, 0xc8a888],
  [26 * 60, 0xa48a78], // late: dim, still warm
];

/** Inside the house: a warm interior light, dimmed at night (white = no tint). */
export function interiorTint(minutes: number): number {
  if (minutes <= INDOOR_KEYS[0][0]) return INDOOR_KEYS[0][1];
  for (let i = 1; i < INDOOR_KEYS.length; i++) {
    const [m1, c1] = INDOOR_KEYS[i];
    if (minutes <= m1) {
      const [m0, c0] = INDOOR_KEYS[i - 1];
      return lerpRgb(c0, c1, (minutes - m0) / (m1 - m0));
    }
  }
  return INDOOR_KEYS[INDOOR_KEYS.length - 1][1];
}

/** 0 by day, ramping to 1 between 18:30 and 21:00: how strongly lamps glow. */
export function lampStrength(minutes: number): number {
  const on = 18 * 60 + 30;
  const full = 21 * 60;
  if (minutes <= on) return 0;
  return Math.min(1, (minutes - on) / (full - on));
}
