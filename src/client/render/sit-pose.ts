// Seated characters (EntityState.act { k: "sit" }). The entity stands at its seat tile's centre;
// the body is drawn with the character's "sit" action frame (CharacterArt.action("sit")),
// lowered onto the seat. A character without sit art shows its whole idle frame for the seat's
// facing, lowered the same way: never clipped.
import type { Texture } from "pixi.js";
import type { CharacterArt } from "../contracts";
import { TILE } from "../contracts";
import type { EntityState } from "../../shared/types";

/**
 * Source px the body is drawn below the entity point while seated. The sit frames keep the
 * standing feet anchor, and a chair's seat is about this far below its tile's centre.
 */
export const SIT_DROP_PX = 14;

export function isSeated(s: EntityState): boolean {
  return s.act?.k === "sit";
}

/** Texture when the character has no sit action art: the idle frame (or legacy CharacterArt.sit). */
export function seatedFallback(c: CharacterArt, facing: EntityState["facing"]): Texture {
  return c.sit?.[facing] ?? c.idle[facing] ?? c.idle.down;
}

/**
 * Sort key for a sitter. Everything at a seat sorts by its tile's bottom edge (row + 1):
 *   chair body           row+1          (chair_up's body sorts a row earlier: see props.ts)
 *   sitter               row+1 + 0.5    above its own chair and stool
 *   table / counter      row+1 + 0.75   (TABLE_SORT_BIAS) a table on the sitter's row (side
 *                                       sitters) or further south (north-side sitters) covers them
 *   chair_up backrest    row+1 + 1      the backrest of a chair seen from behind covers its sitter
 * A south-side sitter (facing up) sits a row below the table, so it draws in front of it.
 */
export function seatedZ(y: number): number {
  return (Math.floor(y) + 1) * TILE + 0.5;
}
