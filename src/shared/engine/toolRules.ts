// Tool rules: which tool does what to which target, how many hits things take and what they
// drop. One table for the server (validation) and the client (cursor hints, instant swings).
// Pure: no clock, no randomness (callers pass `now` and `rand`).
import { getItem } from "../items";
import type { Facing, FarmTile, ItemId, RockOre, Vec2 } from "../types";
import { harvestable } from "./farming";
import { DEFAULT_DROP_RATES, isRareDrop, rollDrop, type DropCategory, type DropRates } from "./dropRate";

export type Ore = RockOre;
export type TreeSize = "small" | "large";
export type TreeStage = "tree" | "stump" | "gone";

/** What sits on the tile a tool is used on, as far as the rules care. */
export type ToolTarget =
  | { kind: "monster" }
  | { kind: "rock"; ore: Ore }
  | { kind: "tree"; size: TreeSize }
  | { kind: "stump" }
  /** A big decorative boulder: solid, and no tool breaks it. */
  | { kind: "boulder" }
  /** Pond, lake or well: the watering can refills. */
  | { kind: "water" }
  /** Tilled soil; `crop` is "ready" when it can be harvested, "dead" when it died of thirst. */
  | { kind: "soil"; crop: "none" | "growing" | "ready" | "dead" }
  /** Farmable, empty grass or dirt (home farm only). */
  | { kind: "grass" }
  | { kind: "bin" }
  /** Paths, floors, walls, furniture, decoration, or grass outside the farm. */
  | { kind: "none" };

/** How the selected item is used: a tool kind, a seed, or anything else. */
export type ToolKey = "hoe" | "water" | "pickaxe" | "axe" | "sword" | "seed" | "other";

export type ToolEffect =
  | "till"
  | "water"
  | "refill"
  | "plant"
  | "harvest"
  /** Pull up a dead crop (hoe or by hand), leaving empty tilled soil. */
  | "clear"
  | "hitRock"
  | "hitTree"
  | "hitStump"
  | "hitMonster"
  | "ship";

export type ToolOutcome =
  | { ok: true; effect: ToolEffect }
  /**
   * Nothing happens. `swing`: the tool still swings (a "clunk"); `reason`: a gentle notice, empty
   * when a swing at nothing needs no comment.
   */
  | {
      ok: false;
      swing: boolean;
      reason: string;
      /** The tool struck something solid it can't work (axe on a rock, pickaxe on a tree): it rebounds. */
      bounce?: true;
    };

export interface Drop {
  item: ItemId;
  min: number;
  max: number;
  /**
   * 0..1. Left out, the drop is guaranteed and never scaled; with a chance it is a bonus drop,
   * scaled by the drop rates (dropRate.ts).
   */
  chance?: number;
}

export interface RockRule {
  /** Hits to break it. */
  hits: number;
  /** Minimum pickaxe power (ItemDef.power). */
  power: number;
  drops: Drop[];
}

/**
 * Hits, required pickaxe and drops for every rock. Tune here. The first drop (the rock's own ore)
 * is guaranteed; the rest are bonus drops scaled by DROP_RATE_ROCK (or DROP_RATE_RARE for gems
 * and gold). Diamonds turn up now and then in any iron, silver or gold rock.
 */
export const ROCK_RULES: Record<Ore, RockRule> = {
  stone: { hits: 2, power: 1, drops: [{ item: "stone", min: 1, max: 3 }] },
  copper: {
    hits: 3,
    power: 1,
    drops: [
      { item: "ore_copper", min: 1, max: 2 },
      { item: "stone", min: 1, max: 1, chance: 0.5 },
    ],
  },
  iron: {
    hits: 4,
    power: 2,
    drops: [
      { item: "ore_iron", min: 1, max: 2 },
      { item: "stone", min: 1, max: 1, chance: 0.5 },
      { item: "gem_diamond", min: 1, max: 1, chance: 0.002 },
    ],
  },
  silver: {
    hits: 5,
    power: 2,
    drops: [
      { item: "ore_silver", min: 1, max: 2 },
      { item: "stone", min: 1, max: 1, chance: 0.5 },
      { item: "gem_diamond", min: 1, max: 1, chance: 0.004 },
    ],
  },
  gold: {
    hits: 6,
    power: 2,
    drops: [
      { item: "ore_gold", min: 1, max: 1 },
      { item: "ore_gold", min: 1, max: 1, chance: 0.25 },
      { item: "stone", min: 1, max: 1, chance: 0.5 },
      { item: "gem_diamond", min: 1, max: 1, chance: 0.02 },
    ],
  },
  gem: {
    hits: 5,
    power: 2,
    drops: [
      { item: "gem_crystal", min: 1, max: 1 },
      { item: "stone", min: 1, max: 2 },
    ],
  },
  diamond: {
    hits: 8,
    power: 2,
    drops: [
      { item: "gem_diamond", min: 1, max: 1 },
      { item: "stone", min: 1, max: 2 },
    ],
  },
};

