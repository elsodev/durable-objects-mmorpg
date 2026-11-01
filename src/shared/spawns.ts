// Spawn tuning for monsters and forage in the shared zones. Data only; the rules that read it
// live in engine/spawning.ts. Tune numbers here.
import type { ItemId, SharedZoneId } from "./types";

/**
 * One monster spawn group (a MapData.monsters entry). The live target is
 * `base + ceil(perPlayer * (playersNear - 1))`, capped at `max`; a free slot refills after
 * `respawnMs / sqrt(playersNear)`, on a tile at least `minPlayerDist` from every player.
 */
export interface SpawnTuning {
  base: number;
  perPlayer: number;
  max: number;
  respawnMs: number;
  minPlayerDist: number;
}

/** Players this far beyond a group's radius still count toward its size. */
export const SPAWN_NEAR_MARGIN = 12;
/** How often spawn groups top up. */
export const SPAWN_CHECK_MS = 2000;
/** Tries per spawn when looking for a tile away from players. */
export const SPAWN_TRIES = 12;
/** Hard cap per zone, whatever the groups say. */
export const ZONE_MONSTER_CAP = 60;
/** A monster above its group's target that has been out of combat this long goes away. */
export const DESPAWN_IDLE_MS = 30_000;

const riversideCamp: SpawnTuning = { base: 2, perPlayer: 0.5, max: 4, respawnMs: 45_000, minPlayerDist: 6 };
const riversideSmall: SpawnTuning = { base: 1, perPlayer: 0.34, max: 2, respawnMs: 60_000, minPlayerDist: 5 };

/**
 * Per zone, in the order of the map's `monsters` list. Floors with several groups split the
 * floor's totals between them: caves floor 1 is 5 base / +1.5 per player / 14 max, floor 2 is
 * 4 / 1.2 / 12 and floor 3 is 5 / 1.5 / 16.
 */
export const SPAWN_TUNING: Partial<Record<SharedZoneId, SpawnTuning[]>> = {
  riverside: [riversideCamp, riversideCamp, riversideSmall, riversideSmall],
  caves: [
    // floor 1 slimes (r4, r3)
    { base: 3, perPlayer: 0.9, max: 8, respawnMs: 30_000, minPlayerDist: 6 },
    { base: 2, perPlayer: 0.6, max: 6, respawnMs: 30_000, minPlayerDist: 6 },
    // floor 2 bats (r5, r4): they fly in, so they appear further away
    { base: 2, perPlayer: 0.7, max: 7, respawnMs: 35_000, minPlayerDist: 8 },
    { base: 2, perPlayer: 0.5, max: 5, respawnMs: 35_000, minPlayerDist: 8 },
    // floor 3 rock crabs (three groups)
    { base: 2, perPlayer: 0.6, max: 6, respawnMs: 40_000, minPlayerDist: 5 },
    { base: 2, perPlayer: 0.6, max: 6, respawnMs: 40_000, minPlayerDist: 5 },
    { base: 1, perPlayer: 0.3, max: 4, respawnMs: 40_000, minPlayerDist: 5 },
  ],
};

/** Tuning for a group without a table row: a fixed camp of `count` on a 30 s refill. */
export function defaultTuning(count: number): SpawnTuning {
  return { base: count, perPlayer: 0, max: count, respawnMs: 30_000, minPlayerDist: 5 };
}

export interface ForageRule {
  /** Cap = base + perPlayer * players in the zone, at most max. */
  base: number;
  perPlayer: number;
  max: number;
  /** How often the zone tops forage back up to the cap. */
  refillMs: number;
  /** Forage grows within this many tiles of a prop of type `near`. */
  near: string;
  nearRadius: number;
  minPlayerDist: number;
  table: { item: ItemId; weight: number }[];
}

export const FORAGE_RULES: Partial<Record<SharedZoneId, ForageRule>> = {
  riverside: {
    base: 6,
    perPlayer: 2,
    max: 14,
    refillMs: 5 * 60_000,
    near: "herb_patch",
    nearRadius: 2,
    minPlayerDist: 4,
    table: [
      { item: "herb_mint", weight: 3 },
      { item: "mushroom", weight: 2 },
    ],
  },
};

/** Ground drops (bag was full) belong to their player this long, then vanish. */
export const GROUND_DROP_MS = 3 * 60_000;
/** You pick up your own ground drop by walking this close to it. */
export const PICKUP_RADIUS = 0.7;
/** Forage can be picked from this far away (tiles, feet to item). */
export const FORAGE_REACH = 1.6;
/** Interact target prefix for forage on the ground ("ground:<id>"). */
export const GROUND_TARGET_PREFIX = "ground:";
