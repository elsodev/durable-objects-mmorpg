// Monster frames on the same 64x64 grid as humanoids (feet at y = 60).
import type { Facing } from "../../../shared/types";
import { P, shade } from "../palette";
import { PixelGrid } from "./grid";
import { FRAME } from "./humanoid";

export type MonsterKind = "slime" | "bat" | "rock_crab";

/** Eye offset per facing: where a creature "looks". */
function look(facing: Facing): { dx: number; show: boolean } {
  switch (facing) {
    case "left":
      return { dx: -3, show: true };
    case "right":
      return { dx: 3, show: true };
    case "up":
      return { dx: 0, show: false };
    default:
      return { dx: 0, show: true };
  }
}

const SLIME_SQUASH: [number, number, number][] = [
  // rx, ry, lift
  [13, 9, 0],
  [11, 11, 2],
  [10, 12, 5],
  [12, 10, 1],
];

export function drawSlime(facing: Facing, frame: number): PixelGrid {
  const g = new PixelGrid(FRAME, FRAME);
  const [rx, ry, lift] = SLIME_SQUASH[frame % 4];
  const cy = 59 - ry - lift;
  const base = 0x5cc24a;
  // Dome: flat-ish bottom, round top.
  g.ellipse(32.5, cy + 1, rx, ry, shade(base, -0.35));
  g.ellipse(32.5, cy, rx - 0.5, ry - 1, base);
  g.rect(Math.round(32.5 - rx + 2), Math.round(cy + ry - 3), Math.round(rx * 2 - 4), 2, shade(base, -0.2));
  g.ellipse(32.5 - rx * 0.35, cy - ry * 0.45, rx * 0.35, ry * 0.25, 0xb6f08a);
  g.px(Math.round(32.5 - rx * 0.5), Math.round(cy - ry * 0.55), 0xffffff);
  g.ellipse(32.5 + rx * 0.3, cy + ry * 0.3, rx * 0.4, ry * 0.25, shade(base, -0.12), 160);
  const l = look(facing);
  if (l.show) {
    for (const ex of [-4, 3]) {
      const x = 32 + ex + l.dx;
      g.rect(x, Math.round(cy - 1), 2, 3, 0x1d2a1a);
      g.px(x, Math.round(cy - 1), 0xffffff);
    }
    g.hline(31 + l.dx, Math.round(cy + 3), 3, 0x2a4a22);
  }
  g.outline(0x1e3a1a);
  return g;
}

const BAT_WING = [-6, 0, 5, 0]; // wingtip y offset per frame: up, level, down, level

export function drawBat(facing: Facing, frame: number): PixelGrid {
  const g = new PixelGrid(FRAME, FRAME);
  const bob = frame % 2 === 0 ? 0 : -1;
  const cx = 32;
  const cy = 34 + bob;
  const body = 0x6a4a8a;
  const wing = 0x4a3366;
  const tip = BAT_WING[frame % 4];
  for (const s of [-1, 1]) {
    // Membrane: three scallops hanging from the arm bone.
    const pts: [number, number][] = [
      [cx + s * 3, cy - 3],
      [cx + s * 10, cy - 4 + tip / 2],
      [cx + s * 17, cy - 5 + tip],
      [cx + s * 15, cy + 2 + tip],
      [cx + s * 12, cy + 1 + tip / 2],
      [cx + s * 9, cy + 4 + tip / 3],
      [cx + s * 6, cy + 2],
      [cx + s * 3, cy + 4],
    ];
    g.poly(pts, wing);
    g.line(cx + s * 3, cy - 3, cx + s * 17, cy - 5 + tip, shade(wing, 0.3));
  }
  g.ellipse(cx + 0.5, cy, 5, 6, body);
  g.ellipse(cx - 0.5, cy - 2, 2.5, 2.5, shade(body, 0.2));
  // Ears.
  g.poly([[cx - 4, cy - 4], [cx - 1, cy - 4], [cx - 3, cy - 9]], body);
  g.poly([[cx + 2, cy - 4], [cx + 5, cy - 4], [cx + 4, cy - 9]], body);
  const l = look(facing);
  if (l.show) {
    g.px(cx - 2 + l.dx, cy - 1, 0xffe066);
    g.px(cx + 2 + l.dx, cy - 1, 0xffe066);
    g.px(cx - 1 + l.dx, cy + 2, 0xffffff);
    g.px(cx + 1 + l.dx, cy + 2, 0xffffff);
  }
  g.outline(0x1c1228);
  return g;
}

export function drawRockCrab(facing: Facing, frame: number): PixelGrid {
  const g = new PixelGrid(FRAME, FRAME);
  const step = frame % 2 === 0 ? 1 : -1;
  const bob = frame % 2;
  const cy = 50 - bob;
  const leg = 0xc8643a;
  // Legs: three per side, alternating.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const lift = (i % 2 === 0 ? step : -step) > 0 ? 2 : 0;
      const x0 = 32 + s * (6 + i * 3);
      g.line(x0, cy + 2, x0 + s * 4, cy + 5, leg);
      g.line(x0 + s * 4, cy + 5, x0 + s * 5, 59 - lift, shade(leg, -0.2));
    }
  }
  // Claws in front.
  const l = look(facing);
  if (facing !== "up") {
    for (const s of [-1, 1]) {
      const x = 32 + s * 13 + l.dx;
      g.ball(x + 0.5, cy + 4, 3.5, 3, leg, shade(leg, -0.3), shade(leg, 0.35));
      g.px(x + (s > 0 ? -1 : 1), cy + 2, 0x3a1e14);
    }
  }
  // Shell: a craggy boulder.
  g.ellipse(32.5, cy - 4, 14, 10, P.stoneDark);
  g.ellipse(31.5, cy - 6, 12.5, 8.5, P.stone);
  g.ellipse(28.5, cy - 10, 6, 3.5, P.stoneLight);
  g.line(26, cy - 3, 30, cy - 7, P.stoneDark);
  g.line(36, cy - 9, 39, cy - 4, P.stoneDark);
  g.px(34, cy - 12, 0x7fc8d8);
  g.px(35, cy - 12, 0x7fc8d8);
  if (l.show) {
    for (const ex of [-3, 3]) {
      const x = 32 + ex + l.dx;
      g.vline(x, cy + 1, 3, 0x3a2a22);
      g.px(x, cy, 0x1a1414);
      g.px(x, cy + 1, 0xffffff);
    }
  }
  g.outline(0x231c22);
  return g;
}

export function drawMonster(kind: MonsterKind, facing: Facing, frame: number): PixelGrid {
  if (kind === "bat") return drawBat(facing, frame);
  if (kind === "rock_crab") return drawRockCrab(facing, frame);
  return drawSlime(facing, frame);
}
