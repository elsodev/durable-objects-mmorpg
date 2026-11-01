// When a tool swing lands. The effect (soil, chips, splash) shows at the impact frame, not on
// press, and the swing holds input until it ends. Shared so the server can stamp `impactAt` and
// every client (yours and remote ones) lands the same hit at the same moment of the animation.
import type { Facing } from "../types";
import type { ToolKind } from "../items";

export interface ToolTiming {
  /** ms from swing start to the impact frame, when the effect lands. */
  impactMs: number;
  /** ms for the whole swing; input stays locked this long. */
  totalMs: number;
}

/** A swing the player winds up over the shoulder lands later facing down (the arc is longer). */
const OVERHEAD_DOWN_MS = 230;
const OVERHEAD_SIDE_MS = 180;
/** The watering can tips almost at once, whatever the facing. */
const POUR_MS = 175;
export const SWING_TOTAL_MS = 475;

type Row = { down: number; side: number; total: number };

export const TOOL_TIMING: Readonly<Record<ToolKind, Row>> = {
  hoe: { down: OVERHEAD_DOWN_MS, side: OVERHEAD_SIDE_MS, total: SWING_TOTAL_MS },
  pickaxe: { down: OVERHEAD_DOWN_MS, side: OVERHEAD_SIDE_MS, total: SWING_TOTAL_MS },
  axe: { down: OVERHEAD_DOWN_MS, side: OVERHEAD_SIDE_MS, total: SWING_TOTAL_MS },
  sword: { down: OVERHEAD_DOWN_MS, side: OVERHEAD_SIDE_MS, total: SWING_TOTAL_MS },
  water: { down: POUR_MS, side: POUR_MS, total: SWING_TOTAL_MS },
};

/** Timing of a swing with `tool` facing `facing`; null for things that don't swing. */
export function toolTiming(tool: string | null | undefined, facing: Facing): ToolTiming | null {
  if (!tool || !Object.hasOwn(TOOL_TIMING, tool)) return null;
  const row = TOOL_TIMING[tool as ToolKind];
  return { impactMs: facing === "down" ? row.down : row.side, totalMs: row.total };
}

/** ms from swing start to impact (0 for things that don't swing, so they apply at once). */
export function impactDelayMs(tool: string | null | undefined, facing: Facing): number {
  return toolTiming(tool, facing)?.impactMs ?? 0;
}
