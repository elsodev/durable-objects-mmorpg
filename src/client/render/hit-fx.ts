// Hit effects for rocks and trees (mining, chopping): shakes, stone chips, leaves, crack marks,
// a falling tree, and drops popping out. Kept apart from effects.ts and farm.ts on purpose.
import { Container, Graphics, Sprite, Texture, Ticker } from "pixi.js";
import type { Art, Layers } from "../contracts";
import { SCALE, TILE } from "../contracts";
import type { ItemId, Vec2 } from "../../shared/types";
import { crackLines, fallAngle, particleBurst, shakeOffset, type Particle } from "./hit-fx-logic";

export type ChipKind = "stone" | "leaf" | "wood" | "slime" | "bat" | "rock_crab";

const PALETTE: Record<ChipKind, number[]> = {
  stone: [0x8a8a92, 0x6a6a72, 0xb0aeb4, 0x5a5660],
  leaf: [0x5e9a3a, 0x7cb048, 0x3f7a2e, 0x9cc860],
  wood: [0x8a5a32, 0x6a4024, 0xb07a48],
  // Monster chips: what flies off a hit or a kill.
  slime: [0x7ed957, 0x5cb83a, 0xa8ef7e, 0x3f9a2a],
  bat: [0x6a4a8a, 0x4a3266, 0x8e6ab0, 0x2e2040],
  rock_crab: [0xb0623a, 0x8a4a2a, 0xd08452, 0x6a6a72],
};

const MONSTER_CHIPS: ReadonlySet<ChipKind> = new Set(["slime", "bat", "rock_crab"]);
const SHAKE_MS = 260;
const FALL_MS = 700;
const DROP_MS = 900;

interface Live {
  s: Sprite;
  p: Particle;
}
interface Shake {
  s: Sprite;
  x: number;
  t: number;
  amp: number;
}
interface Drop {
  s: Sprite;
  from: Vec2;
  dx: number;
  t: number;
}
interface Fall {
  s: Sprite;
  dir: 1 | -1;
  t: number;
  done: () => void;
}

export interface HitFx {
  /** Wobbles a sprite for a moment (rock or tree that was hit). */
  shake(s: Sprite | null | undefined, amp?: number): void;
  /** A burst of chips at a tile point (tile coords). */
  chips(at: Vec2, kind: ChipKind, count: number, up?: number): void;
  /** Crack marks on a rock: stage of need (0 clears). */
  crack(id: string, at: Vec2, stage: number, need: number): void;
  /** Tips a tree sprite over (it fades as it lands), then calls done. */
  fall(s: Sprite, dir: 1 | -1, done: () => void): void;
  /** Item icons popping out of a tile in little arcs. */
  drops(at: Vec2, items: readonly ItemId[]): void;
  destroy(): void;
}

