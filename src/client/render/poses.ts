// The chat-command poses (shared/poses.ts), drawn over any character without new body frames:
// lying down turns the character's own back-view frame on its side under a quilt, meditating and
// sitting use each look's own generator sit frames, waving, cheering and thinking its slash and
// thrust frames, dancing its walk frames, so every body type and outfit works;
// peeing is the standing frame plus a stream and a puddle; climbing a ladder plays the look's
// back-view walk cycle sinking into a hole or rising up the wall. Geometry and timing are in
// pose-logic.ts.
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { Art, CharacterArt, Layers } from "../contracts";
import { SCALE, TILE } from "../contracts";
import { CHEER_MS, PEE_MS, WAVE_MS } from "../../shared/poses";
import { CLIMB_ACTS, CLIMB_MS } from "../../shared/climb";
import type { EntityState } from "../../shared/types";
import {
  CHEER,
  cheerLift,
  DANCE,
  danceAt,
  noteAt,
  SIT_GROUND,
  sparkleAt,
  THINK,
  thinkFrame,
  waveFrame,
} from "./pose-logic";
import { breathAt, climbAt, LIE, MEDITATE, MOTE_EVERY_MS, MOTE_LIFE_MS, moteAt, puddleAt, puddleOffset, STREAM_FRAME_MS, STREAM_STRETCH, streamPlacement, ZZZ_EVERY_MS, ZZZ_LIFE_MS, zzzAt } from "./pose-logic";

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
  glow: Sprite | null;
  motes: Sprite[];
  /** Climbing down: the hole's rim cuts the body off. */
  mask: Graphics | null;
  /** /think's thought bubble, /dance's notes, /cheer's sparkles. */
  bubble: Sprite | null;
  notes: Sprite[];
  sparkles: Sprite[];
}

