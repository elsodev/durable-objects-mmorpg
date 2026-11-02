// Timeline of the level-up burst over a character (drawn by render/effects.ts): two golden rings
// spreading from the feet, a soft column of light, and "LEVEL UP!" with the new level rising off
// the head and fading. Pure: t is 0..1 of LEVELUP_LIFE. Reduced motion keeps everything in place
// and only fades the glow and the sign in and out.

/** Seconds the whole burst lasts. */
export const LEVELUP_LIFE = 2.4;
/** Second ring starts this far into the life (0..1). */
export const LEVELUP_RING2_DELAY = 0.12;
/** Sign start/end height above the feet (tiles; characters are ~2 tiles tall). */
export const SIGN_FROM = -2.35;
export const SIGN_RISE = 0.9;

export interface LevelUpFrame {
  /** Ring radius (tiles, horizontal; drawn as a flat ellipse) and alpha; alpha 0 hides it. */
  rings: { radius: number; alpha: number }[];
  /** Light column alpha (0..1) and height (tiles). */
  column: { alpha: number; height: number };
  /** Sign offset from the feet (tiles, negative is up), alpha and scale. */
  sign: { dy: number; alpha: number; scale: number };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (v: number) => 1 - (1 - v) * (1 - v);

function ring(t: number): { radius: number; alpha: number } {
  if (t <= 0 || t >= 1) return { radius: 0, alpha: 0 };
  return { radius: 0.35 + 1.15 * easeOut(t), alpha: 0.9 * (1 - t) };
}

export function levelUpFrame(t: number, reduced: boolean): LevelUpFrame {
  const u = clamp01(t);
  // Sign: pops in over the first 10%, holds, fades over the last 30%.
  const signAlpha = clamp01(u < 0.1 ? u / 0.1 : u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1);
  if (reduced) {
    return {
      rings: [],
      column: { alpha: 0.35 * signAlpha, height: 2.4 },
      sign: { dy: SIGN_FROM, alpha: signAlpha, scale: 1 },
    };
  }
  const pop = u < 0.08 ? 0.6 + (u / 0.08) * 0.6 : u < 0.16 ? 1.2 - ((u - 0.08) / 0.08) * 0.2 : 1;
  const ringSpan = 0.55;
  return {
    rings: [ring(u / ringSpan), ring((u - LEVELUP_RING2_DELAY) / ringSpan)],
    column: {
      // Rises fast, glows, then thins out by 60%.
      alpha: u < 0.12 ? (u / 0.12) * 0.55 : u < 0.6 ? 0.55 * (1 - (u - 0.12) / 0.48) : 0,
      height: 1.2 + 1.6 * easeOut(clamp01(u / 0.25)),
    },
    sign: { dy: SIGN_FROM - SIGN_RISE * easeOut(u), alpha: signAlpha, scale: pop },
  };
}

/** The two lines of the sign. */
export function levelUpLines(level: number): [string, string] {
  const l = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  return ["LEVEL UP!", `Lv ${l}`];
}
