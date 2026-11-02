// The dash look on top of the walk cycle (numbers in dash-logic.ts): the lean and bob on the body,
// and the dust puffs left at each foot strike. Puffs live in the sorted layer at the ground point
// they were kicked up from, so the runner leaves them behind.
import { Sprite, type Texture } from "pixi.js";
import type { Art, Layers } from "../contracts";
import { SCALE, TILE } from "../contracts";
import type { EntityState } from "../../shared/types";
import { dashBob, dashLean, dustAt, dustSpot, isFootStrike } from "./dash-logic";

/** Puffs on screen at once, across every runner (oldest go first). */
const MAX_PUFFS = 48;

export interface DashTarget {
  id: string;
  body: Sprite;
}

export interface DashFx {
  /**
   * Leans and lifts a dashing body (call after the pose layer, before the held tool copies the
   * body) and kicks up a puff when `frame` is a new foot strike. Anything else stands straight.
   */
  apply(t: DashTarget, s: EntityState, frame: number, frames: number, now: number): void;
  /** Ages and removes puffs; once per frame. */
  tick(now: number): void;
  release(id: string): void;
  destroy(): void;
}

interface Puff {
  s: Sprite;
  born: number;
  /** Ground y (screen px) it rises from. */
  y: number;
}

export function createDashFx(art: Art, layers: Layers): DashFx {
  let frames: Texture[] | null | undefined;
  const dustFrames = (): Texture[] | null => {
    if (frames === undefined) {
      const a = art.prop("fx_dash_dust");
      frames = a?.texture ? (a.frames && a.frames.length > 0 ? a.frames : [a.texture]) : null;
      anchor = a?.anchor ?? anchor;
    }
    return frames;
  };
  let anchor = { x: 0.5, y: 0.8 };
  const puffs: Puff[] = [];
  /** Per runner: the last walk frame seen and how many strikes so far (alternates the feet). */
  const runners = new Map<string, { frame: number; strikes: number }>();

  const kick = (s: EntityState, n: number, now: number): void => {
    const tex = dustFrames();
    if (!tex) return;
    if (puffs.length >= MAX_PUFFS) puffs.shift()!.s.destroy();
    const spot = dustSpot(s.facing, n);
    const sprite = new Sprite(tex[0]!);
    sprite.anchor.set(anchor.x, anchor.y);
    sprite.scale.set(SCALE);
    const x = s.x * TILE + spot.x * SCALE;
    const y = s.y * TILE + spot.y * SCALE;
    sprite.position.set(x, y);
    // Just behind anything standing on the same line, so a sideways runner's legs cover it.
    sprite.zIndex = y - 1;
    layers.sorted.addChild(sprite);
    puffs.push({ s: sprite, born: now, y });
  };

  return {
    apply(t, s, frame, count, now) {
      const dashing = s.pace === "dash" && s.moving;
      if (!dashing) {
        if (t.body.skew.x !== 0) t.body.skew.x = 0;
        runners.delete(t.id);
        return;
      }
      t.body.skew.x = dashLean(s.facing);
      t.body.y -= dashBob(frame, count) * SCALE;
      const r = runners.get(t.id);
      if (!r) {
        runners.set(t.id, { frame, strikes: 0 });
        return;
      }
      if (frame !== r.frame && isFootStrike(frame, count)) {
        kick(s, r.strikes, now);
        r.strikes++;
      }
      r.frame = frame;
    },

    tick(now) {
      const tex = frames;
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i]!;
        const st = dustAt(now - p.born);
        if (!st || p.s.destroyed || !tex) {
          p.s.destroy();
          puffs.splice(i, 1);
          continue;
        }
        p.s.texture = tex[Math.min(tex.length - 1, st.frame)]!;
        p.s.alpha = st.alpha;
        p.s.y = p.y - st.rise * SCALE;
      }
    },

    release(id) {
      runners.delete(id);
    },

    destroy() {
      for (const p of puffs) p.s.destroy();
      puffs.length = 0;
      runners.clear();
    },
  };
}
