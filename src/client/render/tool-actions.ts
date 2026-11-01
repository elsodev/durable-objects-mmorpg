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
};

/** The action art name (an item id or an action name) for `act`, or null when there is none. */
export function actionNameFor(act: NonNullable<EntityState["act"]>): string | null {
  if (act.item) return act.item;
  return Object.hasOwn(BY_KIND, act.k) ? BY_KIND[act.k]! : null;
}

/** Index of the frame to show `ageMs` into an action of `count` frames, or -1 when it has finished. */
export function actionFrame(ageMs: number, ms: number, count: number, hold: boolean): number {
  if (count <= 0 || ms <= 0 || ageMs < 0) return -1;
  const i = Math.floor(ageMs / ms);
  if (i < count) return i;
  return hold ? count - 1 : -1;
}
