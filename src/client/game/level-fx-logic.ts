// Pure helpers for game/level-fx.ts (no DOM, no Pixi), tested in test/fe-level-fx.test.ts.
import type { ServerMsg } from "../../shared/protocol";
import type { Vec2 } from "../../shared/types";

/** Someone else's level-up chime is heard within this many tiles of you. */
export const LEVELUP_HEAR_TILES = 12;
/** Kill XP floats start this far below a character's float height (monsters are shorter). */
export const KILL_FLOAT_DROP = 1.1;
/** ...and this long after the kill, so they don't sit on the killing blow's damage number. */
export const KILL_FLOAT_DELAY_MS = 260;
/** Sale XP floats sit above your head, over the "+coins" line. */
export const SALE_FLOAT_LIFT = 0.6;

/**
 * The "+8 XP" float for an xp message: where (tiles), what and after how long. None for the
 * welcome sync, the jail penalty, or a kill without a spot.
 */
export function xpFloat(msg: Extract<ServerMsg, { t: "xp" }>, you: Vec2 | null): { at: Vec2; text: string; delayMs: number } | null {
  const gain = msg.gain ?? 0;
  if (!(gain > 0)) return null;
  const text = `+${Math.floor(gain).toLocaleString("en-US")} XP`;
  if (msg.reason === "kill") {
    if (!msg.at) return null;
    return { at: { x: msg.at.x, y: msg.at.y + KILL_FLOAT_DROP }, text, delayMs: KILL_FLOAT_DELAY_MS };
  }
  if (!you) return null;
  return { at: { x: you.x, y: you.y - SALE_FLOAT_LIFT }, text, delayMs: 0 };
}

/** Your own level-up always chimes; someone else's only when they are near you. */
export function levelUpHeard(self: boolean, at: Vec2, you: Vec2 | null): boolean {
  if (self) return true;
  if (!you) return false;
  return Math.hypot(at.x - you.x, at.y - you.y) <= LEVELUP_HEAR_TILES;
}
