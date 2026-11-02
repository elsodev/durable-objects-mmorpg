// Pure helpers for the level panel (ui/level-badge.ts): the XP text, the bar's fill steps when XP
// arrives (a level-up runs the bar to full, then refills it from empty) and the gain chip. No DOM.
import { LEVEL_CAP } from "../../shared/leveling";

export interface LevelView {
  level: number;
  xp: number;
  /** XP the level needs (0 at the cap). */
  next: number;
}

/** "120 / 330 XP", or "Max level" at the cap. */
export function xpText(v: LevelView): string {
  if (v.next <= 0 || v.level >= LEVEL_CAP) return "Max level";
  return `${fmt(v.xp)} / ${fmt(v.next)} XP`;
}

/** Bar fill 0..1. */
export function fillOf(v: LevelView): number {
  if (v.next <= 0) return 1;
  return Math.min(1, Math.max(0, v.xp / v.next));
}

/** Tooltip: what the bar means and how far the next level is. */
export function levelTitle(v: LevelView): string {
  if (v.next <= 0 || v.level >= LEVEL_CAP) return `Level ${v.level} (max)`;
  const left = Math.max(0, v.next - v.xp);
  return `Level ${v.level}: ${fmt(left)} XP to level ${v.level + 1}. Earn XP by defeating monsters and shipping crops.`;
}

/**
 * One step of the bar animation: set the fill to `to` (0..1), with or without the transition.
 * Plain gains are one step; a level-up runs to full, snaps back to empty and fills to the new
 * value (once however many levels were gained, so a big grant doesn't strobe).
 */
export interface BarStep {
  to: number;
  animate: boolean;
}

export function barSteps(prev: LevelView | null, next: LevelView, reduced: boolean): BarStep[] {
  const end = fillOf(next);
  if (!prev || reduced) return [{ to: end, animate: false }];
  if (next.level > prev.level) return [{ to: 1, animate: true }, { to: 0, animate: false }, { to: end, animate: true }];
  // Jail penalty (or any loss): drop straight down.
  if (next.level < prev.level || (next.level === prev.level && next.xp < prev.xp)) return [{ to: end, animate: true }];
  return [{ to: end, animate: true }];
}

/** "+12 XP" for the gain chip by the bar (null for nothing). */
export function gainText(gain: number | undefined): string | null {
  return gain && gain > 0 ? `+${fmt(gain)} XP` : null;
}

/** How long (ms) each bar step holds before the next starts. */
export const BAR_STEP_MS = 420;

function fmt(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString("en-US");
}
