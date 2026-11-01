// See ../contracts.ts for the contract.
import { Container, Graphics, Sprite, Text, TextStyle, Texture, Ticker } from "pixi.js";
import type { CreatePropsLayer, SpriteArt } from "../contracts";
import { SCALE, SRC_TILE, TILE } from "../contracts";
import type { MapProp } from "../../shared/types";
import { fenceKey, fenceMasks } from "./fence";
import {
  INTERACTABLE_TYPES,
  placeOnSurface,
  propSortZ,
  raisedZ,
  surfaceUnder,
  SWAY_TYPES,
  hitRect,
  phaseOf,
  pickProp,
  propFeet,
  shadowSize,
  castsShadow,
  type ArtExtent,
  type HitEntry,
} from "./props-geom";

let shadowTex: Texture | null = null;

/** One soft radial ellipse shared by every prop shadow (scaled per prop). */
function shadowTexture(): Texture {
  if (shadowTex && !shadowTex.destroyed) return shadowTex;
  if (typeof document === "undefined") return Texture.WHITE;
  const W = 64;
  const H = 32;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return Texture.WHITE;
  g.save();
  g.scale(1, H / W);
  const r = W / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(20,16,30,0.55)");
  grad.addColorStop(0.55, "rgba(20,16,30,0.32)");
  grad.addColorStop(1, "rgba(20,16,30,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, W);
  g.restore();
  const tex = Texture.from(c);
  tex.source.scaleMode = "linear";
  shadowTex = tex;
  return tex;
}

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

export const createPropsLayer: CreatePropsLayer = (art, map, layers) => {
  const owned: (Sprite | Container)[] = [];
  const hits: HitEntry[] = [];
  const anims: Anim[] = [];
  const shadow = shadowTexture();

  const fences = fenceMasks(map.props.filter((p) => p.type === "fence_deco"));
  for (const p of map.props) {
    const sa = (p.type === "fence_deco" && art.fence?.(fences.get(fenceKey(p.x, p.y)) ?? 0)) || art.prop(p.type);
    const ext = extentOf(sa);
    const feet = propFeet(p);
    const fx = feet.x * TILE;
    const fy = feet.y * TILE;

    // With a front overlay the main sprite sorts behind anyone from one row north of the
    // footprint through the footprint itself (the keeper), and the overlay sorts in front.
    const z = sa.front ? (p.y - 1) * TILE + 1 : propSortZ(p, fy);
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
    const body = makeSprite(sa, fx, fy, z);
    if (p.walkable) {
      // Rugs and mats lie on the floor: under everyone, no shadow, nothing to click.
      layers.groundOverlay.addChild(body);
      owned.push(body);
      continue;
    }
    layers.sorted.addChild(body);
    owned.push(body);
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

    if (!castsShadow(p)) continue;
    const sz = shadowSize(p, ext);
    const sh = new Sprite(shadow);
    sh.anchor.set(0.5);
    sh.width = sz.w * TILE;
    sh.height = sz.h * TILE;
    sh.position.set(fx, fy - sz.h * TILE * 0.3);
    if (p.type === "fishing_spot") sh.alpha = 0.25;
    sh.cullable = true;
    layers.groundOverlay.addChild(sh);
    owned.push(sh);

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
    destroy() {
      ticker.remove(onTick);
      // Textures belong to the art module (and the shadow texture is shared), so keep them.
      for (const s of owned) if (!s.destroyed) s.destroy({ children: true, texture: false, textureSource: false });
      owned.length = 0;
      hits.length = 0;
      anims.length = 0;
    },
  };
};
