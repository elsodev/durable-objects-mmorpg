// Pure parts of the chat-command poses (render/poses.ts): where the pieces go and which frame
// shows when. Offsets are source pixels relative to the feet point (multiply by SCALE).
import { PEE_MS, PUDDLE_MS } from "../../shared/poses";
import type { Facing, Vec2 } from "../../shared/types";

/**
 * Lying down: the back-view standing frame turned a quarter left, so the head lies to the west.
 * A standing LPC frame is ~50 px tall above its feet point, so turned on its side the body runs
 * from about 49 px left of the feet to the feet; shifting it right by half of that centres it on
 * the player's tile, and up a little keeps it on their tile rather than the one below.
 */
export const LIE = {
  rotation: -Math.PI / 2,
  body: { x: 24, y: -6 },
  /** Quilt from the shoulders to the feet, pillow under the head (centres). */
  quilt: { x: 9, y: -6 },
  pillow: { x: -22, y: -6 },
  /** Where the Z's start (above the head) and how far they rise. */
  zzz: { x: -16, y: -24, rise: 22 },
  /** The name tag sits just above the lying body. */
  head: 26,
} as const;

export const ZZZ_EVERY_MS = 900;
export const ZZZ_LIFE_MS = 1800;

/** One rising Z, `age` ms after it appeared: offset from the start, frame (small to big) and alpha. */
export function zzzAt(age: number, index: number): { dx: number; dy: number; frame: number; alpha: number } | null {
  if (age < 0 || age >= ZZZ_LIFE_MS) return null;
  const f = age / ZZZ_LIFE_MS;
  return {
    dx: Math.round(Math.sin(f * Math.PI * 2 + index) * 3 + f * 6),
    dy: -Math.round(f * LIE.zzz.rise),
    frame: Math.min(2, Math.floor(f * 3)),
    alpha: f < 0.7 ? 1 : 1 - (f - 0.7) / 0.3,
  };
}

/**
 * Crotch height above the feet point in source px. LPC legs run from about y 44 to the feet at
 * y 60 on every adult and teen body, so the stream starts there, not at the hands or chest.
 */
export const HIP_Y = -17;

/** Pee stream placement by facing; null facing up (the body hides it). `flip` mirrors the side arc. */
export function streamPlacement(facing: Facing): { kind: "side" | "front"; x: number; y: number; flip: boolean; front: boolean } | null {
  switch (facing) {
    case "right":
      return { kind: "side", x: 7, y: HIP_Y, flip: false, front: true };
    case "left":
      return { kind: "side", x: -7, y: HIP_Y, flip: true, front: true };
    case "down":
      return { kind: "front", x: 0, y: HIP_Y + 1, flip: false, front: true };
    case "up":
      return null;
  }
}

/** Where the puddle forms, from the feet point. */
export function puddleOffset(facing: Facing): Vec2 {
  switch (facing) {
    case "right":
      return { x: 20, y: -1 };
    case "left":
      return { x: -20, y: -1 };
    case "down":
      return { x: 0, y: 3 };
    case "up":
      return { x: 0, y: -8 };
  }
}

/** The stream's height in source px is stretched to reach the ground from the hip. */
export const STREAM_STRETCH = 1.1;
export const STREAM_FRAME_MS = 90;

/** Puddle frame (0 small .. 2 full) and alpha `age` ms after the pee started; null once dried up. */
export function puddleAt(age: number): { frame: number; alpha: number } | null {
  if (age < 0) return { frame: 0, alpha: 1 };
  const total = PEE_MS + PUDDLE_MS;
  if (age >= total) return null;
  const frame = age < PEE_MS * 0.3 ? 0 : age < PEE_MS * 0.7 ? 1 : 2;
  const fadeFrom = total - 3000;
  return { frame, alpha: age < fadeFrom ? 0.9 : 0.9 * (1 - (age - fadeFrom) / 3000) };
}

/**
 * Meditating: the character's own cross-legged frame (generator sit frame 1), facing the viewer.
 * The head sits about 14 px lower than standing, so the name tag drops with it. A soft glow
 * pulses under them and light motes drift up past the shoulders.
 */
export const MEDITATE = {
  /** Name tag height above the feet point, in source px (standing is 50). */
  head: 36,
  /** Glow centre, from the feet point. */
  glow: { x: 0, y: -2 },
  /** One full breath (glow pulse and the body's slight rise). */
  breathMs: 3600,
  /** Motes spawn around the body within this half width, start this high and rise this far. */
  mote: { halfWidth: 13, y: -12, rise: 30 },
} as const;

