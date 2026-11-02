// Shared game engine: pure functions used by BOTH the Durable Objects and the browser.
// These signatures are the contract other parts code against.
// No DOM, no Node APIs, no Date.now() inside (pass `now` in). Deterministic given inputs.
//
// Implementation lives in focused modules; this file is the public surface:
//   collision.ts  grid building + body fit test
//   movement.ts   held-direction / point-to-point movement with wall sliding
//   pace.ts       walk / dash / worn-out speeds, dash stamina drain, the worn-out farm lock
//   path.ts       A* pathfinding
//   crowd.ts      other characters as soft obstacles
//   geometry.ts   footprints, facing, exits, rect helpers
//   inventory.ts  stacking add/remove/count
//   farming.ts    day index, crop growth, tile mutations
//   placement.ts  canPlace for home furniture
//   storage.ts    fridge (storage furniture) slots: put in / take out
//   monsters.ts   monster stats + AI tick

export const NPC_SPEED = 2;
export {
  DASH_DRAIN_MS,
  DASH_MULT,
  DASH_SPEED,
  EXHAUSTED_NOTICE,
  FARM_LOCKED_NOTICE,
  NO_DASH_NOTICE,
  PLAYER_SPEED,
  RESTED_EATING_NOTICE,
  TIRED_MULT,
  TIRED_SPEED,
  drainDash,
  farmLocked,
  isExhausted,
  paceSpeed,
  pathSpeed,
  pickPace,
  type DashDrain,
  type Pace,
} from "./pace";

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
export { canPlace, isRug, wallFaceRow, MAX_WALL_DROP, type PlaceResult } from "./placement";
export {
  emptyStorage,
  isStorageEmpty,
  putIntoStorage,
  roomIn,
  sanitizeStorage,
  storageAccepts,
  storageOf,
  takeFromStorage,
  type StorageSlots,
  type StoreResult,
} from "./storage";
export {
  MONSTER_AI,
  MONSTER_LEVEL_SCALE,
  MONSTER_STATS,
  levelStats,
  newMonster,
  provoke,
  rollMonsterDrops,
  rollRareFurniture,
  stepMonster,
  type MonsterMode,
  type MonsterState,
  type MonsterStats,
  type MonsterType,
} from "./monsters";
export * from "./combat";
export { DROP_AHEAD, dropSpot, takeForDrop } from "./drop";
export { compareStacks, sortBag, SORT_ORDER } from "./sortBag";
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
