// Shared game engine: pure functions used by BOTH the Durable Objects and the browser.
// These signatures are the contract other parts code against.
// No DOM, no Node APIs, no Date.now() inside (pass `now` in). Deterministic given inputs.
//
// Implementation lives in focused modules; this file is the public surface:
//   collision.ts  grid building + body fit test
//   movement.ts   held-direction / point-to-point movement with wall sliding
//   path.ts       A* pathfinding
//   crowd.ts      other characters as soft obstacles
//   geometry.ts   footprints, facing, exits, rect helpers
//   inventory.ts  stacking add/remove/count
//   farming.ts    day index, crop growth, tile mutations
//   placement.ts  canPlace for home furniture
//   monsters.ts   monster stats + AI tick

/** Walk speed in tiles per second. */
export const PLAYER_SPEED = 4.5;
export const NPC_SPEED = 2;

export { buildCollision, setBlocked, canStand, isBlocked, type CollisionGrid } from "./collision";
export { moveGoal, stepDirection, stepToward, ARRIVE_DIST, type MoveResult } from "./movement";
export { findPath, MAX_EXPANSIONS } from "./path";
export { BODY_GAP, bumps, withPeople } from "./crowd";
export {
  dist,
  exitAt,
  facingTile,
  facingFor,
  facingToTile,
  footprint,
  objectRect,
  pointInRect,
  rectsOverlap,
  type Rect,
} from "./geometry";
export { addItem, canAdd, countItem, gridOf, moveSlot, removeFromSlot, removeItem, sameStack, COINS, type MoveResult as SlotMoveResult } from "./inventory";
export {
  CROP_DEATH_DAYS,
  STAGE_NAMES,
  clearDeadCrop,
  cropDays,
  cropLook,
  cropView,
  growthStage,
  dayIndex,
  grownDays,
  harvestTile,
  harvestable,
  isFarmable,
  isWaterSource,
  passDay,
  plantTile,
  tillTile,
  waterTile,
  type CropLook,
  type CropView,
  type GrowthStage,
} from "./farming";
export { canPlace, wallFaceRow, MAX_WALL_DROP, type PlaceResult } from "./placement";
export {
  MONSTER_AI,
  MONSTER_LEVEL_SCALE,
  MONSTER_STATS,
  levelStats,
  newMonster,
  provoke,
  rollMonsterDrops,
  stepMonster,
  type MonsterMode,
  type MonsterState,
  type MonsterStats,
  type MonsterType,
} from "./monsters";
export * from "./combat";
export * from "./spawning";
export {
  GAME_HOUR_MS,
  GAME_MINUTE_MS,
  DAY_START_MIN,
  DAY_END_MIN,
  HOME_DAY_MS,
  catchUpMorning,
  clockAtMinutes,
  clockMinutes,
  dayEndsAt,
  dayOver,
  dayPhase,
  daylightTint,
  farmNow,
  formatClock,
  interiorTint,
  lampStrength,
  newClock,
  nextMorning,
  type DayPhase,
  type HomeClock,
} from "./homeclock";
export {
  CROW_CHANCE,
  CROW_FULL_CROPS,
  MAX_STAMINA,
  MAX_WATER,
  PASS_OUT_STAMINA,
  SCARECROW_RADIUS,
  TOOL_STAMINA,
  clampStamina,
  clampWater,
  crowTargets,
  eatGain,
  harvestCrop,
  passOutPenalty,
  protectedByScarecrow,
  regrowDays,
  rollFarmDay,
  scarecrowsOf,
  staminaCost,
  type CropLoss,
  type FarmDayResult,
} from "./homeday";
export {
  CROP_YIELD,
  cropYield,
  farmingLevel,
  fertilizerGoldBonus,
  harvestRand,
  qualityOdds,
  rockRand,
  rollCount,
  rollHarvest,
  rollQuality,
  type CropYield,
  type HarvestRoll,
  type Quality,
} from "./harvest";
export { SWING_TOTAL_MS, TOOL_TIMING, impactDelayMs, toolTiming, type ToolTiming } from "./toolTiming";
