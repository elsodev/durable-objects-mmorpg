// Village goals everyone donates to. The village ZoneRoom stores the progress; other zones
// forward donations to it over RPC.
import type { VillageGoal } from "../../shared/protocol";
import type { ItemId } from "../../shared/types";

export interface GoalDef {
  id: string;
  name: string;
  needs: { item: ItemId; qty: number }[];
}

export const GOAL_DEFS: GoalDef[] = [
  {
    id: "bridge",
    name: "Rebuild the river bridge",
    needs: [
      { item: "wood", qty: 60 },
      { item: "stone", qty: 40 },
      { item: "ore_copper", qty: 10 },
    ],
  },
  {
    id: "fair",
    name: "Harvest fair",
    needs: [
      { item: "turnip", qty: 30 },
      { item: "carrot", qty: 20 },
      { item: "strawberry", qty: 12 },
      { item: "pumpkin", qty: 6 },
    ],
  },
  {
    id: "lantern",
    name: "Relight the shrine lantern",
    needs: [
      { item: "gem_crystal", qty: 1 },
      { item: "ore_iron", qty: 8 },
      { item: "slime_gel", qty: 10 },
    ],
  },
];

/** Stored progress: goal id -> item id -> qty donated. */
export type GoalProgress = Record<string, Record<ItemId, number>>;

const defFor = (id: string) => GOAL_DEFS.find((g) => g.id === id);

/** How many of `item` the goal still accepts (0 for unknown goal/item or finished goals). */
export function remainingNeed(progress: GoalProgress, goalId: string, item: ItemId): number {
  const def = defFor(goalId);
  const need = def?.needs.find((n) => n.item === item);
  if (!def || !need) return 0;
  const have = Object.hasOwn(progress, goalId) ? (progress[goalId][item] ?? 0) : 0;
  return Math.max(0, need.qty - have);
}

/** Records up to `qty`; returns how many were accepted (the caller refunds the rest). */
export function donate(progress: GoalProgress, goalId: string, item: ItemId, qty: number): number {
  const take = Math.min(Math.max(0, Math.floor(qty)), remainingNeed(progress, goalId, item));
  if (take <= 0) return 0;
  const g = (progress[goalId] ??= {});
  g[item] = (g[item] ?? 0) + take;
  return take;
}

export function goalsView(progress: GoalProgress): VillageGoal[] {
  return GOAL_DEFS.map((def) => {
    const have = Object.hasOwn(progress, def.id) ? progress[def.id] : {};
    const needs = def.needs.map((n) => ({ item: n.item, qty: n.qty, have: Math.min(n.qty, have[n.item] ?? 0) }));
    return { id: def.id, name: def.name, needs, done: needs.every((n) => n.have >= n.qty) };
  });
}

export function sanitizeProgress(p: unknown): GoalProgress {
  const out: GoalProgress = {};
  if (!p || typeof p !== "object") return out;
  for (const def of GOAL_DEFS) {
    const g = (p as Record<string, unknown>)[def.id];
    if (!g || typeof g !== "object") continue;
    for (const n of def.needs) {
      const v = (g as Record<string, unknown>)[n.item];
      if (typeof v === "number" && Number.isInteger(v) && v > 0) (out[def.id] ??= {})[n.item] = Math.min(v, n.qty);
    }
  }
  return out;
}
