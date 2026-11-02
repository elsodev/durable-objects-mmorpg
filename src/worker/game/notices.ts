// Zone side of the village notice board: where a board stands, and the reach for using it. The
// board itself lives in the global SocialRoom (social/noticeDesk.ts) so every village copy and the
// town hall read and write the same one.
import { NOTICE_COST } from "../../shared/notices";
import type { Inventory, MapData } from "../../shared/types";
import { distToRect, PROP_REACH } from "./range";

/** The panel stays usable a couple of steps from the board (it was opened in PROP_REACH). */
export const NOTICE_REACH = PROP_REACH + 2;

export function isNoticeBoard(prop: { type: string }): boolean {
  return prop.type === "notice_board";
}

/** Whether `pos` is close enough to a notice board on this map to read, pin and vote. */
export function boardInReach(map: MapData, pos: { x: number; y: number }): boolean {
  return map.props.some((p) => isNoticeBoard(p) && distToRect(pos, p) <= NOTICE_REACH);
}

/** Takes the notice fee from the bag (synchronously, before any await). False if they can't afford it. */
export function chargeNotice(inv: Pick<Inventory, "coins">): boolean {
  if (!(inv.coins >= NOTICE_COST)) return false;
  inv.coins -= NOTICE_COST;
  return true;
}

/** Gives the fee back when the board refused the notice or couldn't be reached. */
export function refundNotice(inv: Pick<Inventory, "coins">): void {
  inv.coins += NOTICE_COST;
}
