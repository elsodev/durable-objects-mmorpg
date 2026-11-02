// Poses a player strikes with a chat command: /sleep lies down on the ground, /meditate sits
// cross-legged, /sit sits on the ground, /think ponders, /dance shuffles to a tune, /wave and
// /cheer play for a moment, /piss relieves yourself on the spot. A villager who sees that last one
// is not amused. Pure (no clock).
import type { EntityState, Vec2 } from "./types";

export const POSES = ["sleep", "pee", "meditate", "sit", "wave", "cheer", "dance", "think"] as const;
export type PoseCode = (typeof POSES)[number];

export function isPose(v: unknown): v is PoseCode {
  return typeof v === "string" && (POSES as readonly string[]).includes(v);
}

/** The act kind (EntityState.act.k) each pose plays. */
export const POSE_ACT: Readonly<Record<PoseCode, string>> = {
  sleep: "lie",
  pee: "pee",
  meditate: "meditate",
  // Not "sit": that act means a seat (chair, bench) and the server holds the seat for it.
  sit: "sit_ground",
  wave: "wave",
  cheer: "cheer",
  dance: "dance",
  think: "think",
};
export const POSE_ACTS: ReadonlySet<string> = new Set(Object.values(POSE_ACT));

/** How long a pee lasts; lying down lasts until you move. */
export const PEE_MS = 3200;
/** The puddle stays on the ground this long after, then dries up. */
export const PUDDLE_MS = 20_000;
/** A wave and a cheer play this long, then the player stands as before. */
export const WAVE_MS = 2000;
export const CHEER_MS = 1800;
/** Minimum gap between two poses from one player. */
export const POSE_MIN_INTERVAL_MS = 1500;
/** Villagers within this many tiles see you pee, and your hearts with them drop to zero. */
export const PEE_WITNESS_RANGE = 5;

/** Chat command words for each pose ("/sleep", "/piss"...). */
export const POSE_COMMANDS: Readonly<Record<string, PoseCode>> = {
  sleep: "sleep",
  lie: "sleep",
  nap: "sleep",
  piss: "pee",
  pee: "pee",
  meditate: "meditate",
  meditation: "meditate",
  sit: "sit",
  wave: "wave",
  hi: "wave",
  cheer: "cheer",
  yay: "cheer",
  dance: "dance",
  think: "think",
  hmm: "think",
};

/** How long each timed pose plays (by act kind); the rest hold until the player moves. */
const TIMED_ACTS: Readonly<Record<string, number>> = { pee: PEE_MS, wave: WAVE_MS, cheer: CHEER_MS };

/** Is a pose act still showing at `now`? Held poses last until the act is cleared (by moving). */
export function poseShowing(act: EntityState["act"], now: number): boolean {
  if (!act || !POSE_ACTS.has(act.k)) return false;
  const ms = TIMED_ACTS[act.k];
  return ms === undefined || now - act.at < ms;
}

/**
 * Poses a visitor may strike in someone else's home. They are harmless, so all but one: the
 * host's yard is not a toilet.
 */
export function visitorMayPose(pose: PoseCode): boolean {
  return pose !== "pee";
}

/** Why the player can't strike a pose right now, or null when they can. */
export function poseRefusal(e: Pick<EntityState, "moving" | "act">, now: number): string | null {
  if (e.act?.k === "sit") return "Get up first.";
  if (e.moving) return "Stand still first.";
  if (e.act && !POSE_ACTS.has(e.act.k) && now - e.act.at < 900) return "Finish what you're doing first.";
  return null;
}

/** Entity ids of the villagers close enough to see a pose at `at`, nearest first. */
export function witnesses(npcs: readonly { id: string; x: number; y: number }[], at: Vec2, range = PEE_WITNESS_RANGE): string[] {
  return npcs
    .map((n) => ({ id: n.id, d: Math.hypot(n.x - at.x, n.y - at.y) }))
    .filter((n) => n.d <= range)
    .sort((a, b) => a.d - b.d)
    .map((n) => n.id);
}

/** Clears a pose act (the entity moved or swung); other acts are left alone. */
export function endPose(e: EntityState): void {
  if (e.act && POSE_ACTS.has(e.act.k)) e.act = undefined;
}
