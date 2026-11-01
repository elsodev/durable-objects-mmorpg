// Players, NPCs and monsters: one pooled Container per entity (ground shadow + body sprite),
// y-sorted in layers.sorted, animated by facing/moving with manual frame stepping.
import { ColorMatrixFilter, Container, Graphics, GraphicsContext, Sprite } from "pixi.js";
import type { Art, CharacterArt, CreateEntityLayer, EntityLayer, Layers } from "../contracts";
import { SCALE, TILE } from "../contracts";
import type { EntityState, Vec2 } from "../../shared/types";
import { runActionHook } from "./action-anim";
import { isSeated, seatedFallback, seatedZ, SIT_DROP_PX } from "./sit-pose";
import { blinkVisible, deathSquash, knockbackDone, knockbackOffset, slimePose } from "../game/combat-fx-logic";
import { actionFrame, actionNameFor, impactFrameOf, ITEM_POSE_ACTS, swingFrame } from "./tool-actions";
import { toolTiming } from "../../shared/engine/toolTiming";
import { bobOffset, hitScore, phaseOf, profileFor, squashFactor, walkFrame, type EntityProfile } from "./entityProfile";

/**
 * The single place an entity's textures are chosen. Today it is the catalog sprite key; when
 * EntityState gains an optional `look` (runtime customization), pass a compositor here instead.
 * It is called again only when `sprite` or the `look` reference changes, so it may be costly.
 */
export type CharacterResolver = (art: Art, state: EntityState) => CharacterArt;
export const characterFor: CharacterResolver = (art, state) => art.character(state.sprite);

const FADE_IN_MS = 150;
const FADE_OUT_MS = 250;
const FLASH_MS = 100;
const POOL_MAX = 32;
const MAX_DT = 100;
const PRELOAD_ACTIONS = ["eat", "hold_up"] as const;

type WithLook = EntityState & { look?: unknown };

interface Rec {
  id: string;
  root: Container;
  shadow: Graphics;
  body: Sprite;
  char: CharacterArt;
  spriteKey: string;
  look: unknown;
  profile: EntityProfile;
  state: EntityState;
  gen: number;
  clock: number;
  phaseMs: number;
  flashMs: number;
  removing: boolean;
  /** Reused for headOf() so overlays polling every frame allocate nothing. */
  head: Vec2;
  /** Server action being played ("k:at"), when it was first seen locally, and whether its anchor is applied. */
  actKey: string;
  actStart: number;
  actAnchored: boolean;
  /** Predicted knockback slide playing (tiles) and how long ago it started. */
  slide: Vec2 | null;
  slideT: number;
  /** Hurt blink: time into it and its length. */
  blinkT: number;
  blinkMs: number;
  /** Time since death (-1 alive). */
  deathT: number;
  /** Monster pose act (slime crouch / leap) and when it was first seen. */
  poseKey: string;
  poseStart: number;
}

/** Soft drop shadow: stacked translucent ellipses fake a blurred edge without a filter. */
function makeShadowContext(): GraphicsContext {
  const ctx = new GraphicsContext();
  const rx = 13 * SCALE;
  const ry = 5 * SCALE;
  const rings = 5;
  for (let i = 0; i < rings; i++) {
    const f = 1 - i * 0.14;
    ctx.ellipse(0, 0, rx * f, ry * f).fill({ color: 0x1b1424, alpha: 0.075 });
  }
  return ctx;
}

/** Turns every opaque pixel pure white (offsets are 0..1 in Pixi v8). */
function makeFlashFilter(): ColorMatrixFilter {
  const f = new ColorMatrixFilter();
  f.matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];
  return f;
}

