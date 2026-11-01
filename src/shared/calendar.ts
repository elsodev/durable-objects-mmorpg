// World calendar shared by every Durable Object and the client. Public zones have no clock of
// their own, so the date comes straight from UTC: one world day is one real UTC day, 28 days make
// a season, four seasons a year, and the weekday is the real UTC weekday. Because 28 is a multiple
// of 7, a given day of the month always falls on the same weekday (day 1 is a Monday).
//
// Homes keep their own day counter (shared/engine/homeclock.ts); friendship, birthdays, weekdays
// and seasons always use this calendar, so every room agrees on what "today" is.

export const WORLD_DAY_MS = 86_400_000;
export const DAYS_PER_SEASON = 28;
export const SEASONS = ["spring", "summer", "fall", "winter"] as const;
export type Season = (typeof SEASONS)[number];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;

/** Day index of the first day of year 1, spring 1 (2026-01-05, a Monday). */
const EPOCH_DAY = Math.floor(Date.UTC(2026, 0, 5) / WORLD_DAY_MS);
/** 1970-01-01 was a Thursday. */
const EPOCH_WEEKDAY = 4;

export interface WorldDate {
  /** Whole UTC days since 1970-01-01: the key every daily rule uses. */
  dayIndex: number;
  /** Sunday-based week number (changes at the start of each Sunday). */
  week: number;
  year: number;
  season: Season;
  /** 1..28 */
  day: number;
  weekday: Weekday;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** The world day index for a time. The single day key for bonds, gifts, decay and weekdays. */
export function worldDay(nowMs: number): number {
  return Math.floor(nowMs / WORLD_DAY_MS);
}

/** Sunday-based week number for a day index. */
export function weekOf(dayIndex: number): number {
  return Math.floor((dayIndex + EPOCH_WEEKDAY) / 7);
}

export function dateOfDay(dayIndex: number): WorldDate {
  const d = dayIndex - EPOCH_DAY;
  return {
    dayIndex,
    week: weekOf(dayIndex),
    year: Math.floor(d / DAYS_PER_YEAR) + 1,
    season: SEASONS[Math.floor(mod(d, DAYS_PER_YEAR) / DAYS_PER_SEASON)]!,
    day: mod(d, DAYS_PER_SEASON) + 1,
    weekday: WEEKDAYS[mod(dayIndex + EPOCH_WEEKDAY, 7)]!,
  };
}

export function worldDate(nowMs: number): WorldDate {
  return dateOfDay(worldDay(nowMs));
}

/** UTC hour of day (0..23), the hour NPC schedules in public zones use. */
export function worldHour(nowMs: number): number {
  return Math.floor(mod(nowMs, WORLD_DAY_MS) / 3_600_000);
}

export interface Birthday {
  season: Season;
  /** 1..28 */
  day: number;
}

export function isBirthday(b: Birthday | undefined, date: WorldDate): boolean {
  return !!b && b.season === date.season && b.day === date.day;
}

const SEASON_NAME: Record<Season, string> = { spring: "Spring", summer: "Summer", fall: "Fall", winter: "Winter" };

/** "Fri, Spring 5" */
export function formatWorldDate(date: WorldDate): string {
  return `${date.weekday}, ${SEASON_NAME[date.season]} ${date.day}`;
}

export function formatBirthday(b: Birthday): string {
  return `${SEASON_NAME[b.season]} ${b.day}`;
}
