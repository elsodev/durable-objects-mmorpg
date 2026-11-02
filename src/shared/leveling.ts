// Player levels: the XP curve, XP from monsters and from the day's shipping, level-ups that carry
// overflow, and the jail penalty. Pure (no clocks, no randomness): the server owns every number,
// clients only draw what it sends.
import { levelStats, MONSTER_STATS, type MonsterType } from "./engine/monsters";

/** Soft max: past it XP stops counting (the bar shows full). */
export const LEVEL_CAP = 50;

/**
 * XP to go from `level` to the next: round(XP_BASE * level ^ XP_POWER). Each level costs more
 * than the last, but only polynomially (an exponential curve would turn the late levels into
 * months of play and players stop caring about the bar). The pace target is "minutes early,
 * an hour or two late": a steady hunter takes about 3 kills a minute, ~22 XP/min on the first
 * floor (slimes 7, bats 8) and ~45 XP/min deeper (rock crabs 15..24). With 25 and 1.6:
 *
 *   level  XP to next  total to reach it   time for this level
 *       1          25                  0   ~1 min
 *       2          76                 25   ~3 min
 *       5         328                476   ~15 min
 *      10         995              3 343   ~45 min (first floor), ~22 min deeper
 *      20       3 017             21 717   ~1 h 10 min
 *      30       5 772             63 738   ~2 h
 *      49      12 655            232 198   ~4 h 30 min (the last level before the cap)
 *
 * Selling adds up to SELL_XP_DAY_MAX a day on top. test/leveling.test.ts pins these numbers.
 */
export const XP_BASE = 25;
export const XP_POWER = 1.6;

export interface LevelState {
  /** 1..LEVEL_CAP. */
  level: number;
  /** XP into the current level, 0..xpToNext(level) - 1 (always 0 at the cap). */
  xp: number;
}

/** XP needed to leave `level` (0 at the cap: there is nothing above). */
export function xpToNext(level: number): number {
  const l = Math.floor(level);
  if (!Number.isFinite(l) || l < 1) return xpToNext(1);
  if (l >= LEVEL_CAP) return 0;
  return Math.round(XP_BASE * Math.pow(l, XP_POWER));
}

/** Total XP from level 1 to reach `level`. */
export function totalXpFor(level: number): number {
  let n = 0;
  for (let l = 1; l < Math.min(LEVEL_CAP, Math.floor(level)); l++) n += xpToNext(l);
  return n;
}

/** Trusted copy of whatever a save holds: absent or bad values read as level 1, 0 XP. */
export function cleanLevel(level: unknown, xp: unknown): LevelState {
  const l = typeof level === "number" && Number.isFinite(level) ? Math.min(LEVEL_CAP, Math.max(1, Math.floor(level))) : 1;
  const need = xpToNext(l);
  const x = typeof xp === "number" && Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  return { level: l, xp: need === 0 ? 0 : Math.min(need - 1, x) };
}

export interface XpGain extends LevelState {
  /** XP actually added (less than asked at the cap). */
  gained: number;
  /** Levels gained by this grant (0 most of the time; can be more than 1). */
  levelsUp: number;
}

/** Adds `amount` XP: every full bar is a level and the overflow carries into the next one. */
export function addXp(state: LevelState, amount: number): XpGain {
  let { level, xp } = cleanLevel(state.level, state.xp);
  const add = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
  let left = add;
  let gained = 0;
  const from = level;
  while (left > 0 && level < LEVEL_CAP) {
    const need = xpToNext(level) - xp;
    if (left < need) {
      xp += left;
      gained += left;
      left = 0;
      break;
    }
    left -= need;
    gained += need;
    level++;
    xp = 0;
  }
  return { level, xp: level >= LEVEL_CAP ? 0 : xp, gained, levelsUp: level - from };
}

/** Going to jail: the progress toward the next level is lost; the level itself is kept. */
export function jailPenalty(state: LevelState): LevelState & { lost: number } {
  const s = cleanLevel(state.level, state.xp);
  return { level: s.level, xp: 0, lost: s.xp };
}

/** "You lost your progress toward level 6." (null when there was nothing to lose). */
export function jailXpText(state: LevelState, lost: number): string | null {
  if (lost <= 0 || state.level >= LEVEL_CAP) return null;
  return `You lost your progress toward level ${state.level + 1}.`;
}

