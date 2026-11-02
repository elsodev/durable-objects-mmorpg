// Players, NPCs and monsters: one pooled Container per entity (ground shadow + body sprite),
// y-sorted in layers.sorted, animated by facing/moving with manual frame stepping.
import { getItem } from "../../shared/items";
import { ColorMatrixFilter, Container, Graphics, GraphicsContext, Sprite } from "pixi.js";
import type { AnimalPose, Art, CharacterArt, CreateEntityLayer, EntityLayer, HeldArt, Layers } from "../contracts";
import { SCALE, TILE } from "../contracts";
import type { EntityState, Vec2 } from "../../shared/types";
import { runActionHook } from "./action-anim";
import { isSeated, seatedFallback, seatedZ, SIT_DROP_PX } from "./sit-pose";
import { blinkVisible, deathSquash, knockbackDone, knockbackOffset, slimePose } from "../game/combat-fx-logic";
import { actionFrame, actionNameFor, impactFrameOf, ITEM_POSE_ACTS, swingFrame } from "./tool-actions";
import { toolTiming } from "../../shared/engine/toolTiming";
import { heldFrameIndex, heldToShow } from "./held-logic";
import { createPoseLayer } from "./poses";
import { createDashFx } from "./dash-fx";
import { createFoodHand } from "./food-in-hand";
import { leanOffset, mealMotion } from "./counter-meal-logic";
import { isFootStrike, strideFrame, strideRate } from "./dash-logic";
import { createHaloArt, makeHalo, updateHalo, type Halo } from "./halo";
import { animalPoseFrame, bobOffset, hitScore, phaseOf, profileFor, squashFactor, walkFps, type EntityProfile } from "./entityProfile";

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
  /** The held tool's layers (EntityState.held): behind and in front of the body. */
  heldBg: Sprite;
  heldFg: Sprite;
  /** The food in the hand during an eat act (food-in-hand.ts). */
  food: Sprite;
  char: CharacterArt;
  spriteKey: string;
  look: unknown;
  profile: EntityProfile;
  state: EntityState;
  gen: number;
  clock: number;
  /** Walk cycle position in frames: advances at the profile fps, faster dashing, slower worn out. */
  stride: number;
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
  /** Walk frame last drawn (-1 when not walking), to catch the frame a foot lands on. */
  stepFrame: number;
  /** A foot landed since footstepOf() last asked. */
  stepped: boolean;
  /** Admin halo (EntityState.admin), built the first time this record draws an admin. */
  halo: Halo | null;
  /** Counter meal being eaten ("id:at") and when it was first seen: the sitter leans to each bite. */
  mealKey: string;
  mealStart: number;
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
  const poses = createPoseLayer(art, layers);
  const dash = createDashFx(art, layers);
  const foodHand = createFoodHand(art);
  /** Reused for foodOf(). */
  const foodAt: Vec2 = { x: 0, y: 0 };
  // Built on first use: most sessions never see an admin.
  let haloArt: ReturnType<typeof createHaloArt> | null = null;
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
    // A hold-up faces the viewer; eating plays in the direction you face.
    const facing = ITEM_POSE_ACTS.has(act.k) && act.k !== "eat" ? "down" : s.facing;
    const frames = art.frames[facing] ?? art.frames.down;
    // Walking cancels a held pose; a swing still plays out.
    // Tool swings follow the shared timing, so the tool lands when the effect does.
    const timing = toolTiming(act.k, s.facing);
    // Walking off mid-meal ends it for good: it doesn't pick up again when you stop.
    if (s.moving && act.k === "eat") rec.actStart = -Infinity;
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

  /** The sitter's lean while a counter meal is eaten, timed from when this client first saw it. */
  function mealLean(rec: Rec, s: EntityState, now: number): { dx: number; dy: number } | null {
    if (!s.meal) return null;
    const key = `${s.meal.seat}:${s.meal.at}`;
    if (key !== rec.mealKey) {
      rec.mealKey = key;
      rec.mealStart = now;
    }
    return leanOffset(s.facing, mealMotion(now - rec.mealStart).lean);
  }

  /** Animals sitting, napping or happy: their pose frames loop in place (same anchor as walking). */
  function playAnimalPose(rec: Rec, s: EntityState, now: number): boolean {
    const act = s.act;
    const frames = s.kind === "animal" && act && !s.moving ? rec.char.poses?.[act.k as AnimalPose] : undefined;
    if (!act || !frames) return false;
    const key = `${act.k}:${act.at}`;
    if (key !== rec.poseKey) {
      rec.poseKey = key;
      rec.poseStart = now;
    }
    const list = frames[s.facing] ?? frames.down;
    const i = animalPoseFrame(act.k, now - rec.poseStart, list.length);
    if (i < 0) return false;
    const tex = list[i]!;
    if (rec.body.texture !== tex) rec.body.texture = tex;
    return true;
  }

  /**
   * The held tool rides the body: same anchor, offset, scale and alpha, with the frame that
   * matches the body's walk frame, so it bobs with each step. Its sheets load on first use.
   */
  function drawHeld(rec: Rec, s: EntityState, item: string | null, walkIndex: number): void {
    const art = item ? (rec.char.held?.(item) ?? null) : null;
    const layers: [Sprite, HeldArt["bg"]][] = [
      [rec.heldBg, art?.bg ?? null],
      [rec.heldFg, art?.fg ?? null],
    ];
    for (const [sprite, sheet] of layers) {
      const frames = sheet?.[s.facing] ?? null;
      const i = frames ? heldFrameIndex(walkIndex, frames.length) : -1;
      if (!frames || i < 0) {
        sprite.visible = false;
        continue;
      }
      const t = frames[i]!;
      if (sprite.texture !== t) sprite.texture = t;
      sprite.anchor.copyFrom(rec.body.anchor);
      sprite.position.copyFrom(rec.body.position);
      sprite.scale.copyFrom(rec.body.scale);
      sprite.skew.copyFrom(rec.body.skew);
      sprite.alpha = rec.body.alpha;
      sprite.visible = true;
    }
  }

  /** Admins wear a halo just above the head, wherever the head is (walking, seated, lying down). */
  function drawHalo(rec: Rec, s: EntityState, headTop: number, now: number): void {
    const on = s.kind === "player" && s.admin === true && rec.deathT < 0;
    if (!on) {
      if (rec.halo) rec.halo.root.visible = false;
      return;
    }
    if (!rec.halo) {
      haloArt ??= createHaloArt();
      rec.halo = makeHalo(haloArt);
      rec.root.addChild(rec.halo.root);
    }
    rec.halo.root.visible = true;
    updateHalo(rec.halo, headTop, now, phaseOf(rec.id) * Math.PI * 2);
  }

  function acquire(s: EntityState): Rec {
    let rec = pool.pop();
    if (!rec) {
      const root = new Container();
      const shadow = new Graphics(shadowCtx);
      const body = new Sprite();
      body.scale.set(SCALE);
      const heldBg = new Sprite();
      const heldFg = new Sprite();
      const food = new Sprite();
      heldBg.visible = heldFg.visible = food.visible = false;
      root.addChild(shadow, heldBg, body, heldFg, food);
      rec = {
        id: s.id,
        root,
        shadow,
        body,
        heldBg,
        heldFg,
        food,
        char: undefined as unknown as CharacterArt,
        spriteKey: "",
        look: undefined,
        profile: profileFor(s.sprite),
        state: s,
        gen: 0,
        clock: 0,
        stride: 0,
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
        halo: null,
        mealKey: "",
        mealStart: 0,
        stepFrame: -1,
        stepped: false,
      };
    }
    rec.id = s.id;
    rec.state = s;
    // An action that happened before we saw this entity is not replayed.
    rec.actKey = s.act ? `${s.act.k}:${s.act.at}` : "";
    rec.actStart = -Infinity;
    rec.clock = 0;
    rec.stride = 0;
    rec.phaseMs = phaseOf(s.id) * 10_000;
    rec.flashMs = 0;
    rec.slide = null;
    rec.blinkMs = 0;
    rec.deathT = -1;
    rec.poseKey = s.act ? `${s.act.k}:${s.act.at}` : "";
    rec.poseStart = -Infinity;
    rec.stepFrame = -1;
    rec.stepped = false;
    rec.mealKey = "";
    rec.body.x = 0;
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
    poses.release(rec.id);
    dash.release(rec.id);
    rec.body.skew.x = 0;
    rec.heldBg.skew.x = rec.heldFg.skew.x = 0;
    rec.heldBg.visible = rec.heldFg.visible = rec.food.visible = false;
    if (rec.halo) rec.halo.root.visible = false;
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
    rec.stride += (dt * walkFps(p, s) * strideRate(s.moving ? s.pace : undefined)) / 1000;

    const seated = isSeated(s);
    const animating = !seated && (s.moving || p.animateIdle);
    const frames = c.walk[s.facing] ?? c.walk.down;
    const walkIndex = animating && frames.length > 0 ? strideFrame(rec.stride, frames.length, s.moving ? s.pace : undefined) : 0;
    const tex = animating && frames.length > 0 ? frames[walkIndex] : c.idle[s.facing] ?? c.idle.down;
    // Footsteps follow the art: a step sounds on the frames where a foot touches the ground, so
    // the sound keeps time with walking, dashing and the slow tired shuffle alike.
    if (animating && s.moving && frames.length > 2) {
      if (walkIndex !== rec.stepFrame && isFootStrike(walkIndex, frames.length)) rec.stepped = true;
      rec.stepFrame = walkIndex;
    } else rec.stepFrame = -1;
    const now = performance.now();
    let acting = false;
    if (seated) {
      // The character's own "sit" frame; without sit art (or while it loads) the whole idle frame.
      if (!playAction(rec, s, now)) {
        const t = seatedFallback(c, s.facing);
        if (rec.body.texture !== t) rec.body.texture = t;
      }
    } else {
      acting = playAction(rec, s, now) || runActionHook(rec.body, s, now) || playAnimalPose(rec, s, now);
      if (!acting && rec.body.texture !== tex) rec.body.texture = tex;
    }

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
    // Eating at the counter: lean toward the plate for each bite (counter-meal-logic.ts).
    const lean = seated ? mealLean(rec, s, now) : null;
    if (lean) {
      rec.body.x = lean.dx * SCALE;
      rec.body.y += lean.dy * SCALE;
    } else if (rec.mealKey) {
      rec.mealKey = "";
      rec.body.x = 0;
    }
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

    // /sleep and /piss draw over whatever the body showed above.
    const posed = seated ? { posed: false } : poses.draw(rec, s, c, now);
    // A dash leans and bobs the walking body; the held tool copies it just below.
    dash.apply(rec, acting || posed.posed || seated ? { ...s, moving: false } : s, walkIndex, frames.length, now);
    const shown = heldToShow(s, { acting: acting || posed.posed, seated, dying: rec.deathT >= 0 });
    drawHeld(rec, s, shown, walkIndex);
    const eating = acting && !seated && s.act?.k === "eat" && rec.actKey === `${s.act.k}:${s.act.at}`;
    // Eating plays the bites; otherwise selected food rides in the hand, ready to eat.
    if (!foodHand.draw(rec.food, rec.body, s, eating ? now - rec.actStart : null)) {
      foodHand.carry(rec.food, rec.body, s, shown && getItem(shown)?.kind === "food" ? shown : null);
    }

    // Higher off the ground = smaller, fainter shadow.
    const height = lift / (TILE * 0.75);
    rec.shadow.scale.set(p.shadow * (1 - Math.min(0.35, height * 0.25)));
    rec.shadow.alpha = 1 - Math.min(0.4, height * 0.3);
    if (!posed.posed || posed.head === undefined) rec.shadow.visible = !seated; // the chair has its own

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
    rec.head.y = posed.head !== undefined ? fy - posed.head : fy + rec.body.y - top;
    drawHalo(rec, s, rec.head.y - fy, now);

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
      dash.tick(performance.now());
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

    footstepOf(id) {
      const rec = live.get(id);
      if (!rec?.stepped) return false;
      rec.stepped = false;
      return true;
    },
    foodOf(id) {
      const rec = live.get(id);
      if (!rec || rec.removing || !rec.food.visible) return null;
      foodAt.x = rec.root.position.x + rec.food.position.x;
      foodAt.y = rec.root.position.y + rec.food.position.y;
      return foodAt;
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
      haloArt?.destroy();
      poses.destroy();
      dash.destroy();
      foodHand.destroy();
    },
  };
}) satisfies CreateEntityLayer;