/** Acts this layer draws (besides climbing). */
const DRAWN: ReadonlySet<string> = new Set(["lie", "pee", "meditate", "sit_ground", "wave", "cheer", "dance", "think"]);

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
  const destroyExtras = (e: Extras): void => {
    for (const s of [e.quilt, e.pillow, e.stream, e.glow, e.mask, e.bubble, ...e.zzz, ...e.motes, ...e.notes, ...e.sparkles]) s?.destroy();
  };
  /** Keeps `n` sprites of `key` in `list` (added on top of the entity), returning the frames. */
  const pool = (t: PoseTarget, list: Sprite[], key: string, n: number): Texture[] | null => {
    const frames = get(key)?.frames;
    if (!frames) return null;
    while (list.length < n) {
      const s = sprite(key);
      if (!s) break;
      t.root.addChild(s);
      list.push(s);
    }
    return frames;
  };
  const puddles: Puddle[] = [];

  const clear = (t: PoseTarget, c: CharacterArt, e: Extras | undefined): void => {
    if (t.body.rotation !== 0) {
      t.body.rotation = 0;
      t.body.x = 0;
      t.body.anchor.set(c.anchor.x, c.anchor.y);
    }
    t.shadow.visible = true;
    if (!e) return;
    if (e.mask) t.body.mask = null;
    if (e.key.startsWith("climb_")) t.body.alpha = 1;
    destroyExtras(e);
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
      const climb = !!k && CLIMB_ACTS.has(k);
      if (!act || (!DRAWN.has(k!) && !climb) || (k !== "pee" && !climb && s.moving)) {
        clear(t, c, e);
        return { posed: false };
      }
      if (!e || e.key !== key) {
        clear(t, c, e);
        e = { key, start: now, quilt: null, pillow: null, zzz: [], stream: null, puddleSeen: false, glow: null, motes: [], mask: null, bubble: null, notes: [], sparkles: [] };
        extras.set(t.id, e);
      }
      const age = now - e.start;
      t.body.anchor.set(c.anchor.x, c.anchor.y);

      if (climb) {
        // The look's own back-view walk cycle, sinking into the hole or rising up the ladder.
        const frames = c.walk.up?.length ? c.walk.up : [c.idle.up ?? c.idle.down];
        const st = climbAt(k as "climb_down" | "climb_up", age, CLIMB_MS, frames.length);
        t.body.texture = frames[st.frame] ?? frames[0]!;
        t.body.position.set(0, st.dy * SCALE);
        t.body.alpha = st.alpha;
        if (st.clipY !== null) {
          if (!e.mask) {
            e.mask = new Graphics().rect(-48 * SCALE, -120 * SCALE, 96 * SCALE, (120 + st.clipY) * SCALE).fill(0xffffff);
            t.root.addChild(e.mask);
            t.body.mask = e.mask;
          }
          t.shadow.visible = st.dy < 10;
        }
        return { posed: true, head: st.head * SCALE };
      }

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

      if (k === "meditate") {
        // The look's own cross-legged frame facing the viewer; standing idle while it loads.
        const art = c.action?.("meditate");
        t.body.texture = art?.frames.down[0] ?? c.idle.down;
        const b = breathAt(age);
        t.body.position.set(0, -b.lift * SCALE);
        if (!e.glow) {
          e.glow = sprite("fx_calm_glow");
          if (e.glow) t.root.addChildAt(e.glow, Math.max(0, t.root.getChildIndex(t.body)));
        }
        if (e.glow) {
          e.glow.position.set(MEDITATE.glow.x * SCALE, MEDITATE.glow.y * SCALE);
          e.glow.alpha = b.glow;
        }
        // A new mote every MOTE_EVERY_MS, each drifting up and fading.
        const mf = get("fx_mote")?.frames;
        if (mf) {
          const live = Math.ceil(MOTE_LIFE_MS / MOTE_EVERY_MS);
          while (e.motes.length < live) {
            const m = sprite("fx_mote");
            if (!m) break;
            t.root.addChild(m);
            e.motes.push(m);
          }
          const newest = Math.floor(age / MOTE_EVERY_MS);
          e.motes.forEach((m, i) => {
            const n = newest - i;
            const st = n >= 0 ? moteAt(age - n * MOTE_EVERY_MS, n) : null;
            m.visible = !!st;
            if (!st) return;
            m.texture = mf[st.frame]!;
            m.alpha = st.alpha;
            m.position.set(st.x * SCALE, st.y * SCALE);
          });
        }
        return { posed: true, head: MEDITATE.head * SCALE };
      }

      if (k === "sit_ground") {
        // The look's own sit-on-the-ground frame for the way they face; standing idle while it loads.
        const art = c.action?.("sit_ground");
        t.body.texture = art?.frames[s.facing]?.[0] ?? c.idle[s.facing] ?? c.idle.down;
        t.body.position.set(0, 0);
        return { posed: true, head: (art ? SIT_GROUND.head[s.facing] : 50) * SCALE };
      }

      if (k === "wave" || k === "cheer") {
        // Timed from when this client first saw it, like the pee (clocks differ between machines).
        // Done: keep the record (so it doesn't start over) but show nothing.
        if (age >= (k === "wave" ? WAVE_MS : CHEER_MS)) {
          for (const sp of e.sparkles) sp.visible = false;
          return { posed: false };
        }
        const art = c.action?.("wave");
        const frames = art?.frames[s.facing] ?? art?.frames.down;
        if (k === "wave") {
          t.body.texture = frames?.[waveFrame(age)] ?? c.idle[s.facing] ?? c.idle.down;
          t.body.position.set(0, 0);
          return { posed: true };
        }
        const lift = cheerLift(age);
        t.body.texture = frames?.[0] ?? c.idle[s.facing] ?? c.idle.down;
        t.body.position.set(0, -lift * SCALE);
        const sf = pool(t, e.sparkles, "fx_sparkle", Math.ceil(CHEER.sparkleLifeMs / CHEER.sparkleEveryMs));
        if (sf) {
          const newest = Math.floor(age / CHEER.sparkleEveryMs);
          e.sparkles.forEach((sp, i) => {
            const n = newest - i;
            const st = n >= 0 ? sparkleAt(age - n * CHEER.sparkleEveryMs, n) : null;
            sp.visible = !!st;
            if (!st) return;
            sp.texture = sf[st.frame]!;
            sp.position.set(st.x * SCALE, (st.y - lift) * SCALE);
          });
        }
        return { posed: true, head: (50 + lift) * SCALE };
      }

      if (k === "dance") {
        // Side to side on the beat with the look's own walk frames, notes drifting up.
        const st = danceAt(age, (c.walk[s.facing] ?? c.walk.down).length);
        const walk = c.walk[st.facing] ?? c.walk.down;
        t.body.texture = walk[st.frame] ?? c.idle[st.facing] ?? c.idle.down;
        t.body.position.set(0, -st.lift * SCALE);
        const nf = pool(t, e.notes, "fx_note", Math.ceil(DANCE.noteLifeMs / DANCE.noteEveryMs));
        if (nf) {
          const newest = Math.floor(age / DANCE.noteEveryMs);
          e.notes.forEach((m, i) => {
            const n = newest - i;
            const ns = n >= 0 ? noteAt(age - n * DANCE.noteEveryMs, n) : null;
            m.visible = !!ns;
            if (!ns) return;
            m.texture = nf[ns.frame % nf.length]!;
            m.alpha = ns.alpha;
            m.position.set(ns.x * SCALE, ns.y * SCALE);
          });
        }
        return { posed: true, head: (50 + st.lift) * SCALE };
      }

      if (k === "think") {
        // Hand at the chin, facing the viewer, with a thought bubble filling with dots.
        const art = c.action?.("think");
        t.body.texture = art?.frames.down[0] ?? c.idle.down;
        t.body.position.set(0, 0);
        if (!e.bubble) {
          e.bubble = sprite("fx_think");
          if (e.bubble) t.root.addChild(e.bubble);
        }
        const bf = get("fx_think")?.frames;
        if (e.bubble && bf) {
          e.bubble.texture = bf[thinkFrame(age)] ?? bf[0]!;
          e.bubble.position.set(THINK.bubble.x * SCALE, THINK.bubble.y * SCALE);
        }
        return { posed: true };
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
      destroyExtras(e);
      extras.delete(id);
    },

    destroy() {
      for (const id of [...extras.keys()]) this.release(id);
      for (const p of puddles) p.s.destroy();
      puddles.length = 0;
    },
  };
}
