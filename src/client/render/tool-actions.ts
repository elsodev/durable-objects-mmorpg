// Picks which CharacterArt.action to play for an entity's last server action (EntityState.act).
import type { EntityState } from "../../shared/types";

/** Tool kind / action key from the server -> the default item whose swing art to use. */
const BY_KIND: Record<string, string> = {
  hoe: "hoe",
  water: "watering_can",
  pickaxe: "pickaxe",
  sword: "sword_wood",
  harvest: "harvest",
  plant: "harvest",
  fish: "fishing_rod",
  hurt: "hurt",
  eat: "eat",
  holdUp: "hold_up",
};

/** Acts whose `item` is what is eaten or held up, not the tool to swing; they always face the viewer. */
export const ITEM_POSE_ACTS: ReadonlySet<string> = new Set(["eat", "holdUp"]);

/** The action art name (an item id or an action name) for `act`, or null when there is none. */
export function actionNameFor(act: NonNullable<EntityState["act"]>): string | null {
  if (act.item && !ITEM_POSE_ACTS.has(act.k)) return act.item;
  return Object.hasOwn(BY_KIND, act.k) ? BY_KIND[act.k]! : null;
}

/** Index of the frame to show `ageMs` into an action of `count` frames, or -1 when it has finished. */
export function actionFrame(ageMs: number, ms: number, count: number, hold: boolean): number {
  if (count <= 0 || ms <= 0 || ageMs < 0) return -1;
  const i = Math.floor(ageMs / ms);
  if (i < count) return i;
  return hold ? count - 1 : -1;
}

/**
 * The frame of each tool's action sheet where the tool meets the ground (or rock, or tree), and
 * how many frames that sheet has. A sheet of another length scales the index.
 */
export const IMPACT_FRAME: Readonly<Record<string, { frame: number; of: number }>> = {
  hoe: { frame: 4, of: 8 },
  water: { frame: 2, of: 7 },
  pickaxe: { frame: 6, of: 10 },
  axe: { frame: 6, of: 10 },
  sword: { frame: 3, of: 6 },
};

/** Index of the impact frame in a `count`-frame sheet for tool kind `k`. */
export function impactFrameOf(k: string, count: number): number {
  const row = Object.hasOwn(IMPACT_FRAME, k) ? IMPACT_FRAME[k]! : { frame: 1, of: 2 };
  const i = row.of === count ? row.frame : Math.round((row.frame * count) / row.of);
  return Math.max(0, Math.min(count - 1, i));
}

/**
 * Like actionFrame, for a tool swing timed by the shared toolTiming table: the frames before the
 * impact frame share [0, impactMs), the rest share [impactMs, totalMs). So the tool visibly lands
 * exactly when its effect does, whatever speed the sheet was drawn for. -1 once it has finished.
 */
export function swingFrame(ageMs: number, count: number, impact: number, timing: { impactMs: number; totalMs: number }): number {
  if (count <= 0 || ageMs < 0 || ageMs >= timing.totalMs) return -1;
  const f = Math.max(0, Math.min(count - 1, impact));
  if (ageMs < timing.impactMs) return f === 0 ? 0 : Math.min(f - 1, Math.floor((ageMs / timing.impactMs) * f));
  const after = count - f;
  const span = Math.max(1, timing.totalMs - timing.impactMs);
  return Math.min(count - 1, f + Math.floor(((ageMs - timing.impactMs) / span) * after));
}
