// Choppable trees of one map (home yard, village, riverside): felled/cleared state, collision
// and regrowth. A felled tree leaves a stump that still blocks its trunk tile; clearing the stump
// frees the tile. Both grow back into a full tree after TREE_REGROW_MS.
import type { MapData, MapProp, Vec2 } from "../../shared/types";
import { setBlocked, type CollisionGrid } from "../../shared/engine";
import { TREE_REGROW_MS, treeSize, type TreeSize, type TreeStage } from "../../shared/engine/toolRules";

export interface TreeState {
  stage: Exclude<TreeStage, "tree">;
  /** When it grows back (ms epoch). */
  regrowAt: number;
}

export class TreeField {
  readonly trees: MapProp[];
  /** Felled tree id -> stump or cleared, and when it regrows. Standing trees are not listed. */
  readonly felled = new Map<string, TreeState>();

  constructor(map: MapData) {
    this.trees = map.props.filter((p) => p.type === "tree");
  }

  /** Loads stored state (unknown ids and bad entries are dropped). Call applyTo(grid) after. */
  load(stored: unknown): void {
    this.felled.clear();
    if (!stored || typeof stored !== "object") return;
    for (const [id, v] of Object.entries(stored as Record<string, unknown>)) {
      const s = v as Partial<TreeState> | null;
      if (!s || (s.stage !== "stump" && s.stage !== "gone") || typeof s.regrowAt !== "number") continue;
      const t = this.trees.find((k) => k.id === id);
      if (!t) continue;
      this.felled.set(id, { stage: s.stage, regrowAt: s.regrowAt });
    }
  }

  /** Frees the trunk tiles of cleared trees in a freshly built collision grid. */
  applyTo(grid: CollisionGrid): void {
    for (const [id, s] of this.felled) {
      const t = s.stage === "gone" ? this.trees.find((k) => k.id === id) : undefined;
      if (t) setBlocked(grid, t.x, t.y, 1, 1, false);
    }
  }

  record(): Record<string, TreeState> {
    return Object.fromEntries(this.felled);
  }

  /** Felled trees for welcome messages. */
  stages(): { id: string; stage: Exclude<TreeStage, "tree"> }[] {
    return [...this.felled].map(([id, s]) => ({ id, stage: s.stage }));
  }

  /** Ids of trees cleared away (stump gone): their tiles are open ground until they regrow. */
  goneIds(): Set<string> {
    const out = new Set<string>();
    for (const [id, s] of this.felled) if (s.stage === "gone") out.add(id);
    return out;
  }

  stageOf(id: string): TreeStage {
    return this.felled.get(id)?.stage ?? "tree";
  }

  /** The tree (standing or stump) whose trunk is on this tile; cleared ones don't count. */
  at(tx: number, ty: number): { tree: MapProp; stage: "tree" | "stump"; size: TreeSize } | null {
    const t = this.trees.find((k) => k.x === tx && k.y === ty);
    if (!t) return null;
    const stage = this.stageOf(t.id);
    return stage === "gone" ? null : { tree: t, stage, size: treeSize(t.id) };
  }

  fell(tree: MapProp, now: number): void {
    this.felled.set(tree.id, { stage: "stump", regrowAt: now + TREE_REGROW_MS });
  }

  clearStump(tree: MapProp, grid: CollisionGrid): void {
    const s = this.felled.get(tree.id);
    if (!s) return;
    s.stage = "gone";
    setBlocked(grid, tree.x, tree.y, 1, 1, false);
  }

  /** Next regrow time, or null when every tree stands. */
  nextRegrow(): number | null {
    let next: number | null = null;
    for (const s of this.felled.values()) if (next === null || s.regrowAt < next) next = s.regrowAt;
    return next;
  }

  /**
   * Regrows trees whose time came, except a cleared tile someone stands on or that `taken` says
   * is in use now (tilled, built on): that one waits another regrow time. Returns regrown ids.
   */
  regrowDue(grid: CollisionGrid, now: number, occupied: Vec2[], taken?: (tree: MapProp) => boolean): string[] {
    const out: string[] = [];
    for (const [id, s] of this.felled) {
      if (now < s.regrowAt) continue;
      const t = this.trees.find((k) => k.id === id);
      if (!t) {
        this.felled.delete(id);
        continue;
      }
      if (s.stage === "gone") {
        if (occupied.some((p) => Math.abs(p.x - (t.x + 0.5)) < 1 && Math.abs(p.y - (t.y + 0.5)) < 1)) continue;
        if (taken?.(t)) {
          s.regrowAt = now + TREE_REGROW_MS;
          continue;
        }
        setBlocked(grid, t.x, t.y, 1, 1, true);
      }
      this.felled.delete(id);
      out.push(id);
    }
    return out;
  }
}
