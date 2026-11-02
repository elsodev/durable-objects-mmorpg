// A player's level progress as zones and the home hold it: grant XP, take the jail penalty, and
// build the messages for it. Synchronous, like inventory: the caller saves afterwards.
import { addXp, cleanEpoch, cleanLevel, jailPenalty, jailXpText, xpToNext, type XpReason } from "../../shared/leveling";
import type { ServerMsg } from "../../shared/protocol";
import type { Vec2 } from "../../shared/types";

export interface Progress {
  level: number;
  xp: number;
  /** Jailings so far (shared/leveling.ts cleanEpoch): saves from an older epoch keep their hands off. */
  epoch: number;
}

/** Trusted progress from a save's fields. */
export function progressOf(save: { level?: unknown; xp?: unknown; levelEpoch?: unknown } | null | undefined): Progress {
  const s = cleanLevel(save?.level, save?.xp);
  return { level: s.level, xp: s.xp, epoch: cleanEpoch(save?.levelEpoch) };
}

/** The save fields for `p`. */
export function progressSave(p: Progress): { level: number; xp: number; levelEpoch: number } {
  return { level: p.level, xp: p.xp, levelEpoch: p.epoch };
}

type XpMsg = Extract<ServerMsg, { t: "xp" }>;

export function xpMsg(p: Progress, extra: Omit<XpMsg, "t" | "level" | "xp" | "next"> = {}): XpMsg {
  return { t: "xp", level: p.level, xp: p.xp, next: xpToNext(p.level), ...extra };
}

export interface Granted {
  /** For the earner. */
  msg: XpMsg;
  /** Set when a level was reached: the new level (broadcast a levelUp). */
  levelUp: number | null;
}

/** Adds XP to `p` in place; null when nothing changed (0 XP, or at the cap). */
export function grantXp(p: Progress, amount: number, reason: XpReason, at?: Vec2): Granted | null {
  const r = addXp(p, amount);
  if (r.gained <= 0) return null;
  p.level = r.level;
  p.xp = r.xp;
  const spot = at ? { at: { x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100 } } : {};
  return {
    msg: xpMsg(p, { gain: r.gained, reason, ...spot, ...(r.levelsUp > 0 ? { up: r.levelsUp } : {}) }),
    levelUp: r.levelsUp > 0 ? r.level : null,
  };
}

/**
 * The jail penalty on `p`, in place: XP toward the next level goes, the level stays, and the
 * epoch moves on. `text` is the line for the jail notice (null when nothing was lost).
 */
export function jailProgress(p: Progress): { msg: XpMsg; text: string | null } {
  const r = jailPenalty(p);
  p.xp = 0;
  p.epoch = cleanEpoch(p.epoch + 1);
  return { msg: xpMsg(p, { reason: "jail", ...(r.lost > 0 ? { lost: r.lost } : {}) }), text: jailXpText(r, r.lost) };
}

/** A jail notice with the XP line after it. */
export function withXpLine(text: string, line: string | null): string {
  return line ? `${text} ${line}` : text;
}