export interface TreeRule {
  /** Axe hits until it falls and leaves a stump. */
  hits: number;
  drops: Drop[];
}

/** Hits and wood per tree size. Tune here. */
export const TREE_RULES: Record<TreeSize, TreeRule> = {
  small: { hits: 3, drops: [{ item: "wood", min: 2, max: 3 }] },
  large: { hits: 5, drops: [{ item: "wood", min: 4, max: 6 }] },
};

/** A stump takes this many more axe hits to clear at home (or it stays until the tree regrows). */
export const STUMP_RULE: TreeRule = { hits: 2, drops: [{ item: "wood", min: 1, max: 1 }] };

/** A felled tree (stump or cleared) grows back after this long. */
export const TREE_REGROW_MS = 10 * 60 * 1000;
/** Hit progress on a rock, tree or stump is forgotten after this long untouched. */
export const HIT_RESET_MS = 30 * 1000;

/** Damage each tool does to monsters; swords use their own power and always hit hardest. */
export const TOOL_DAMAGE: Record<Exclude<ToolKey, "seed" | "other" | "sword">, number> = {
  pickaxe: 3,
  axe: 3,
  hoe: 2,
  water: 1,
};

/** One weapon's hit: damage range, crits and how far it pushes (tiles). */
export interface WeaponStats {
  min: number;
  max: number;
  critChance: number;
  critMult: number;
  knockback: number;
  /** Swords sweep an arc in front of you; every other tool hits only the tile you aim at. */
  arc: boolean;
}

/** Sword damage ranges. Any sword not listed rolls around its `power`. Tune here. */
export const WEAPON_STATS: Record<ItemId, Pick<WeaponStats, "min" | "max">> = {
  sword_wood: { min: 4, max: 6 },
  sword_copper: { min: 8, max: 12 },
};
export const CRIT_CHANCE = 0.02;
export const CRIT_MULT = 3;
export const SWORD_KNOCKBACK = 0.6;
export const TOOL_KNOCKBACK = 0.35;

/** Hit stats for `item` against monsters, or null for things that aren't tools. */
export function weaponStats(item: ItemId): WeaponStats | null {
  const def = getItem(item);
  if (!def?.tool) return null;
  if (def.tool === "sword") {
    const p = def.power ?? 1;
    const r = WEAPON_STATS[item] ?? { min: Math.max(1, p - 1), max: p + 1 };
    // A sword always out-hits the other tools, even at its low roll.
    const floor = TOOL_DAMAGE.pickaxe + 1;
    return { min: Math.max(floor, r.min), max: Math.max(floor, r.max), critChance: CRIT_CHANCE, critMult: CRIT_MULT, knockback: SWORD_KNOCKBACK, arc: true };
  }
  const d = TOOL_DAMAGE[def.tool];
  return { min: d, max: d, critChance: CRIT_CHANCE, critMult: CRIT_MULT, knockback: TOOL_KNOCKBACK, arc: false };
}

/** What kind of use an item makes. */
export function toolKeyOf(item: ItemId | null | undefined): ToolKey {
  const def = item ? getItem(item) : undefined;
  if (!def) return "other";
  if (def.tool) return def.tool;
  return def.kind === "seed" ? "seed" : "other";
}

/** Average damage `item` does to a monster (0 for things that aren't tools). */
export function toolDamage(item: ItemId): number {
  const w = weaponStats(item);
  return w ? Math.round((w.min + w.max) / 2) : 0;
}

/** Tree size, fixed per tree id (about one in three is large). */
export function treeSize(id: string): TreeSize {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 3 === 0 ? "large" : "small";
}

const TOOL_NAME: Record<ToolKey, string> = {
  hoe: "hoe",
  water: "watering can",
  pickaxe: "pickaxe",
  axe: "axe",
  sword: "sword",
  seed: "seed",
  other: "item",
};

const ok = (effect: ToolEffect): ToolOutcome => ({ ok: true, effect });
const no = (reason: string, swing = true): ToolOutcome => ({ ok: false, swing, reason });
const rebound = (reason: string): ToolOutcome => ({ ok: false, swing: true, reason, bounce: true });
const SWINGS: ReadonlySet<ToolKey> = new Set(["hoe", "water", "pickaxe", "axe", "sword"]);