/**
 * XP for defeating a monster, from its stats at its depth level: toughness (hp / 4), bite
 * (damage), armour (2 per point) and speed (2 per tile/s), times 1 + its miss chance (hard to
 * hit), halved. Level 1: slime 7, bat 8, rock crab 15. Deeper floors scale hp, damage and
 * armour, so a depth-4 rock crab pays 24.
 */
export function monsterXp(type: MonsterType, level = 1): number {
  const base = MONSTER_STATS[type];
  if (!base) return 0;
  const s = levelStats(type, level);
  const raw = (s.hp / 4 + s.damage + 2 * s.defense + 2 * base.speed) * (1 + base.missChance);
  return Math.max(1, Math.round(raw * MONSTER_XP_SCALE));
}
export const MONSTER_XP_SCALE = 0.5;

/**
 * XP for everything a player sold in one world day (shop counters and the shipping bin
 * together): SELL_XP_PER_ROOT * sqrt(coins), at most SELL_XP_DAY_MAX. The square root makes each
 * extra coin pay less (100 coins: 30 XP, 1 000: 94, 4 000: 189) and the daily cap means a hoard
 * sold at once, or buying and reselling, is never more than a few minutes of hunting: farming
 * helps, it doesn't replace playing.
 */
export function salesXpTotal(coins: number): number {
  if (!Number.isFinite(coins) || coins <= 0) return 0;
  return Math.min(SELL_XP_DAY_MAX, Math.floor(SELL_XP_PER_ROOT * Math.sqrt(coins)));
}
export const SELL_XP_PER_ROOT = 3;
export const SELL_XP_DAY_MAX = 200;

/** Coins sold so far on world day `day` (shared/calendar.ts worldDay). */
export interface SalesLedger {
  day: number;
  coins: number;
}

/** Trusted copy of a saved ledger (null when absent or broken). */
export function cleanSales(v: unknown): SalesLedger | null {
  if (!v || typeof v !== "object") return null;
  const { day, coins } = v as Record<string, unknown>;
  if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 1e7) return null;
  if (typeof coins !== "number" || !Number.isFinite(coins) || coins < 0) return null;
  return { day, coins: Math.min(1e12, Math.floor(coins)) };
}

/**
 * A sale worth `coins` on world day `day`: the XP it earns (what the day's total is worth now
 * minus what it was worth before) and the ledger after it. A new day starts from zero.
 */
export function saleXp(ledger: SalesLedger | null, day: number, coins: number): { xp: number; ledger: SalesLedger } {
  const before = ledger && ledger.day === day ? ledger.coins : 0;
  const add = Number.isFinite(coins) && coins > 0 ? Math.floor(coins) : 0;
  const after = before + add;
  return { xp: salesXpTotal(after) - salesXpTotal(before), ledger: { day, coins: after } };
}

/**
 * Two copies of a ledger (the home's and a zone's save): the later day wins, and on the same day
 * the larger total, so a stale save can never hand the day's XP out twice.
 */
export function mergeSales(a: SalesLedger | null, b: SalesLedger | null): SalesLedger | null {
  if (!a) return b;
  if (!b) return a;
  if (a.day !== b.day) return a.day > b.day ? a : b;
  return a.coins >= b.coins ? a : b;
}

/** Where XP came from (the client words the float and picks the effect). */
export type XpReason = "kill" | "ship" | "sell" | "jail";

/** "LV 6" style label (the HUD badge and the player card). */
export function levelLabel(level: number): string {
  return `Lv ${cleanLevel(level, 0).level}`;
}

/** Share of the bar filled, 0..1 (1 at the cap). */
export function xpFraction(state: LevelState): number {
  const s = cleanLevel(state.level, state.xp);
  const need = xpToNext(s.level);
  return need === 0 ? 1 : s.xp / need;
}

/**
 * Level progress is written by zones (kills) and the home (shipping, jail). `epoch` goes up by
 * one at every jailing; a save carrying an older epoch was made before the penalty and must not
 * bring the lost XP back.
 */
export function cleanEpoch(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : 0;
}

export type { MonsterType };
