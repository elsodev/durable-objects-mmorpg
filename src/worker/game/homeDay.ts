// End of a home day, as one pure step HomeRoom can call (and tests can drive): soil and crows,
// shipping payout, pass-out penalty, stamina and the next morning's clock.
import type { FarmTile, PlacedObject } from "../../shared/types";
import type { DaySummary } from "../../shared/home";
import {
  catchUpMorning,
  MAX_STAMINA,
  nextMorning,
  PASS_OUT_STAMINA,
  passOutPenalty,
  rollFarmDay,
  type HomeClock,
} from "../../shared/engine";
import { binPayout, type BinEntry } from "./shipping";
import { sanitizeClock } from "./homeState";

/** sleep: in bed. passout: still up at 2:00. away: the day ended while the owner was elsewhere. */
export type DayEndKind = "sleep" | "passout" | "away";

export interface HomeDayState {
  clock: HomeClock;
  farm: FarmTile[];
  objects: readonly PlacedObject[];
  bin: BinEntry[];
}

export interface DayEndResult {
  summary: DaySummary;
  /** Coins to add (payout minus penalty, never below what the player has). */
  coinsDelta: number;
  /** Stamina for the new morning. */
  stamina: number;
}

/** Mutates `st` (farm, bin, clock) and returns the summary; the caller applies coins and stamina. */
export function endHomeDay(
  st: HomeDayState,
  kind: DayEndKind,
  coins: number,
  now: number,
  rand: () => number,
): DayEndResult {
  const ended = st.clock.day;
  const roll = rollFarmDay(st.farm, st.objects, ended, rand);
  st.farm = roll.farm;
  const pay = binPayout(st.bin);
  st.bin = [];
  const penalty = kind === "passout" ? passOutPenalty(coins + pay.total) : 0;
  st.clock = sanitizeClock(kind === "away" ? catchUpMorning(st.clock, now) : nextMorning(st.clock, now), now);
  const summary: DaySummary = {
    day: ended,
    lines: pay.lines,
    total: pay.total,
    crows: roll.eaten,
    reverted: roll.reverted.length,
    grown: roll.grown,
    ...(roll.wilted > 0 ? { wilted: roll.wilted } : {}),
    ...(roll.died.length > 0 ? { died: roll.died } : {}),
    passedOut: kind === "passout",
    penalty,
    ...(kind === "away" ? { away: true } : {}),
  };
  return { summary, coinsDelta: pay.total - penalty, stamina: kind === "passout" ? PASS_OUT_STAMINA : MAX_STAMINA };
}