/** True for items that swing (play a tool animation) whatever they hit. */
export function isSwingTool(key: ToolKey): boolean {
  return SWINGS.has(key);
}

type Solid = "rock" | "tree" | "stump" | "boulder";

/** The gentle wrong-tool notice for hitting a rock, tree, stump or boulder with `key`. */
function bounce(key: ToolKey, target: Solid): ToolOutcome {
  return rebound(bounceText(key, target));
}

function bounceText(key: ToolKey, target: Solid): string {
  if (target === "boulder") {
    return key === "pickaxe"
      ? "Your pickaxe bounces off the boulder. It's far too big to break."
      : `Your ${TOOL_NAME[key]} bounces off the boulder. It's far too big to break.`;
  }
  const thing = target === "rock" ? "the rock" : target === "tree" ? "the tree" : "the stump";
  if (target !== "rock" && key === "pickaxe") return `Your pickaxe bounces off ${thing}. You need an axe for that.`;
  if (target === "rock" && key === "axe") return "Your axe bounces off the rock. You need a pickaxe for that.";
  return `Your ${TOOL_NAME[key]} bounces off ${thing}. You need ${target === "rock" ? "a pickaxe" : "an axe"} for that.`;
}

/**
 * The rules matrix: what using `key` (with `power` for pickaxes) on `target` does. `farm` is true
 * on your own home farm, where hoes, watering cans and seeds work. State checks the table can't
 * see (already watered today, can already full, bag full, stamina) stay with the caller.
 */
export function resolveToolUse(key: ToolKey, target: ToolTarget, opts: { farm: boolean; power?: number }): ToolOutcome {
  const swings = isSwingTool(key);
  // A ripe crop is picked by hand whatever is selected.
  if (target.kind === "soil" && target.crop === "ready" && opts.farm) return ok("harvest");
  // So is a dead one pulled up: by hand, or by the hoe if that's what you hold.
  if (target.kind === "soil" && target.crop === "dead" && opts.farm) return ok("clear");
  if (target.kind === "monster") return swings ? ok("hitMonster") : no("", false);
  // A hoe striking something solid rebounds anywhere, not only on the farm.
  const solid = target.kind === "rock" || target.kind === "tree" || target.kind === "stump" || target.kind === "boulder";
  if (key === "hoe" && solid) return bounce(key, target.kind);
  if (!opts.farm && (key === "hoe" || key === "water" || key === "seed")) {
    if (key === "water" && target.kind === "water") return no("", true);
    return no("That's for your farm at home.", swings);
  }
  switch (key) {
    case "hoe":
      if (target.kind === "grass") return ok("till");
      if (target.kind === "soil") return no("Already tilled.");
      if (target.kind === "rock" || target.kind === "tree" || target.kind === "stump") return bounce(key, target.kind);
      if (target.kind === "boulder") return bounce(key, "boulder");
      if (target.kind === "water") return no("You can't till water.");
      return no("You can't till here.");
    case "water":
      if (target.kind === "water") return ok("refill");
      if (target.kind === "soil") return ok("water");
      if (target.kind === "grass") return no("Till the soil first.");
      return no("Nothing to water here.");
    case "seed":
      if (target.kind === "soil") return target.crop === "none" ? ok("plant") : no("Something is already growing here.", false);
      if (target.kind === "bin") return ok("ship");
      if (target.kind === "grass") return no("Till the soil with a hoe first.", false);
      return no("Seeds only grow in tilled soil.", false);
    case "pickaxe":
      if (target.kind === "rock") {
        return (opts.power ?? 1) >= ROCK_RULES[target.ore].power ? ok("hitRock") : no("You need a stronger pickaxe.");
      }
      if (target.kind === "tree" || target.kind === "stump" || target.kind === "boulder") return bounce(key, target.kind);
      return no("");
    case "axe":
      if (target.kind === "tree") return ok("hitTree");
      // Stumps clear only at home: in shared zones a cleared tile could open a path around a gate.
      if (target.kind === "stump") return opts.farm ? ok("hitStump") : no("The stump is rooted fast. It will grow back in time.");
      if (target.kind === "rock" || target.kind === "boulder") return bounce(key, target.kind);
      return no("");
    case "sword":
      if (target.kind === "rock" || target.kind === "tree" || target.kind === "stump" || target.kind === "boulder") return bounce(key, target.kind);
      return no("");
    case "other":
      if (target.kind === "bin" && opts.farm) return ok("ship");
      return no("Nothing to do here.", false);
  }
}

