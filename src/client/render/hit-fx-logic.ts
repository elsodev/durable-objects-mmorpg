// Pure maths behind hit-fx.ts (no Pixi), so it is unit-testable.
import type { Vec2 } from "../../shared/types";

/** One particle, in tile units and tiles per ms. */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Gravity, tiles per ms². */
  g: number;
  spin: number;
  age: number;
  life: number;
}

/** Horizontal wobble (px before scale) `t` ms into a shake of `ms`, easing out to 0. */
export function shakeOffset(t: number, ms: number, amp: number): number {
  if (t <= 0 || t >= ms) return 0;
  const left = 1 - t / ms;
  return Math.sin((t / ms) * Math.PI * 6) * amp * left;
}

/** A tree's lean (radians) `t` ms into its fall: slow start, quick finish, about 80 degrees. */
export function fallAngle(t: number, ms: number): number {
  const f = Math.min(1, Math.max(0, t / ms));
  return f * f * 1.4;
}

/**
 * A burst from a tile point (centre, `up` tiles above its foot): "chip" flies up and drops fast,
 * "float" (leaves) drifts down slowly.
 */
export function particleBurst(at: Vec2, count: number, style: "chip" | "float", rand: () => number, up = 0.4): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 1.2;
    const speed = style === "chip" ? 0.003 + rand() * 0.003 : 0.0008 + rand() * 0.001;
    out.push({
      x: at.x + 0.5 + (rand() - 0.5) * 0.5,
      y: at.y + 1 - up + (rand() - 0.5) * 0.3,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      g: style === "chip" ? 0.000014 : 0.0000012,
      spin: (rand() - 0.5) * 0.02,
      age: 0,
      life: style === "chip" ? 450 + rand() * 200 : 900 + rand() * 500,
    });
  }
  return out;
}

/**
 * Crack segments ([x0, y0, x1, y1] in source px around the rock's centre) for hit `stage` of
 * `need`: more and longer cracks as the rock gets closer to breaking. Fixed per rock id.
 */
export function crackLines(id: string, stage: number, need: number): [number, number, number, number][] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const rnd = () => {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    return (h % 1000) / 1000;
  };
  const frac = Math.min(1, stage / Math.max(1, need - 1));
  const branches = 1 + Math.round(frac * 3);
  const out: [number, number, number, number][] = [];
  for (let b = 0; b < branches; b++) {
    let x = (rnd() - 0.5) * 4;
    let y = (rnd() - 0.5) * 4;
    const steps = 2 + Math.round(frac * 2);
    let a = rnd() * Math.PI * 2;
    for (let s = 0; s < steps; s++) {
      a += (rnd() - 0.5) * 1.4;
      const len = 2 + rnd() * 2.5;
      const nx = Math.max(-9, Math.min(9, x + Math.cos(a) * len));
      const ny = Math.max(-7, Math.min(7, y + Math.sin(a) * len));
      out.push([Math.round(x), Math.round(y), Math.round(nx), Math.round(ny)]);
      x = nx;
      y = ny;
    }
  }
  return out;
}
