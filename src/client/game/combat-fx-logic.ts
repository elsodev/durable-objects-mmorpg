// Pure maths behind combat feedback (no Pixi): the predicted knockback slide, the hurt blink,
// screen shake and how a hit reads as floating text. Unit-tested in test/fe-combat-fx.test.ts.
import { hurtShakeMs, knockbackProgress, KNOCKBACK_HALF_LIFE_MS } from "../../shared/engine/combat";
import type { Vec2 } from "../../shared/types";
import { INTERP_DELAY_MS } from "../state/interp";

/**
 * How far behind the drawn (interpolated) position runs after a hit arrives: the interpolation
 * delay plus about half a tick before the server starts the slide.
 */
export const KB_LAG_MS = INTERP_DELAY_MS + 50;

/**
 * Offset to add to a monster's drawn position `t` ms after its hit arrived, so the slide plays at
 * once instead of a tick or two late: where the prediction is minus where the lagging
 * interpolation shows it. Zero before the hit and once both have caught up.
 */
export function knockbackOffset(t: number, slide: Vec2, lagMs = KB_LAG_MS): Vec2 {
  if (t <= 0) return { x: 0, y: 0 };
  const f = knockbackProgress(t) - knockbackProgress(t - lagMs);
  return { x: slide.x * f, y: slide.y * f };
}

/** Prediction is done once both curves have (almost) arrived. */
export function knockbackDone(t: number, lagMs = KB_LAG_MS): boolean {
  return t > lagMs + KNOCKBACK_HALF_LIFE_MS * 8;
}

/** Hurt blink: 50 ms shown, 50 ms hidden, while invincible. */
export function blinkVisible(t: number, ms: number, period = 100): boolean {
  if (t < 0 || t >= ms) return true;
  return Math.floor(t / (period / 2)) % 2 === 0;
}

/** Screen shake for the hurt player: length (ms) and strength (px) by damage taken. */
export function hurtShake(dmg: number): { ms: number; amp: number } {
  return { ms: hurtShakeMs(dmg), amp: Math.min(6, 2 + dmg * 0.3) };
}

export type DamageKind = "damage" | "crit" | "miss" | "hurt";

/** The floating text a hit shows. */
export function hitLabel(h: { dmg: number; crit?: boolean; miss?: boolean }): { text: string; kind: DamageKind } {
  if (h.miss) return { text: "Miss", kind: "miss" };
  if (h.crit) return { text: `${h.dmg}!`, kind: "crit" };
  return { text: String(h.dmg), kind: "damage" };
}

/** Death squash `t` ms in: x/y scale factors and alpha. */
export function deathSquash(t: number, ms = 300): { sx: number; sy: number; alpha: number } {
  const f = Math.max(0, Math.min(1, t / ms));
  return { sx: 1 + 0.5 * f, sy: 1 - 0.75 * f, alpha: 1 - f };
}

/** Slime crouch before a leap (scale) and the leap's hop height (tiles) `t` ms in. */
export function slimePose(k: string | undefined, t: number): { sx: number; sy: number; lift: number } {
  if (k === "windup" && t >= 0 && t < 800) {
    const f = Math.min(1, t / 250);
    return { sx: 1 + 0.2 * f, sy: 1 - 0.3 * f, lift: 0 };
  }
  if (k === "leap" && t >= 0 && t < 400) {
    const f = t / 400;
    return { sx: 0.9, sy: 1.12, lift: Math.sin(f * Math.PI) * 0.8 };
  }
  return { sx: 1, sy: 1, lift: 0 };
}
