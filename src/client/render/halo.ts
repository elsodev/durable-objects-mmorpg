// The admin halo (EntityState.admin): a golden pixel ring over the head with a pulsing glow and
// orbiting sparkles. The ring and glow are shared GraphicsContexts built once; each admin gets a
// small Container riding their entity root. Geometry and timing live in halo-logic.ts.
import { Container, Graphics, GraphicsContext } from "pixi.js";
import { SCALE } from "../contracts";
import { HALO_RX, HALO_RY, HALO_SPARKLES, haloCentreY, haloPulse, haloRingCells, haloSparkle } from "./halo-logic";

// Outer band, inner band and the light catching the far rim; a dark rim keeps it crisp on any ground.
const RIM = 0x6e3a0a;
const OUTER = { front: 0xf0a823, back: 0xb8741a, shine: 0xffe9a0 } as const;
const INNER = { front: 0xffe25c, back: 0xd99a2b, shine: 0xfff8d8 } as const;
const GLOW = 0xffd95a;

export interface HaloArt {
  ring: GraphicsContext;
  glow: GraphicsContext;
  destroy(): void;
}

export function createHaloArt(): HaloArt {
  const ring = new GraphicsContext();
  const px = (x: number, y: number, color: number, alpha = 1) =>
    ring.rect((x - 0.5) * SCALE, (y - 0.5) * SCALE, SCALE, SCALE).fill({ color, alpha });
  // Two pixels thick: an outer and an inner ellipse, inside a one-pixel dark rim.
  const outer = haloRingCells(HALO_RX, HALO_RY);
  const inner = haloRingCells(HALO_RX - 1, HALO_RY - 1);
  const filled = new Set([...outer, ...inner].map((c) => `${c.x},${c.y}`));
  for (const c of [...outer, ...inner]) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const k = `${c.x + dx},${c.y + dy}`;
      // The hole stays open: no rim inside the inner band.
      if (filled.has(k) || ((c.x + dx) / (HALO_RX - 1)) ** 2 + ((c.y + dy) / (HALO_RY - 1)) ** 2 < 1) continue;
      filled.add(k);
      // The far rim reads softer than the near edge.
      px(c.x + dx, c.y + dy, RIM, dy > 0 && c.y >= 0 ? 0.9 : 0.6);
    }
  }
  for (const c of outer) px(c.x, c.y, OUTER[c.tone]);
  for (const c of inner) px(c.x, c.y, INNER[c.tone]);
  const glow = new GraphicsContext();
  const rings = 5;
  for (let i = 0; i < rings; i++) {
    const f = 1.75 - i * 0.15;
    glow.ellipse(0, 0, HALO_RX * SCALE * f, HALO_RY * SCALE * f * 1.5).fill({ color: GLOW, alpha: 0.09 });
  }
  return {
    ring,
    glow,
    destroy() {
      ring.destroy();
      glow.destroy();
    },
  };
}

export interface Halo {
  root: Container;
  glow: Graphics;
  ring: Graphics;
  back: Graphics;
  front: Graphics;
}

export function makeHalo(art: HaloArt): Halo {
  const root = new Container();
  root.label = "halo";
  const glow = new Graphics(art.glow);
  glow.blendMode = "add";
  const back = new Graphics();
  const ring = new Graphics(art.ring);
  const front = new Graphics();
  root.addChild(glow, back, ring, front);
  return { root, glow, ring, back, front };
}

function drawSparkles(h: Halo, ms: number, phase: number): void {
  h.back.clear();
  h.front.clear();
  for (let i = 0; i < HALO_SPARKLES; i++) {
    const s = haloSparkle(ms, i, HALO_SPARKLES, phase);
    const g = s.front ? h.front : h.back;
    const x = Math.round(s.x) * SCALE;
    const y = Math.round(s.y) * SCALE;
    // A tiny four-point twinkle: centre plus arms.
    g.rect(x - SCALE / 2, y - SCALE * 1.5, SCALE, SCALE * 3).fill({ color: 0xffffff, alpha: s.alpha });
    g.rect(x - SCALE * 1.5, y - SCALE / 2, SCALE * 3, SCALE).fill({ color: 0xffffff, alpha: s.alpha * 0.8 });
  }
}

/** Places and animates the halo; `headTop` is the head's top relative to the entity root (screen px). */
export function updateHalo(h: Halo, headTop: number, ms: number, phase: number): void {
  h.root.position.set(0, Math.round(haloCentreY(headTop, SCALE, ms, phase)));
  const p = haloPulse(ms, phase);
  h.glow.alpha = 0.55 + 0.45 * p;
  h.glow.scale.set(1 + 0.08 * p);
  h.ring.alpha = 0.92 + 0.08 * p;
  drawSparkles(h, ms, phase);
}