export function createHitFx(art: Art, layers: Layers): HitFx {
  const root = new Container();
  root.zIndex = 1e9; // above every y-sorted thing
  layers.sorted.addChild(root);
  const live: Live[] = [];
  const shakes: Shake[] = [];
  const drops: Drop[] = [];
  const falls: Fall[] = [];
  const cracks = new Map<string, Graphics>();
  let seed = 1;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const tick = (t: Ticker): void => {
    const dt = Math.min(100, t.deltaMS);
    for (let i = live.length - 1; i >= 0; i--) {
      const l = live[i]!;
      const p = l.p;
      p.age += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      l.s.position.set(p.x * TILE, p.y * TILE);
      l.s.rotation += p.spin * dt;
      l.s.alpha = Math.max(0, 1 - p.age / p.life);
      if (p.age >= p.life) {
        l.s.destroy();
        live.splice(i, 1);
      }
    }
    for (let i = shakes.length - 1; i >= 0; i--) {
      const k = shakes[i]!;
      k.t += dt;
      if (k.s.destroyed) {
        shakes.splice(i, 1);
        continue;
      }
      k.s.x = k.x + shakeOffset(k.t, SHAKE_MS, k.amp);
      if (k.t >= SHAKE_MS) {
        k.s.x = k.x;
        shakes.splice(i, 1);
      }
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]!;
      d.t += dt;
      const f = Math.max(0, Math.min(1, d.t / DROP_MS));
      d.s.visible = d.t >= 0;
      // A hop up and out, then a small bounce where it lands.
      const hop = Math.sin(Math.min(1, f * 1.4) * Math.PI) * 0.9 + (f > 0.72 ? Math.sin(((f - 0.72) / 0.28) * Math.PI) * 0.15 : 0);
      d.s.position.set((d.from.x + d.dx * Math.min(1, f * 1.4)) * TILE, (d.from.y - hop) * TILE);
      d.s.alpha = f < 0.8 ? 1 : 1 - (f - 0.8) / 0.2;
      if (f >= 1) {
        d.s.destroy();
        drops.splice(i, 1);
      }
    }
    for (let i = falls.length - 1; i >= 0; i--) {
      const fl = falls[i]!;
      fl.t += dt;
      if (fl.s.destroyed) {
        falls.splice(i, 1);
        continue;
      }
      fl.s.rotation = fallAngle(fl.t, FALL_MS) * fl.dir;
      fl.s.alpha = fl.t < FALL_MS * 0.7 ? 1 : Math.max(0, 1 - (fl.t - FALL_MS * 0.7) / (FALL_MS * 0.3));
      if (fl.t >= FALL_MS) {
        falls.splice(i, 1);
        fl.s.rotation = 0;
        fl.s.alpha = 1;
        fl.done();
      }
    }
  };
  Ticker.shared.add(tick);

  return {
    shake(s, amp = 1.5) {
      if (!s || s.destroyed) return;
      const prev = shakes.find((k) => k.s === s);
      if (prev) {
        prev.t = 0;
        return;
      }
      shakes.push({ s, x: s.x, t: 0, amp: amp * SCALE });
    },

    chips(at, kind, count, up = 0.4) {
      const colors = PALETTE[kind];
      for (const p of particleBurst(at, count, kind === "leaf" ? "float" : "chip", rand, up)) {
        const s = new Sprite(Texture.WHITE);
        s.anchor.set(0.5);
        // Monster chips are chunkier: they read as bits of the creature, not grit.
        const size = (kind === "leaf" ? 2.5 : MONSTER_CHIPS.has(kind) ? 3 : 2) * SCALE * (0.7 + rand() * 0.6);
        s.width = size;
        s.height = kind === "leaf" ? size * 0.6 : size;
        s.tint = colors[Math.floor(rand() * colors.length)]!;
        s.position.set(p.x * TILE, p.y * TILE);
        root.addChild(s);
        live.push({ s, p });
      }
    },

    crack(id, at, stage, need) {
      let g = cracks.get(id);
      if (stage <= 0 || need <= 1) {
        g?.destroy();
        cracks.delete(id);
        return;
      }
      if (!g) {
        g = new Graphics();
        cracks.set(id, g);
        layers.sorted.addChild(g);
      }
      g.clear();
      for (const [x0, y0, x1, y1] of crackLines(id, stage, need)) g.moveTo(x0 * SCALE, y0 * SCALE).lineTo(x1 * SCALE, y1 * SCALE);
      g.stroke({ color: 0x2a2228, width: SCALE, alpha: 0.85 });
      // Centred on the rock body (a little above the tile's foot), drawn just in front of it.
      g.position.set((at.x + 0.5) * TILE, (at.y + 0.55) * TILE);
      g.zIndex = (at.y + 1) * TILE + 1;
    },

    fall(s, dir, done) {
      falls.push({ s, dir, t: 0, done });
    },

    drops(at, items) {
      items.forEach((item, i) => {
        const s = new Sprite(art.icon(item));
        s.anchor.set(0.5, 1);
        s.scale.set(SCALE * 0.55);
        root.addChild(s);
        const spread = items.length > 1 ? (i / (items.length - 1) - 0.5) * 1.1 : (rand() - 0.5) * 0.6;
        drops.push({ s, from: { x: at.x, y: at.y }, dx: spread, t: -i * 90 });
      });
    },

    destroy() {
      Ticker.shared.remove(tick);
      for (const k of shakes) if (!k.s.destroyed) k.s.x = k.x;
      for (const f of falls) if (!f.s.destroyed) f.done();
      for (const g of cracks.values()) g.destroy();
      cracks.clear();
      root.destroy({ children: true });
      live.length = shakes.length = drops.length = falls.length = 0;
    },
  };
}
