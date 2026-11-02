// Pure helpers for the friendship UI (relationships panel and conversation window hearts).
import { MAX_HEARTS, type BondView } from "../../shared/hearts";

export type HeartState = "full" | "empty";

/** One state per heart slot, MAX_HEARTS long. */
export function heartRow(hearts: number): HeartState[] {
  const n = Math.max(0, Math.min(MAX_HEARTS, Math.floor(hearts)));
  return Array.from({ length: MAX_HEARTS }, (_, i) => (i < n ? "full" : "empty"));
}

/** 0..1 progress into the next heart (1 at max hearts). */
export function heartProgress(v: Pick<BondView, "into" | "need">): number {
  if (v.need <= 0) return 1;
  return Math.max(0, Math.min(1, v.into / v.need));
}

export function progressText(v: BondView): string {
  if (v.need <= 0) return "Best friends!";
  return `${v.into} / ${v.need} to the next heart`;
}

/** Floating text over the villager when points change ("+25 ♥", "-25 ♥"). Null for no change. */
export function gainText(delta: number): string | null {
  if (delta === 0) return null;
  return `${delta > 0 ? "+" : ""}${delta} ♥`;
}

export interface RowMarker {
  key: "talked" | "gift" | "birthday";
  /** Short visible text. */
  text: string;
  /** Tooltip / accessible label. */
  title: string;
  /** Lit (done today / gift given / birthday today) or dim. */
  on: boolean;
}

/** Markers on a Relationships row: talked today, gifts this week (two allowed), birthday. */
export function rowMarkers(v: BondView): RowMarker[] {
  const out: RowMarker[] = [];
  const talked = v.talkedToday === true;
  out.push({ key: "talked", text: "💬", title: talked ? "Talked today" : "Not talked to today", on: talked });
  const week = Math.max(0, v.giftsWeek ?? 0);
  const today = (v.giftsToday ?? 0) > 0;
  out.push({
    key: "gift",
    text: `🎁 ${Math.min(week, 2)}/2`,
    title: today ? `Gift given today (${week} of 2 this week)` : `${week} of 2 gifts this week`,
    on: week > 0,
  });
  if (v.birthday) {
    const bday = v.birthdayToday === true;
    out.push({ key: "birthday", text: bday ? "🎂 Today!" : `🎂 ${v.birthday}`, title: bday ? "It's their birthday today: gifts count eight times!" : `Birthday: ${v.birthday}`, on: bday });
  }
  return out;
}
