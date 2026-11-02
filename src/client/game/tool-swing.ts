// Tool use on the client (pure, no Pixi/DOM): your swing plays the moment you press use, facing
// the target tile. Its effect (predicted soil, chips, splash) lands at the impact frame from the
// shared toolTiming table, and input stays locked for the whole swing. The server still decides
// what happens; its echo of your own tool act is ignored so the swing doesn't play twice.
import { boulderAt } from "../../shared/engine/wrongTool";
import {
  classifyTarget,
  facingToward,
  isSwingTool,
  resolveToolUse,
  toolKeyOf,
  treeSize,
  type ToolOutcome,
  type ToolTarget,
} from "../../shared/engine/toolRules";
import { isFarmable, pointInRect } from "../../shared/engine";
import { SWING_TOTAL_MS, toolTiming } from "../../shared/engine/toolTiming";
import { Ground, type EntityState, type Facing, type FarmTile, type ItemId, type MapData, type PlacedObject, type RockOre, type Vec2 } from "../../shared/types";

type Act = NonNullable<EntityState["act"]>;

/** Act kinds that only ever come from a tool swing (see home.ts / zone.ts onUse). */
const TOOL_ACT_KINDS: ReadonlySet<string> = new Set(["hoe", "water", "pickaxe", "axe", "sword", "fish"]);

export interface LocalSwing {
  act: Act;
  facing: Facing;
  /** performance.now() clock. */
  startMs: number;
  /** When the tool lands: the effect shows then, not on press. */
  impactMs: number;
  endMs: number;
  lockUntil: number;
  /** Set once the impact has been played (see takeImpact). */
  impacted: boolean;
}

/**
 * Starts your own swing of `item` at `tile`, or null when the item doesn't swing (seeds, crops).
 * `serverAt` (server clock) keys the act like the server's would be; `nowMs` is performance.now().
 */
export function startSwing(
  item: ItemId | null | undefined,
  me: Vec2 & { facing: Facing },
  tile: Vec2,
  nowMs: number,
  serverAt: number,
): LocalSwing | null {
  const key = toolKeyOf(item);
  if (!item || !isSwingTool(key)) return null;
  const facing = facingToward(me, tile, me.facing);
  const timing = toolTiming(key, facing) ?? { impactMs: 0, totalMs: SWING_TOTAL_MS };
  return {
    act: { k: key, at: serverAt, item },
    facing,
    startMs: nowMs,
    impactMs: nowMs + timing.impactMs,
    endMs: nowMs + timing.totalMs,
    lockUntil: nowMs + timing.totalMs,
    impacted: false,
  };
}

/** True exactly once per swing: the first call at or after its impact. */
export function takeImpact(s: LocalSwing | null, nowMs: number): boolean {
  if (!s || s.impacted || nowMs < s.impactMs) return false;
  s.impacted = true;
  return true;
}

/** performance.now() time your pending swing lands, or null when none is pending. */
export function pendingImpactMs(s: LocalSwing | null): number | null {
  return s && !s.impacted ? s.impactMs : null;
}

export function swingLocked(s: LocalSwing | null, nowMs: number): boolean {
  return !!s && nowMs < s.lockUntil;
}

export function swingPlaying(s: LocalSwing | null, nowMs: number): boolean {
  return !!s && nowMs < s.endMs;
}

/**
 * The act to draw on your own entity: your local swing, unless the server has something newer
 * that isn't a tool swing (harvest, plant, eat, hurt...). The server's echo of your tool swings is
 * dropped; keeping the last local act afterwards stops an old server act from replaying.
 */
export function effectiveAct(server: Act | undefined, local: Act | null): Act | undefined {
  const s = server && !TOOL_ACT_KINDS.has(server.k) ? server : undefined;
  if (!local) return s;
  if (!s) return local;
  return s.at > local.at ? s : local;
}

/** What the client knows about the world, to classify a tile like the server does. */
export interface TileWorld {
  map: MapData;
  /** Home farm you own (hoes, cans and seeds work). */
  farm: boolean;
  farmTiles: Map<string, FarmTile>;
  objects: Iterable<PlacedObject>;
  brokenRocks: Set<string>;
  /** This spawn's ore where it differs from the map's (cave silver, gold, diamond). */
  rockOres?: ReadonlyMap<string, RockOre>;
  trees: Map<string, "stump" | "gone">;
  monsters: readonly Vec2[];
}

export function targetAtTile(w: TileWorld, tile: Vec2, now: number): ToolTarget {
  const { map } = w;
  const { x, y } = tile;
  const rock = map.rocks?.find((r) => r.x === x && r.y === y && !w.brokenRocks.has(r.id));
  const tree = map.props.find((p) => p.type === "tree" && p.x === x && p.y === y && w.trees.get(p.id) !== "gone");
  const inMap = x >= 0 && y >= 0 && x < map.width && y < map.height;
  return classifyTarget(
    {
      monster: w.monsters.some((m) => Math.floor(m.x) === x && Math.floor(m.y) === y),
      rock: rock ? (w.rockOres?.get(rock.id) ?? rock.ore) : null,
      tree: tree ? { stage: w.trees.get(tree.id) === "stump" ? "stump" : "tree", size: treeSize(tree.id) } : null,
      soil: w.farm ? (w.farmTiles.get(`${x},${y}`) ?? null) : null,
      water: (inMap && map.ground[y * map.width + x] === Ground.Water) || map.props.some((p) => p.type === "well" && pointInRect(p, x, y)),
      bin: w.farm && map.props.some((p) => p.type === "shipping_bin" && pointInRect(p, x, y)),
      farmable: w.farm && isFarmable(map, x, y, [...w.objects]),
      boulder: boulderAt(map.props, x, y),
    },
    now,
  );
}

/** The rules' verdict for using `item` on `target` (for cursor hints and instant feedback). */
export function predictUse(item: ItemId | null | undefined, target: ToolTarget, farm: boolean, power?: number): ToolOutcome {
  return resolveToolUse(toolKeyOf(item), target, { farm, power });
}

/** Tree trunk tiles that are open (felled and cleared), for client-side collision. */
export function clearedTreeTiles(map: MapData | null, trees: Map<string, "stump" | "gone">): Vec2[] {
  if (!map || trees.size === 0) return [];
  const out: Vec2[] = [];
  for (const p of map.props) if (p.type === "tree" && trees.get(p.id) === "gone") out.push({ x: p.x, y: p.y });
  return out;
}