/**
 * Rolls a drop table. Drops without a chance always come; chance drops go through the drop-rate
 * helper under `category` (rare items under DROP_RATE_RARE when it is set). Repeats stack.
 */
export function rollDrops(
  drops: readonly Drop[],
  rand: () => number,
  rates: Readonly<DropRates> = DEFAULT_DROP_RATES,
  category: DropCategory = "rock",
): { item: ItemId; qty: number }[] {
  const out: { item: ItemId; qty: number }[] = [];
  for (const d of drops) {
    if (d.chance !== undefined && !rollDrop(d.chance, category, rand, rates, isRareDrop(d.item))) continue;
    const qty = d.min + Math.floor(rand() * (d.max - d.min + 1));
    if (qty <= 0) continue;
    const same = out.find((x) => x.item === d.item);
    if (same) same.qty += qty;
    else out.push({ item: d.item, qty });
  }
  return out;
}

/** Hits needed for a rock, tree or stump target (0 for anything else). */
export function hitsNeeded(target: ToolTarget): number {
  if (target.kind === "rock") return ROCK_RULES[target.ore].hits;
  if (target.kind === "tree") return TREE_RULES[target.size].hits;
  if (target.kind === "stump") return STUMP_RULE.hits;
  return 0;
}

/**
 * Per-target hit progress (rocks, trees, stumps). Progress resets after HIT_RESET_MS untouched,
 * so a half-mined rock heals if you walk away.
 */
export class HitTracker {
  private hits = new Map<string, { n: number; at: number }>();

  /** Records a hit; returns hits so far and whether that reached `needed` (progress then clears). */
  hit(id: string, needed: number, now: number): { hits: number; done: boolean } {
    const prev = this.hits.get(id);
    const n = (prev && now - prev.at < HIT_RESET_MS ? prev.n : 0) + 1;
    if (n >= needed) {
      this.hits.delete(id);
      return { hits: n, done: true };
    }
    this.hits.set(id, { n, at: now });
    return { hits: n, done: false };
  }

  progress(id: string, now: number): number {
    const prev = this.hits.get(id);
    return prev && now - prev.at < HIT_RESET_MS ? prev.n : 0;
  }

  clear(id: string): void {
    this.hits.delete(id);
  }

  /** Drops stale entries; returns the ids whose progress was forgotten. */
  expire(now: number): string[] {
    const out: string[] = [];
    for (const [id, h] of this.hits) {
      if (now - h.at >= HIT_RESET_MS) {
        this.hits.delete(id);
        out.push(id);
      }
    }
    return out;
  }
}

/** Facing that looks from `from` toward the centre of `tile` (keeps `fallback` on your own tile). */
export function facingToward(from: Vec2, tile: Vec2, fallback: Facing): Facing {
  const dx = tile.x + 0.5 - from.x;
  const dy = tile.y + 0.5 - from.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return fallback;
  // Ties go horizontal, like facingFor / facingToTile.
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

/** What a tile holds, as the server or client sees it; classifyTarget turns it into a ToolTarget. */
export interface TargetProbe {
  monster?: boolean;
  rock?: Ore | null;
  tree?: { stage: "tree" | "stump"; size: TreeSize } | null;
  /** The farm tile there (home), if tilled. */
  soil?: FarmTile | null;
  /** Pond, lake or well. */
  water?: boolean;
  bin?: boolean;
  /** Farmable, empty ground (home farm area, no prop or furniture). */
  farmable?: boolean;
  /** A big decorative boulder covers the tile. */
  boulder?: boolean;
}

/** One priority order for both sides: monsters, rocks, trees, soil, water, the bin, then bare ground. */
export function classifyTarget(p: TargetProbe, now: number): ToolTarget {
  if (p.monster) return { kind: "monster" };
  if (p.rock) return { kind: "rock", ore: p.rock };
  if (p.tree) return p.tree.stage === "stump" ? { kind: "stump" } : { kind: "tree", size: p.tree.size };
  if (p.boulder) return { kind: "boulder" };
  if (p.soil) {
    const crop = !p.soil.crop ? "none" : p.soil.dead ? "dead" : harvestable(p.soil, now) ? "ready" : "growing";
    return { kind: "soil", crop };
  }
  if (p.water) return { kind: "water" };
  if (p.bin) return { kind: "bin" };
  if (p.farmable) return { kind: "grass" };
  return { kind: "none" };
}
