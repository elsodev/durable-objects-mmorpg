// Pure parts of the on-screen controller (ui/gamepad.ts): which way the D-pad points, where the
// pad goes on screen, and whether it starts on.

export interface PadDir {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
}

export const PAD_KEY = "dmmo.pad.v1";

/** Pad buttons. "bag" and "map" open the HUD menus; the rest are the game's own actions. */
export type PadButton = "use" | "interact" | "gift" | "bag" | "map";

/**
 * The D-pad direction for a finger at (x, y) from the pad's centre. Eight directions in 45°
 * sectors, so a thumb a little off the axis still walks straight. Inside `dead` it's no direction.
 */
export function stickDir(x: number, y: number, dead: number): PadDir {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < dead) return { dx: 0, dy: 0 };
  const sector = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  // sector: 0 right, 1 down-right, 2 down, 3 down-left, ±4 left, -3 up-left, -2 up, -1 up-right.
  const dirs: Record<string, PadDir> = {
    "0": { dx: 1, dy: 0 },
    "1": { dx: 1, dy: 1 },
    "2": { dx: 0, dy: 1 },
    "3": { dx: -1, dy: 1 },
    "4": { dx: -1, dy: 0 },
    "-4": { dx: -1, dy: 0 },
    "-3": { dx: -1, dy: -1 },
    "-2": { dx: 0, dy: -1 },
    "-1": { dx: 1, dy: -1 },
  };
  return dirs[String(sector)] ?? { dx: 0, dy: 0 };
}

/**
 * Portrait screens get a Game Boy layout: the world on top and the pad in a panel below it.
 * Wider screens keep the whole world and float the D-pad and buttons in the bottom corners.
 */
export function padPlacement(width: number, height: number): "below" | "sides" {
  return height > width * 1.15 ? "below" : "sides";
}

/** The pad starts the way the player last left it; off the first time (tap-to-move is the default). */
export function initialPadOn(read: () => string | null): boolean {
  try {
    return read() === "1";
  } catch {
    return false;
  }
}
