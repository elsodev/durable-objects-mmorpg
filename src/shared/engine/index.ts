// Shared game engine: pure functions used by BOTH the Durable Objects and the browser.
// These signatures are the contract other parts code against.
// No DOM, no Node APIs, no Date.now() inside (pass `now` in). Deterministic given inputs.
//
// Implementation lives in focused modules; this file is the public surface:
//   collision.ts  grid building + body fit test
//   movement.ts   held-direction / point-to-point movement with wall sliding
//   path.ts       A* pathfinding
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
export {
  dist,
  exitAt,
  facingTile,
  facingFor,
  footprint,
  objectRect,
  pointInRect,
  rectsOverlap,
  type Rect,
} from "./geometry";
export { addItem, canAdd, countItem, removeFromSlot, removeItem, COINS } from "./inventory";
export {
  cropDays,
  cropView,
  dayIndex,
  grownDays,
  harvestTile,
  harvestable,
  isFarmable,
  passDay,
  plantTile,
  tillTile,
  waterTile,
  type CropView,
} from "./farming";
export { canPlace, type PlaceResult } from "./placement";
export {
  MONSTER_ATTACK_COOLDOWN_MS,
  MONSTER_ATTACK_RANGE,
  MONSTER_RESPAWN_MS,
  MONSTER_STATS,
  rollDrops,
  stepMonster,
  type MonsterState,
  type MonsterStats,
} from "./monsters";
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
  lampStrength,
  newClock,
  nextMorning,
  type DayPhase,
  type HomeClock,
} from "./homeclock";
export {
  CROW_CHANCE,
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
  harvestYield,
  passOutPenalty,
  protectedByScarecrow,
  regrowDays,
  rollFarmDay,
  rollQuality,
  scarecrowsOf,
  staminaCost,
  type CropLoss,
  type FarmDayResult,
} from "./homeday";