export const createEntityLayer = ((
  art: Art,
  layers: Layers,
  opts?: { characterFor?: CharacterResolver },
): EntityLayer => {
  const resolve = opts?.characterFor ?? characterFor;
  const shadowCtx = makeShadowContext();
  // Built on first hit: it compiles a shader, which most frames never need.
  let flashFilters: ColorMatrixFilter[] | null = null;
  const live = new Map<string, Rec>();
  const pool: Rec[] = [];
  let gen = 0;

  function applyCharacter(rec: Rec, s: EntityState): void {
    rec.char = resolve(art, s);
    rec.spriteKey = s.sprite;
    rec.look = (s as WithLook).look;
    rec.profile = profileFor(s.sprite);
    rec.body.anchor.set(rec.char.anchor.x, rec.char.anchor.y);
    rec.actAnchored = false;
    rec.shadow.scale.set(rec.profile.shadow);
    // Eating and holding up a gift come from the server without warning: start loading those
    // frames now so the first one isn't drawn as a plain idle pose.
    if (s.kind === "player") for (const name of PRELOAD_ACTIONS) rec.char.action?.(name);
  }

  /** Draws the frame of the entity's current tool/harvest action, if one is playing. */
  function playAction(rec: Rec, s: EntityState, now: number): boolean {
    const act = s.act;
    const done = (): boolean => {
      if (rec.actAnchored) {
        rec.body.anchor.set(rec.char.anchor.x, rec.char.anchor.y);
        rec.actAnchored = false;
      }
      return false;
    };
    if (!act || !rec.char.action) return done();
    const key = `${act.k}:${act.at}`;
    if (key !== rec.actKey) {
      rec.actKey = key;
      rec.actStart = now;
    }
    const name = actionNameFor(act);
    const art = name ? rec.char.action(name) : null;
    if (!art) return done();
    const facing = ITEM_POSE_ACTS.has(act.k) ? "down" : s.facing;
    const frames = art.frames[facing] ?? art.frames.down;
    // Walking cancels a held pose; a swing still plays out.
    // Tool swings follow the shared timing, so the tool lands when the effect does.
    const timing = toolTiming(act.k, s.facing);
    const age = now - rec.actStart;
    const i = s.moving && art.hold
      ? -1
      : timing
        ? swingFrame(age, frames.length, impactFrameOf(act.k, frames.length), timing)
        : actionFrame(age, art.ms, frames.length, art.hold);
    if (i < 0) return done();
    if (!rec.actAnchored) {
      rec.body.anchor.set(art.anchor.x, art.anchor.y);
      rec.actAnchored = true;
    }
    const tex = frames[i]!;
    if (rec.body.texture !== tex) rec.body.texture = tex;
    return true;
  }

  function acquire(s: EntityState): Rec {
    let rec = pool.pop();
    if (!rec) {
      const root = new Container();
      const shadow = new Graphics(shadowCtx);
      const body = new Sprite();
      body.scale.set(SCALE);
      root.addChild(shadow, body);
      rec = {
        id: s.id,
        root,
        shadow,
        body,
        char: undefined as unknown as CharacterArt,
        spriteKey: "",
        look: undefined,
        profile: profileFor(s.sprite),
        state: s,
        gen: 0,
        clock: 0,
        phaseMs: 0,
        flashMs: 0,
        removing: false,
        head: { x: 0, y: 0 },
        actKey: "",
        actStart: 0,
        actAnchored: false,
        slide: null,
        slideT: 0,
        blinkT: 0,
        blinkMs: 0,
        deathT: -1,
        poseKey: "",
        poseStart: 0,
      };
    }
    rec.id = s.id;
    rec.state = s;
    // An action that happened before we saw this entity is not replayed.
    rec.actKey = s.act ? `${s.act.k}:${s.act.at}` : "";
    rec.actStart = -Infinity;
    rec.clock = 0;
    rec.phaseMs = phaseOf(s.id) * 10_000;
    rec.flashMs = 0;
    rec.slide = null;
    rec.blinkMs = 0;
    rec.deathT = -1;
    rec.poseKey = s.act ? `${s.act.k}:${s.act.at}` : "";
    rec.poseStart = -Infinity;
    rec.body.alpha = 1;
    rec.removing = false;
    rec.body.filters = null;
    rec.root.alpha = 0;
    rec.root.visible = true;
    applyCharacter(rec, s);
    layers.sorted.addChild(rec.root);
    live.set(s.id, rec);
    return rec;
  }

  function release(rec: Rec): void {
    live.delete(rec.id);
    rec.root.removeFromParent();
    rec.body.filters = null;
    if (pool.length < POOL_MAX) pool.push(rec);
    else rec.root.destroy({ children: true });
  }

  function draw(rec: Rec, dt: number): void {
    const s = rec.state;
    const p = rec.profile;
    const c = rec.char;
    rec.clock += dt;

    const seated = isSeated(s);
    const animating = !seated && (s.moving || p.animateIdle);
    const frames = c.walk[s.facing] ?? c.walk.down;
    const tex = animating && frames.length > 0 ? frames[walkFrame(rec.clock, p.fps, frames.length)] : c.idle[s.facing] ?? c.idle.down;
    const now = performance.now();
    if (seated) {
      // The character's own "sit" frame; without sit art (or while it loads) the whole idle frame.
      if (!playAction(rec, s, now)) {
        const t = seatedFallback(c, s.facing);
        if (rec.body.texture !== t) rec.body.texture = t;
      }
    } else if (!playAction(rec, s, now) && !runActionHook(rec.body, s, now) && rec.body.texture !== tex) rec.body.texture = tex;

    const t = rec.clock + rec.phaseMs;
    if (s.kind === "monster" && s.act) {
      const key = `${s.act.k}:${s.act.at}`;
      if (key !== rec.poseKey) {
        rec.poseKey = key;
        rec.poseStart = now;
      }
    }
    const pose = s.kind === "monster" ? slimePose(s.act?.k, now - rec.poseStart) : { sx: 1, sy: 1, lift: 0 };
    const lift = (p.hover + bobOffset(p, t, s.moving)) * SCALE + pose.lift * TILE;
    const sq = squashFactor(p, t, s.moving);
    rec.body.y = seated ? SIT_DROP_PX * SCALE : -lift;
    let sx = pose.sx;
    let sy = pose.sy;
    if (rec.deathT >= 0) {
      rec.deathT += dt;
      const d = deathSquash(rec.deathT);
      sx *= d.sx;
      sy *= d.sy;
      rec.body.alpha = d.alpha;
    }
    rec.body.scale.set((SCALE / Math.sqrt(sq)) * sx, SCALE * sq * sy);
    if (rec.blinkMs > 0 && rec.deathT < 0) {
      rec.blinkT += dt;
      rec.body.alpha = blinkVisible(rec.blinkT, rec.blinkMs) ? 1 : 0.15;
      if (rec.blinkT >= rec.blinkMs) {
        rec.blinkMs = 0;
        rec.body.alpha = 1;
      }
    }

    // Higher off the ground = smaller, fainter shadow.
    const height = lift / (TILE * 0.75);
    rec.shadow.scale.set(p.shadow * (1 - Math.min(0.35, height * 0.25)));
    rec.shadow.alpha = 1 - Math.min(0.4, height * 0.3);
    rec.shadow.visible = !seated; // the chair has its own

    let ox = 0;
    let oy = 0;
    if (rec.slide) {
      rec.slideT += dt;
      const o = knockbackOffset(rec.slideT, rec.slide);
      ox = o.x;
      oy = o.y;
      if (knockbackDone(rec.slideT)) rec.slide = null;
    }
    const fx = (s.x + ox) * TILE;
    const fy = (s.y + oy) * TILE;
    rec.root.position.set(fx, fy);
    rec.root.zIndex = seated ? seatedZ(s.y) : fy;

    const top = Math.min(p.head, c.anchor.y * tex.height) * SCALE;
    rec.head.x = fx;
    // Seated bodies are drawn SIT_DROP_PX lower, so the name tag and bubbles follow them down.
    rec.head.y = fy + rec.body.y - top;

    if (rec.flashMs > 0) {
      rec.flashMs -= dt;
      if (rec.flashMs <= 0) rec.body.filters = null;
    }

    if (rec.removing) {
      rec.root.alpha -= dt / FADE_OUT_MS;
      if (rec.root.alpha <= 0) release(rec);
    } else if (rec.root.alpha < 1) {
      rec.root.alpha = Math.min(1, rec.root.alpha + dt / FADE_IN_MS);
    }
  }

  return {
    sync(states, dtMs) {
      const dt = Math.max(0, Math.min(MAX_DT, dtMs));
      gen++;
      for (let i = 0; i < states.length; i++) {
        const s = states[i];
        let rec = live.get(s.id);
        if (!rec) rec = acquire(s);
        rec.state = s;
        rec.gen = gen;
        rec.removing = false;
        if (rec.spriteKey !== s.sprite || rec.look !== (s as WithLook).look) applyCharacter(rec, s);
      }
      for (const rec of live.values()) {
        if (rec.gen !== gen) rec.removing = true;
        draw(rec, dt); // may release (delete from map) - safe during Map iteration
      }
    },

    entityAt(tile) {
      let best: string | null = null;
      let bestScore = Infinity;
      for (const rec of live.values()) {
        if (rec.removing) continue;
        const score = hitScore(rec.state, rec.profile, tile);
        if (score >= 0 && score < bestScore) {
          bestScore = score;
          best = rec.id;
        }
      }
      return best;
    },

    headOf(id) {
      const rec = live.get(id);
      return rec && !rec.removing ? rec.head : null;
    },

    flash(id) {
      const rec = live.get(id);
      if (!rec || rec.removing) return;
      rec.flashMs = FLASH_MS;
      flashFilters ??= [makeFlashFilter()];
      rec.body.filters = flashFilters;
    },

    nudge(id, slide) {
      const rec = live.get(id);
      if (!rec || rec.removing) return;
      rec.slide = { x: slide.x, y: slide.y };
      rec.slideT = 0;
    },

    blink(id, ms) {
      const rec = live.get(id);
      if (!rec || rec.removing) return;
      rec.blinkT = 0;
      rec.blinkMs = ms;
    },

    die(id) {
      const rec = live.get(id);
      if (rec && rec.deathT < 0) rec.deathT = 0;
    },

    destroy() {
      for (const rec of live.values()) rec.root.destroy({ children: true });
      for (const rec of pool) rec.root.destroy({ children: true });
      live.clear();
      pool.length = 0;
      flashFilters?.[0].destroy();
      shadowCtx.destroy();
    },
  };
}) satisfies CreateEntityLayer;