export const MOTE_EVERY_MS = 600;
const MOTE_LANES = [-1, 0.7, -0.7, 1] as const;
export const MOTE_LIFE_MS = 2400;

/** Glow alpha and body lift (source px) `age` ms into meditating: a slow in-and-out breath. */
export function breathAt(age: number): { glow: number; lift: number } {
  const f = (Math.sin((Math.max(0, age) / MEDITATE.breathMs) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
  return { glow: 0.55 + 0.4 * f, lift: Math.round(f) };
}

/**
 * The `index`-th light mote, `age` ms after it appeared: offset from the feet point (source px),
 * frame (small to big and back) and alpha; null once it has faded. Each mote takes a fixed side
 * from its index, so the pattern stays the same for everyone watching.
 */
export function moteAt(age: number, index: number): { x: number; y: number; frame: number; alpha: number } | null {
  if (age < 0 || age >= MOTE_LIFE_MS) return null;
  const f = age / MOTE_LIFE_MS;
  // Four lanes beside the body, never over the face.
  const side = MOTE_LANES[(index * 3) % MOTE_LANES.length]!;
  const x = Math.round(side * MEDITATE.mote.halfWidth + Math.sin(f * Math.PI * 2 + index) * 2);
  const y = Math.round(MEDITATE.mote.y - f * MEDITATE.mote.rise);
  const frame = f < 0.25 ? 0 : f < 0.7 ? 1 : 2;
  const alpha = f < 0.15 ? f / 0.15 : f > 0.75 ? (1 - f) / 0.25 : 1;
  return { x, y, frame, alpha };
}

/**
 * Climbing a ladder (act "climb_down" / "climb_up", shared/climb.ts) uses the look's own
 * back-view walk frames, so every body, outfit and villager climbs without new art: hands and
 * feet alternate as the walk cycle plays, a step every CLIMB.stepMs with a one-pixel bob.
 * Down: the body sinks into the hole and is cut off at the hole's near rim (`clipY` below the
 * feet point it started from), then fades. Up: it rises up the ladder on the wall and fades.
 */
export const CLIMB = {
  stepMs: 110,
  /** Down: how far the body sinks (a standing body is ~50 px tall) and where the rim cuts it. */
  sink: 48,
  clipY: 3,
  /** Up: how far it rises up the ladder. */
  rise: 30,
  /** Standing name-tag height (source px above the feet). */
  head: 50,
} as const;

export interface ClimbFrame {
  /** Index into walk.up, skipping the standing frame 0. */
  frame: number;
  /** Body offset from the feet point, source px (+ down). */
  dy: number;
  alpha: number;
  /** Down only: hide the body below this line (source px from the feet point). */
  clipY: number | null;
  /** Name tag height above the feet point, source px. */
  head: number;
}

/** The climb `age` ms in (`ms` long in all) with a walk cycle of `frames` frames. */
export function climbAt(kind: "climb_down" | "climb_up", age: number, ms: number, frames: number): ClimbFrame {
  const f = Math.min(1, Math.max(0, age / ms));
  const steps = Math.max(1, frames - 1);
  const step = Math.floor(Math.max(0, age) / CLIMB.stepMs);
  const frame = frames > 1 ? 1 + (step % steps) : 0;
  const bob = step % 2;
  if (kind === "climb_down") {
    // Slow at the top, then down hand over hand.
    const dy = Math.round(CLIMB.sink * f * f) + bob;
    return { frame, dy, alpha: f < 0.85 ? 1 : Math.max(0, Math.round((1 - (f - 0.85) / 0.15) * 100) / 100), clipY: CLIMB.clipY, head: Math.max(8, CLIMB.head - dy) };
  }
  const dy = -Math.round(CLIMB.rise * f) - bob;
  return { frame, dy, alpha: f < 0.7 ? 1 : Math.max(0, Math.round((1 - (f - 0.7) / 0.3) * 100) / 100), clipY: null, head: CLIMB.head - dy };
}

/**
 * Sitting on the ground (/sit): the look's own generator "sit" frame 0, one knee up and a hand on
 * the ground behind, for the way they face. The frame keeps the standing feet anchor, so the body
 * already rests on its tile and the shadow stays put; only the head is lower. Name tag heights
 * (source px above the feet) follow each facing's measured head top on every body type, plus the
 * same few px of room the standing tag gets.
 */
export const SIT_GROUND = {
  head: { up: 39, left: 41, down: 48, right: 40 } as Readonly<Record<Facing, number>>,
} as const;

/** Waving: hand raised, then arm out, a step every WAVE_STEP_MS (generator slash frames 4 and 5). */
export const WAVE_STEP_MS = 220;

/** Which of the two wave frames shows `age` ms in: 0 (hand up) or 1 (arm out). */
export function waveFrame(age: number): 0 | 1 {
  return Math.floor(Math.max(0, age) / WAVE_STEP_MS) % 2 === 0 ? 0 : 1;
}

/**
 * Cheering: hops in place with a hand thrown up (the wave's raised-hand frame), and sparkles pop
 * around the head. Lift is in source px above the ground.
 */
export const CHEER = {
  hopMs: 450,
  hopHeight: 6,
  /** Sparkle spots beside the head and shoulders (feet-relative source px), below the name tag. */
  sparkles: [
    { x: -17, y: -40 },
    { x: 17, y: -32 },
    { x: -16, y: -26 },
    { x: 18, y: -44 },
  ] as readonly Vec2[],
  sparkleEveryMs: 300,
  sparkleLifeMs: 600,
} as const;

/** Height of the hop `age` ms into a cheer; on the ground between hops. */
export function cheerLift(age: number): number {
  if (age < 0) return 0;
  const phase = (age % CHEER.hopMs) / CHEER.hopMs;
  // Airborne for the first 70% of each hop, a short crouch on landing.
  return phase < 0.7 ? Math.round(Math.sin((phase / 0.7) * Math.PI) * CHEER.hopHeight) : 0;
}

/** The `index`-th sparkle `age` ms after it appeared: where, which frame, or null once gone. */
export function sparkleAt(age: number, index: number): { x: number; y: number; frame: number } | null {
  if (age < 0 || age >= CHEER.sparkleLifeMs) return null;
  const f = age / CHEER.sparkleLifeMs;
  const spot = CHEER.sparkles[index % CHEER.sparkles.length]!;
  return { x: spot.x, y: spot.y, frame: f < 0.3 ? 0 : f < 0.7 ? 1 : 2 };
}

/**
 * Dancing: a side-to-side shuffle on the beat built from the look's own walk frames (left, front,
 * right, front, each beat a step on alternating feet) with a bounce, and music notes drifting up.
 */
export const DANCE = {
  beatMs: 340,
  steps: ["left", "down", "right", "down"] as readonly Facing[],
  /** Walk frames used for a step (alternating feet); frame 0 is standing. */
  stepFrames: [2, 6] as const,
  /** Notes start beside the head (clear of the name tag) and drift up and outwards. */
  note: { x: 17, y: -34, rise: 24 },
  noteEveryMs: 680,
  noteLifeMs: 1600,
} as const;

/** The dance pose `age` ms in: which way the body turns, which walk frame and how high it bounces. */
export function danceAt(age: number, walkFrames: number): { facing: Facing; frame: number; lift: number } {
  const t = Math.max(0, age);
  const beat = Math.floor(t / DANCE.beatMs);
  const facing = DANCE.steps[beat % DANCE.steps.length]!;
  const want = DANCE.stepFrames[beat % 2]!;
  const frame = want < walkFrames ? want : 0;
  // Up on the off-beat, down on the beat.
  const lift = (t % DANCE.beatMs) < DANCE.beatMs / 2 ? 0 : 1;
  return { facing, frame, lift };
}

/** The `index`-th note `age` ms after it appeared: offset, which note and alpha; null once gone. */
export function noteAt(age: number, index: number): { x: number; y: number; frame: number; alpha: number } | null {
  if (age < 0 || age >= DANCE.noteLifeMs) return null;
  const f = age / DANCE.noteLifeMs;
  const side = index % 2 === 0 ? 1 : -1;
  return {
    x: Math.round(side * (DANCE.note.x + f * 4) + Math.sin(f * Math.PI * 2) * 2),
    y: Math.round(DANCE.note.y - f * DANCE.note.rise),
    frame: index % 2,
    alpha: f < 0.7 ? 1 : Math.round((1 - (f - 0.7) / 0.3) * 100) / 100,
  };
}

/**
 * Thinking: the hand-at-chin frame (generator thrust frame 7) facing the viewer, with a thought
 * bubble above and right of the name tag whose dots fill in one by one, then stay a while.
 */
export const THINK = {
  /** Bubble's bottom-left corner (its tail end) from the feet point. */
  bubble: { x: 4, y: -58 },
  dotMs: 450,
  loopMs: 2600,
} as const;

/** Thought-bubble frame `age` ms in: 0 (one dot), 1 (two) or 2 (three, held to the end of the loop). */
export function thinkFrame(age: number): 0 | 1 | 2 {
  const t = Math.max(0, age) % THINK.loopMs;
  return t < THINK.dotMs ? 0 : t < THINK.dotMs * 2 ? 1 : 2;
}
