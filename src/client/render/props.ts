// See ../contracts.ts for the contract.
import { AnimatedSprite, Container, Graphics, Sprite, Text, TextStyle, Texture, Ticker } from "pixi.js";
import type { CreatePropsLayer, SpriteArt } from "../contracts";
import { SCALE, SRC_TILE, TILE } from "../contracts";
import type { MapProp } from "../../shared/types";
import { fenceKey, fenceMasks } from "./fence";
import {
  INTERACTABLE_TYPES,
  LID_BUMP_MS,
  LID_FPS,
  lidBump,
  placeOnSurface,
  propSortZ,
  frontBodyZ,
  raisedZ,
  surfaceUnder,
  SWAY_TYPES,
  hitRect,
  phaseOf,
  pickProp,
  propFeet,
  type ArtExtent,
  type HitEntry,
} from "./props-geom";

function extentOf(art: SpriteArt): ArtExtent {
  const { width, height } = art.texture.frame;
  return { up: (height * art.anchor.y) / SRC_TILE, halfW: width / 2 / SRC_TILE };
}

function makeSprite(art: SpriteArt, x: number, y: number, z: number): Sprite {
  const s = new Sprite(art.texture);
  s.anchor.set(art.anchor.x, art.anchor.y);
  s.scale.set(SCALE);
  s.position.set(x, y);
  s.zIndex = z;
  s.cullable = true;
  return s;
}

const LABEL_STYLE = new TextStyle({
  fontFamily: "'Pixelify Sans', 'Press Start 2P', ui-monospace, monospace",
  fontSize: 13,
  fontWeight: "600",
  fill: 0x3a2a1c,
});

/** Small wooden plate with the destination name, centred on `x` with its bottom at `bottom`. */
function labelPlate(text: string, x: number, bottom: number, z: number): Container {
  const plate = new Container();
  const t = new Text({ text: text.slice(0, 24), style: LABEL_STYLE, resolution: 2 });
  const padX = 6;
  const padY = 3;
  const w = Math.ceil(t.width) + padX * 2;
  const h = Math.ceil(t.height) + padY * 2;
  const g = new Graphics()
    .roundRect(0, 0, w, h, 3)
    .fill({ color: 0xf6eed8 })
    .stroke({ color: 0x5a3920, width: 2 });
  t.position.set(padX, padY);
  plate.addChild(g, t);
  plate.position.set(Math.round(x - w / 2), Math.round(bottom - h));
  plate.zIndex = z;
  return plate;
}

type Anim =
  | { kind: "sway"; s: Sprite; phase: number; amp: number; speed: number }
  | { kind: "flicker"; s: Sprite; phase: number }
  | { kind: "ripple"; s: Sprite; phase: number }
  | { kind: "frames"; s: Sprite; phase: number; frames: Texture[] };

/** Fire, candle and torch flames: frame time of a looping catalog animation. */
const FLAME_FRAME_MS = 140;

function animFor(p: MapProp, s: Sprite): Anim | null {
  const phase = phaseOf(p.x, p.y);
  if (SWAY_TYPES.has(p.type))
    return p.type === "tree"
      ? { kind: "sway", s, phase, amp: 0.025, speed: 0.0011 + (phase % 1) * 0.0003 }
      : { kind: "sway", s, phase, amp: 0.035, speed: 0.0017 };
  if (p.type === "campfire") return { kind: "flicker", s, phase };
  if (p.type === "fishing_spot") return { kind: "ripple", s, phase };
  return null;
}

