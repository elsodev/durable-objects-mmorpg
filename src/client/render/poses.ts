// The /sleep and /piss poses (shared/poses.ts), drawn over any character without new body frames:
// lying down turns the character's own back-view frame on its side under a quilt, so every body
// type and outfit works; peeing is the standing frame plus a stream and a puddle. Geometry and
// timing are in pose-logic.ts.
import { Container, Sprite, type Texture } from "pixi.js";
import type { Art, CharacterArt, Layers } from "../contracts";
import { SCALE, TILE } from "../contracts";
import { PEE_MS } from "../../shared/poses";
import type { EntityState } from "../../shared/types";
import { LIE, puddleAt, puddleOffset, STREAM_FRAME_MS, STREAM_STRETCH, streamPlacement, ZZZ_EVERY_MS, ZZZ_LIFE_MS, zzzAt } from "./pose-logic";

/** What the entity layer needs from one entity's display record. */
export interface PoseTarget {
  id: string;
  root: Container;
  body: Sprite;
  shadow: { visible: boolean };
}

export interface PoseResult {
  /** A pose drew the body this frame (skip actions and the held tool). */
  posed: boolean;
  /** Name tag height above the feet point in screen px, when the pose moves it. */
  head?: number;
}

export interface PoseLayer {
  draw(t: PoseTarget, s: EntityState, c: CharacterArt, now: number): PoseResult;
  release(id: string): void;
  destroy(): void;
}

interface Extras {
  key: string;
  start: number;
  quilt: Sprite | null;
  pillow: Sprite | null;
  zzz: Sprite[];
  stream: Sprite | null;
  puddleSeen: boolean;
}

interface Puddle {
  s: Sprite;
  start: number;
}

