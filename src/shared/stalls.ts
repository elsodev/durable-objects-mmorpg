// The village market stalls and who minds them. Each stall has a keeper who stands behind its
// counter through their working hours (shared/npcSchedule.ts NPC_JOBS); out of hours the stalls
// with an honour box stay self-serve (worker/game/shop.ts STALL_SHOPS). Pure data and geometry.
import type { MapProp, Vec2 } from "./types";

/** Stall prop id -> the villager who keeps it. */
export const STALL_KEEPERS: Readonly<Record<string, string>> = {
  stall_bakery: "wren",
  stall_produce: "odette",
  stall_goods: "jory",
};

/** The keeper of a stall prop, or null for a stall nobody keeps. */
export function stallKeeper(propId: string): string | null {
  return Object.hasOwn(STALL_KEEPERS, propId) ? STALL_KEEPERS[propId]! : null;
}

/** The stall a villager keeps, or null. */
export function keptStall(npcId: string): string | null {
  for (const [stall, keeper] of Object.entries(STALL_KEEPERS)) if (keeper === npcId) return stall;
  return null;
}

/**
 * Where a keeper's feet go: centred on the stall, half a tile above the footprint's bottom edge,
 * behind the counter, so the counter overlay drawn on top hides their legs. Inside the footprint,
 * so no walk ever reaches it.
 */
export function stallKeeperSpot(stall: Pick<MapProp, "x" | "y" | "w" | "h">): Vec2 {
  return { x: stall.x + stall.w / 2, y: stall.y + stall.h - 0.5 };
}