function tick(anims: Anim[], t: number): void {
  for (const a of anims) {
    if (!a.s.visible) continue;
    switch (a.kind) {
      case "frames": {
        const i = Math.floor((t + a.phase * 1000) / FLAME_FRAME_MS) % a.frames.length;
        if (a.s.texture !== a.frames[i]) a.s.texture = a.frames[i]!;
        break;
      }
      case "sway":
        // Skew pivots on the anchor (the trunk base), so only the canopy moves.
        a.s.skew.x = Math.sin(t * a.speed + a.phase) * a.amp + Math.sin(t * a.speed * 2.3 + a.phase) * a.amp * 0.3;
        break;
      case "flicker": {
        const f = 0.5 + 0.5 * Math.sin(t * 0.013 + a.phase) * Math.sin(t * 0.0071 + a.phase * 2);
        a.s.scale.y = SCALE * (1 + f * 0.05);
        const gb = 0xd8 + Math.round(f * 0x27);
        a.s.tint = (0xff << 16) | (gb << 8) | Math.round(gb * 0.85);
        break;
      }
      case "ripple": {
        const r = Math.sin(t * 0.003 + a.phase);
        a.s.alpha = 0.75 + 0.25 * r;
        a.s.scale.set(SCALE * (1 + 0.04 * r), SCALE * (1 - 0.03 * r));
        break;
      }
    }
  }
}

/**
 * A prop with a lid (shipping bin). With closed/opening/open frames in the art, an AnimatedSprite
 * plays them forward to open and backward to close; without, the container lifts a little. Both
 * sit in a container so a landing item can squash the bin about its feet.
 */
class Lid {
  readonly box = new Container();
  private anim: AnimatedSprite | null = null;
  private open = false;
  private bumpAt = -1;
  /** Fallback lift 0..1 when there are no frames. */
  private lift = 0;
  private ticking = false;

  constructor(private art: SpriteArt, x: number, y: number, z: number) {
    this.box.position.set(x, y);
    this.box.zIndex = z;
    let body: Sprite;
    if (art.open && art.open.length > 1) {
      const a = new AnimatedSprite({ textures: art.open, autoUpdate: true, loop: false });
      a.animationSpeed = LID_FPS / 60;
      a.gotoAndStop(0);
      this.anim = a;
      body = a;
    } else body = new Sprite(art.texture);
    body.anchor.set(art.anchor.x, art.anchor.y);
    body.scale.set(SCALE);
    this.box.addChild(body);
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    const a = this.anim;
    if (a) {
      // Negative speed plays the frames backwards and stops on "closed".
      a.animationSpeed = (open ? 1 : -1) * (LID_FPS / 60);
      a.play();
    } else this.startTick();
  }

  bump(): void {
    this.bumpAt = performance.now();
    // Flick the lid on the way in, then let it settle open again.
    if (this.anim && this.open) {
      this.anim.animationSpeed = LID_FPS / 60;
      this.anim.gotoAndPlay(1);
    }
    this.startTick();
  }

  private startTick(): void {
    if (this.ticking) return;
    this.ticking = true;
    Ticker.shared.add(this.tick, this);
  }

  private tick(ticker: Ticker): void {
    let busy = false;
    if (this.bumpAt >= 0) {
      const t = (performance.now() - this.bumpAt) / LID_BUMP_MS;
      const s = lidBump(t);
      this.box.scale.set(s.x, s.y);
      if (t >= 1) this.bumpAt = -1;
      else busy = true;
    }
    if (!this.anim) {
      const target = this.open ? 1 : 0;
      const step = ticker.deltaMS / 150;
      this.lift = target > this.lift ? Math.min(target, this.lift + step) : Math.max(target, this.lift - step);
      const body = this.box.children[0] as Sprite;
      body.position.y = -this.lift * 2 * SCALE;
      body.skew.x = -this.lift * 0.04;
      if (this.lift !== target) busy = true;
    }
    if (!busy) {
      Ticker.shared.remove(this.tick, this);
      this.ticking = false;
    }
  }

  destroy(): void {
    if (this.ticking) Ticker.shared.remove(this.tick, this);
    this.ticking = false;
    this.anim?.stop();
    this.box.destroy({ children: true });
  }
}