export function createPoseLayer(art: Art, layers: Layers): PoseLayer {
  const tex = (key: string): { frames: Texture[]; anchor: { x: number; y: number } } | null => {
    const a = art.prop(key);
    if (!a?.texture) return null;
    return { frames: a.frames && a.frames.length > 0 ? a.frames : [a.texture], anchor: a.anchor };
  };
  const cache = new Map<string, ReturnType<typeof tex>>();
  const get = (key: string) => {
    if (!cache.has(key)) cache.set(key, tex(key));
    return cache.get(key)!;
  };
  const sprite = (key: string): Sprite | null => {
    const t = get(key);
    if (!t) return null;
    const s = new Sprite(t.frames[0]!);
    s.anchor.set(t.anchor.x, t.anchor.y);
    s.scale.set(SCALE);
    return s;
  };

  const extras = new Map<string, Extras>();
  const puddles: Puddle[] = [];

  const clear = (t: PoseTarget, c: CharacterArt, e: Extras | undefined): void => {
    if (t.body.rotation !== 0) {
      t.body.rotation = 0;
      t.body.x = 0;
      t.body.anchor.set(c.anchor.x, c.anchor.y);
    }
    t.shadow.visible = true;
    if (!e) return;
    for (const s of [e.quilt, e.pillow, e.stream, ...e.zzz]) s?.destroy();
    extras.delete(t.id);
  };

  const tickPuddles = (now: number): void => {
    for (let i = puddles.length - 1; i >= 0; i--) {
      const p = puddles[i]!;
      const st = puddleAt(now - p.start);
      if (!st || p.s.destroyed) {
        p.s.destroy();
        puddles.splice(i, 1);
        continue;
      }
      const frames = get("fx_puddle")?.frames;
      if (frames) p.s.texture = frames[Math.min(frames.length - 1, st.frame)]!;
      p.s.alpha = st.alpha;
    }
  };

  let lastTick = -1;

  return {
    draw(t, s, c, now) {
      if (now !== lastTick) {
        lastTick = now;
        tickPuddles(now);
      }
      const act = s.act;
      const k = act?.k;
      let e = extras.get(t.id);
      const key = act ? `${act.k}:${act.at}` : "";
      if (!act || (k !== "lie" && k !== "pee") || (k === "lie" && s.moving)) {
        clear(t, c, e);
        return { posed: false };
      }
      if (!e || e.key !== key) {
        clear(t, c, e);
        e = { key, start: now, quilt: null, pillow: null, zzz: [], stream: null, puddleSeen: false };
        extras.set(t.id, e);
      }
      const age = now - e.start;
      t.body.anchor.set(c.anchor.x, c.anchor.y);

      if (k === "lie") {
        t.body.texture = c.idle.up ?? c.idle.down;
        t.body.rotation = LIE.rotation;
        t.body.scale.set(SCALE);
        t.body.position.set(LIE.body.x * SCALE, LIE.body.y * SCALE);
        t.shadow.visible = false;
        if (!e.pillow) {
          e.pillow = sprite("fx_pillow");
          if (e.pillow) t.root.addChildAt(e.pillow, Math.max(0, t.root.getChildIndex(t.body)));
        }
        if (!e.quilt) {
          e.quilt = sprite("fx_quilt");
          if (e.quilt) t.root.addChildAt(e.quilt, t.root.getChildIndex(t.body) + 1);
        }
        e.pillow?.position.set(LIE.pillow.x * SCALE, LIE.pillow.y * SCALE);
        e.quilt?.position.set(LIE.quilt.x * SCALE, LIE.quilt.y * SCALE);
        // A new Z every ZZZ_EVERY_MS, each rising and fading out.
        const zf = get("fx_zzz")?.frames;
        if (zf) {
          const live = Math.ceil(ZZZ_LIFE_MS / ZZZ_EVERY_MS);
          while (e.zzz.length < live) {
            const z = sprite("fx_zzz");
            if (!z) break;
            t.root.addChild(z);
            e.zzz.push(z);
          }
          e.zzz.forEach((z, i) => {
            const born = Math.floor(age / ZZZ_EVERY_MS) * ZZZ_EVERY_MS - i * ZZZ_EVERY_MS;
            const st = zzzAt(age - born, Math.floor(born / ZZZ_EVERY_MS));
            z.visible = !!st && born >= 0;
            if (!st) return;
            z.texture = zf[st.frame]!;
            z.alpha = st.alpha;
            z.position.set((LIE.zzz.x + st.dx) * SCALE, (LIE.zzz.y + st.dy) * SCALE);
          });
        }
        return { posed: true, head: LIE.head * SCALE };
      }

      // Pee: the idle frame of the way they face, a stream while it lasts, and a puddle that stays.
      t.body.texture = c.idle[s.facing] ?? c.idle.down;
      if (!e.puddleSeen) {
        e.puddleSeen = true;
        const ps = sprite("fx_puddle");
        if (ps) {
          const o = puddleOffset(s.facing);
          ps.position.set(s.x * TILE + o.x * SCALE, s.y * TILE + o.y * SCALE);
          layers.groundOverlay.addChild(ps);
          puddles.push({ s: ps, start: now });
        }
      }
      const place = streamPlacement(s.facing);
      if (age >= PEE_MS || !place) {
        e.stream?.destroy();
        e.stream = null;
        return { posed: age < PEE_MS };
      }
      const key2 = place.kind === "side" ? "fx_pee_side" : "fx_pee_front";
      const frames = get(key2)?.frames;
      if (!e.stream && frames) {
        e.stream = sprite(key2);
        if (e.stream) t.root.addChild(e.stream);
      }
      if (e.stream && frames) {
        e.stream.texture = frames[Math.floor(age / STREAM_FRAME_MS) % frames.length]!;
        e.stream.scale.set(place.flip ? -SCALE : SCALE, SCALE * STREAM_STRETCH);
        e.stream.position.set(place.x * SCALE, place.y * SCALE);
      }
      return { posed: true };
    },

    release(id) {
      const e = extras.get(id);
      if (!e) return;
      for (const s of [e.quilt, e.pillow, e.stream, ...e.zzz]) s?.destroy();
      extras.delete(id);
    },

    destroy() {
      for (const id of [...extras.keys()]) this.release(id);
      for (const p of puddles) p.s.destroy();
      puddles.length = 0;
    },
  };
}
