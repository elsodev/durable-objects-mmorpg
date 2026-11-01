// Pure helpers for the character creator screen (ui/creator.ts): tabs, preview turning and frames.
import { LOOK_OPTIONS, type LookPart } from "../../shared/look";
import type { Facing, Look } from "../../shared/types";

export interface CreatorTab {
  part: LookPart;
  label: string;
  /** Shorter text for the tab pill, when the label is long (the full label stays as its name). */
  short?: string;
}

export const CREATOR_TABS: readonly CreatorTab[] = [
  { part: "body", label: "Body" },
  { part: "skin", label: "Skin" },
  { part: "eyes", label: "Eyes" },
  { part: "hairStyle", label: "Hair" },
  { part: "hairColor", label: "Hair colour", short: "Colour" },
  { part: "top", label: "Top" },
  { part: "bottom", label: "Bottom" },
  { part: "shoes", label: "Shoes" },
];

/** Clockwise as seen from above: facing the camera, then their left, away, their right. */
const TURN_ORDER: Facing[] = ["down", "left", "up", "right"];

export function turnFacing(f: Facing, dir: 1 | -1): Facing {
  const i = TURN_ORDER.indexOf(f);
  return TURN_ORDER[(i + dir + TURN_ORDER.length) % TURN_ORDER.length]!;
}

/**
 * Walk-cycle column for the preview. LPC walk rows start with a standing frame, so with more
 * than one frame the loop skips column 0.
 */
export function previewFrame(elapsedMs: number, frames: number, fps = 10): number {
  if (frames <= 1) return 0;
  const step = Math.floor(Math.max(0, elapsedMs) * fps / 1000);
  return 1 + (step % (frames - 1));
}

/** Copy of `look` with one part changed; unknown ids leave it as is. */
export function withOption(look: Look, part: LookPart, id: string): Look {
  if (!LOOK_OPTIONS[part].includes(id) || look[part] === id) return look;
  return { ...look, [part]: id };
}