export const createPropsLayer: CreatePropsLayer = (art, map, layers) => {
  const owned: (Sprite | Container)[] = [];
  const hits: HitEntry[] = [];
  const anims: Anim[] = [];
  /** Sprites of props that change at runtime (choppable trees), by prop id. */
  const views = new Map<string, { body: Sprite; shadow: Sprite | null }>();
  const lids = new Map<string, Lid>();

  const fences = fenceMasks(map.props.filter((p) => p.type === "fence_deco"));
  for (const p of map.props) {
    const sa = (p.type === "fence_deco" && art.fence?.(fences.get(fenceKey(p.x, p.y)) ?? 0)) || art.prop(p.type);
    const ext = extentOf(sa);
    const feet = propFeet(p);
    const fx = feet.x * TILE;
    const fy = feet.y * TILE;

    // With a front overlay the overlay sorts in front of everyone at the footprint.
    const z = sa.front ? frontBodyZ(p) : propSortZ(p, fy);
    const raised = p.walkable ? raisedZ(p, map.props) : null;
    if (raised !== null) {
      // Hangings on the wall, candles and plates on tables: walkable, but drawn upright.
      let at = { x: fx, y: fy };
      const table = surfaceUnder(p, map.props);
      const top = table && art.prop(table.type).surface;
      if (table && top) {
        const tf = propFeet(table);
        const t = sa.texture;
        const d = placeOnSurface(p, table, top, { w: t.width, h: t.height, ax: sa.anchor.x * t.width, ay: sa.anchor.y * t.height });
        at = { x: tf.x * TILE + d.x * SCALE, y: tf.y * TILE + d.y * SCALE };
      }
      const s = makeSprite(sa, at.x, at.y, raised);
      layers.sorted.addChild(s);
      owned.push(s);
      if (sa.frames && sa.frames.length > 1) anims.push({ kind: "frames", s, phase: phaseOf(p.x, p.y), frames: sa.frames });
      continue;
    }
    let body: Sprite;
    if (p.type === "shipping_bin") {
      const lid = new Lid(sa, fx, fy, z);
      lids.set(p.id, lid);
      layers.sorted.addChild(lid.box);
      body = lid.box.children[0] as Sprite;
    } else body = makeSprite(sa, fx, fy, z);
    if (p.walkable) {
      // Rugs and mats lie on the floor: under everyone, nothing to click.
      layers.groundOverlay.addChild(body);
      owned.push(body);
      continue;
    }
    if (!lids.has(p.id)) {
      layers.sorted.addChild(body);
      owned.push(body);
    }
    if (sa.front) {
      const front = makeSprite(sa.front, fx, fy, fy + 1);
      layers.sorted.addChild(front);
      owned.push(front);
    }

    if (p.label) {
      // Default: just above the sprite's top edge when the art gives no label point.
      const at = sa.label ?? { x: 0, y: -sa.texture.height * SCALE * sa.anchor.y };
      const plate = labelPlate(p.label, fx + at.x, fy + at.y - 6 * SCALE, fy + 2);
      layers.sorted.addChild(plate);
      owned.push(plate);
    }

    if (p.type === "tree") views.set(p.id, { body, shadow: null });

    const a = animFor(p, body);
    if (a) anims.push(a);
    else if (sa.frames && sa.frames.length > 1) anims.push({ kind: "frames", s: body, phase: phaseOf(p.x, p.y), frames: sa.frames });

    if (INTERACTABLE_TYPES.has(p.type))
      hits.push({ id: p.id, footprint: { x: p.x, y: p.y, w: p.w, h: p.h }, hit: hitRect(p, ext) });
  }

  const onTick = (): void => tick(anims, performance.now());
  const ticker = Ticker.shared;
  if (anims.length) ticker.add(onTick);

  return {
    propAt: (tile) => pickProp(hits, tile),
    spriteOf: (id) => views.get(id) ?? null,
    setOpen(id, open) {
      lids.get(id)?.setOpen(open);
    },
    bump(id) {
      lids.get(id)?.bump();
    },
    destroy() {
      ticker.remove(onTick);
      for (const l of lids.values()) l.destroy();
      lids.clear();
      // Textures belong to the art module, so keep them.
      for (const s of owned) if (!s.destroyed) s.destroy({ children: true, texture: false, textureSource: false });
      owned.length = 0;
      hits.length = 0;
      anims.length = 0;
      views.clear();
    },
  };
};
