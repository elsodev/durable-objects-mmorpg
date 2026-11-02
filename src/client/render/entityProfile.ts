// Pure per-sprite tuning and math for render/entities.ts (no Pixi imports, so it is unit-testable).
import type { EntityState, Vec2 } from "../../shared/types";

export interface EntityProfile {
  /** Walk cycle frames per second. */
  fps: number;
  /** Keep cycling walk frames while standing still (flapping wings). */
  animateIdle: boolean;
  /** Body lifted above the ground, in source px (flyers); the shadow stays on the ground. */
  hover: number;
  /** Vertical bob amplitude in source px (0 = none). */
  bobAmp: number;
  bobHz: number;
  /** Squash-and-stretch amount for bouncy bodies (0..1). */
  squash: number;
  /** Shadow size relative to a humanoid's. */
  shadow: number;
  /** Click hit box in tiles: width centred on the feet, height above them (includes hover). */
  hitW: number;
  hitH: number;
  /** Top of the visible body above the feet, in source px (before hover/bob). */
  head: number;
}

const HUMANOID: EntityProfile = {
  fps: 9,
  animateIdle: false,
  hover: 0,
  bobAmp: 0,
  bobHz: 0,
  squash: 0,
  shadow: 1,
  hitW: 0.8,
  hitH: 1.55,
  head: 50,
};

const PROFILES: Record<string, EntityProfile> = {
  slime: { ...HUMANOID, fps: 8, bobAmp: 3, bobHz: 2.2, squash: 0.08, shadow: 0.8, hitW: 0.8, hitH: 0.75, head: 24 },
  bat: { ...HUMANOID, fps: 10, animateIdle: true, hover: 22, bobAmp: 3, bobHz: 1.6, shadow: 0.55, hitW: 0.8, hitH: 1.4, head: 22 },
  rock_crab: { ...HUMANOID, fps: 8, bobAmp: 1, bobHz: 4, shadow: 1, hitW: 0.95, hitH: 0.75, head: 24 },
  // Animals: the walk fps matches their speed so paws don't slide (cat 1.5, dog 1.9, hen 1 tile/s).
  cat_ginger: { ...HUMANOID, fps: 8, shadow: 0.6, hitW: 0.9, hitH: 0.75, head: 18 },
  cat_grey: { ...HUMANOID, fps: 8, shadow: 0.6, hitW: 0.9, hitH: 0.75, head: 18 },
  dog_golden: { ...HUMANOID, fps: 9, shadow: 0.85, hitW: 1.1, hitH: 1.05, head: 30 },
  dog_patch: { ...HUMANOID, fps: 9, shadow: 0.85, hitW: 1.1, hitH: 1.05, head: 30 },
  // The husky's upright ears stand a few px taller than the other dogs' floppy ones.
  dog_husky: { ...HUMANOID, fps: 9, shadow: 0.85, hitW: 1.1, hitH: 1.15, head: 34 },
  chicken_white: { ...HUMANOID, fps: 7, shadow: 0.5, hitW: 0.8, hitH: 0.75, head: 18 },
  chicken_brown: { ...HUMANOID, fps: 7, shadow: 0.5, hitW: 0.8, hitH: 0.75, head: 18 },
};

/**
 * Milliseconds per frame of each animal pose: a lazy tail flick sitting, slow breathing asleep,
 * quick wiggles in love, a fast scratch, a playful pounce rhythm, an unhurried sniff.
 */
export const ANIMAL_POSE_MS: Readonly<Record<string, number>> = { rest: 550, nap: 900, love: 220, scratch: 110, play: 230, sniff: 260 };

/** Frame index of a looping animal pose `ageMs` after it started; -1 when `k` is not a pose. */
export function animalPoseFrame(k: string, ageMs: number, frames: number): number {
  const ms = ANIMAL_POSE_MS[k];
  if (!ms || frames <= 0) return -1;
  return Math.floor(Math.max(0, ageMs) / ms) % frames;
}

export function profileFor(sprite: string): EntityProfile {
  return PROFILES[sprite] ?? HUMANOID;
}

/**
 * An animal sprinting off (act "run", RUN_SPEED) cycles its legs faster than its walk, so paws
 * keep up with the ground: about 2.2x for a dog.
 */
export const RUN_FPS_SCALE = 2.2;

/** Walk cycle fps for this entity right now (a running animal plays it faster). */
export function walkFps(p: EntityProfile, s: Pick<EntityState, "kind" | "act">): number {
  return s.kind === "animal" && s.act?.k === "run" ? p.fps * RUN_FPS_SCALE : p.fps;
}

/** Walk frame index for an accumulated animation clock. */
export function walkFrame(clockMs: number, fps: number, frames: number): number {
  if (frames <= 0) return 0;
  return Math.floor((clockMs * fps) / 1000) % frames;
}

/**
 * Bob offset in source px (positive = up). Bouncy bodies (squash > 0) hop while moving
 * (|sin|) and breathe gently while idle; everything else floats sinusoidally.
 */
export function bobOffset(p: EntityProfile, clockMs: number, moving: boolean): number {
  if (p.bobAmp === 0) return 0;
  const s = Math.sin((clockMs / 1000) * p.bobHz * Math.PI * 2);
  if (p.squash > 0) return moving ? Math.abs(s) * p.bobAmp : 0;
  if (p.hover === 0 && !moving) return 0;
  return s * p.bobAmp;
}

/** Vertical stretch factor (1 = none) for squash-and-stretch bodies. */
export function squashFactor(p: EntityProfile, clockMs: number, moving: boolean): number {
  if (p.squash === 0) return 1;
  const hz = moving ? p.bobHz * 2 : p.bobHz * 0.5;
  return 1 + Math.sin((clockMs / 1000) * hz * Math.PI * 2) * p.squash * (moving ? 1 : 0.5);
}

/** Stable 0..1 phase from an id so neighbouring monsters don't bob in sync. */
export function phaseOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/**
 * Hit-test score of a tile point against an entity's box (lower is better), or -1 on a miss.
 * Overlapping sprites resolve to the body whose centre is nearest the pointer.
 */
export function hitScore(s: Pick<EntityState, "x" | "y">, p: EntityProfile, tile: Vec2): number {
  const dx = tile.x - s.x;
  const dy = s.y - tile.y; // height above the feet
  if (Math.abs(dx) > p.hitW / 2 || dy < -0.2 || dy > p.hitH) return -1;
  const cy = dy - p.hitH / 2;
  return dx * dx + cy * cy;
}
