// The item in an eat or hold-up act (EntityState.act { k: "eat" | "holdUp", item }): drawn at the
// mouth with chewing and crumbs of the item's own sprite, or held over the head. The body frames
// come from the character's "eat" / "hold_up" actions (entities.ts); this layer only adds the item,
// crumbs and the sound cues. Timing lives in item-pose-logic.ts.
import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import type { Art, Layers } from "../contracts";
import type { EntityState, ItemId, Vec2 } from "../../shared/types";
import { beatsBetween, poseAt, poseKindOf, poseLength, type PoseKind } from "./item-pose-logic";

/** On-screen size (px) of the item at scale 1. */
const ITEM_PX = 30;
const CRUMBS_PER_BITE = 3;
const CRUMB_LIFE_MS = 520;
const CRUMB_PX = 3;
const GRAVITY = 900;

interface Playing {
  key: string;
  kind: PoseKind;
  item: ItemId;
  start: number;
  lastAge: number;
  sprite: Sprite;
}

interface Crumb {
  sprite: Sprite;
  vx: number;
  vy: number;
  age: number;
}

export interface ItemPoses {
  /** Call every frame after entities.sync. `beat` fires on bites and the hold-up fanfare. */
  sync(states: EntityState[], headOf: (id: string) => Vec2 | null, nowMs: number, dtMs: number): void;
  destroy(): void;
}

export interface ItemPoseOpts {
  /** A bite (eat) or the fanfare (hold) of entity `id`. */
  beat?(id: string, kind: PoseKind, item: ItemId): void;
  rand?: () => number;
}

export function createItemPoses(art: Art, layers: Layers, opts: ItemPoseOpts = {}): ItemPoses {
  const rand = opts.rand ?? Math.random;
  let root = new Container({ label: "item-poses" });
  layers.overlay.addChild(root);
  const playing = new Map<string, Playing>();
  /** Last act key seen per entity, so an act already over when we first see it isn't replayed. */
  const seen = new Map<string, string>();
  const crumbs: Crumb[] = [];
  const crumbTex = new Map<ItemId, Texture[]>();

  function ensureRoot(): boolean {
    // GameApp.clearWorld() may destroy the overlay layer's children under us.
    if (!root.destroyed) return true;
    if (layers.overlay.destroyed) return false;
    playing.clear();
    crumbs.length = 0;
    root = new Container({ label: "item-poses" });
    layers.overlay.addChild(root);
    return true;
  }

  function iconOf(item: ItemId): Texture | null {
    try {
      return art.icon(item);
    } catch {
      return null;
    }
  }

  /** A few small squares cut from the middle of the item's icon. */
  function crumbsOf(item: ItemId): Texture[] {
    const hit = crumbTex.get(item);
    if (hit) return hit;
    const tex = iconOf(item);
    const out: Texture[] = [];
    if (tex) {
      const f = tex.frame;
      for (let i = 0; i < 6; i++) {
        const x = f.x + Math.floor(f.width * (0.25 + 0.5 * ((i * 37) % 10) / 10));
        const y = f.y + Math.floor(f.height * (0.25 + 0.5 * ((i * 53) % 10) / 10));
        out.push(new Texture({ source: tex.source, frame: new Rectangle(x, y, Math.min(CRUMB_PX, f.width), Math.min(CRUMB_PX, f.height)) }));
      }
    }
    crumbTex.set(item, out);
    return out;
  }

  function spawnCrumbs(item: ItemId, at: Vec2): void {
    const texs = crumbsOf(item);
    if (texs.length === 0) return;
    for (let i = 0; i < CRUMBS_PER_BITE; i++) {
      const s = new Sprite(texs[Math.floor(rand() * texs.length)]!);
      s.anchor.set(0.5);
      s.scale.set(2);
      s.position.set(at.x + (rand() - 0.5) * 8, at.y);
      root.addChild(s);
      crumbs.push({ sprite: s, vx: (rand() - 0.5) * 140, vy: -60 - rand() * 90, age: 0 });
    }
  }

  function stop(id: string): void {
    const p = playing.get(id);
    if (!p) return;
    p.sprite.destroy();
    playing.delete(id);
  }

  function start(s: EntityState, kind: PoseKind, key: string, now: number): void {
    stop(s.id);
    const tex = iconOf(s.act!.item!);
    if (!tex) return;
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.visible = false;
    root.addChild(sprite);
    playing.set(s.id, { key, kind, item: s.act!.item!, start: now, lastAge: -1, sprite });
  }

  return {
    sync(states, headOf, now, dtMs) {
      if (!ensureRoot()) return;
      const here = new Set<string>();
      for (const s of states) {
        here.add(s.id);
        const kind = poseKindOf(s.act);
        const key = kind ? `${s.act!.k}:${s.act!.at}` : "";
        const prev = seen.get(s.id);
        seen.set(s.id, key);
        if (!kind) {
          stop(s.id);
          continue;
        }
        // First sighting of this entity: an act already in its state is old news.
        if (prev === undefined) continue;
        if (prev !== key) start(s, kind, key, now);
        const p = playing.get(s.id);
        if (!p) continue;
        const age = now - p.start;
        const head = headOf(s.id);
        // Walking off cancels a hold-up; eating plays out.
        const pose = head && !(p.kind === "hold" && s.moving) ? poseAt(p.kind, age) : null;
        if (!pose || !head) {
          if (age >= poseLength(p.kind) || (p.kind === "hold" && s.moving)) stop(s.id);
          else p.sprite.visible = false;
          continue;
        }
        const t = p.sprite.texture;
        const base = ITEM_PX / Math.max(1, Math.max(t.width, t.height));
        p.sprite.visible = true;
        p.sprite.position.set(head.x + pose.dx, head.y + pose.dy);
        p.sprite.scale.set(base * pose.scale);
        p.sprite.alpha = pose.alpha;
        for (const _ of beatsBetween(p.kind, p.lastAge, age)) {
          if (p.kind === "eat") spawnCrumbs(p.item, { x: p.sprite.x, y: p.sprite.y + 4 });
          opts.beat?.(s.id, p.kind, p.item);
        }
        p.lastAge = age;
      }
      for (const id of [...playing.keys()]) if (!here.has(id)) stop(id);
      for (const id of [...seen.keys()]) if (!here.has(id)) seen.delete(id);

      const dt = Math.min(100, Math.max(0, dtMs)) / 1000;
      for (let i = crumbs.length - 1; i >= 0; i--) {
        const c = crumbs[i]!;
        c.age += dt * 1000;
        c.vy += GRAVITY * dt;
        c.sprite.x += c.vx * dt;
        c.sprite.y += c.vy * dt;
        c.sprite.alpha = Math.max(0, 1 - c.age / CRUMB_LIFE_MS);
        if (c.age >= CRUMB_LIFE_MS) {
          c.sprite.destroy();
          crumbs.splice(i, 1);
        }
      }
    },
    destroy() {
      for (const id of [...playing.keys()]) stop(id);
      for (const c of crumbs) c.sprite.destroy();
      crumbs.length = 0;
      for (const list of crumbTex.values()) for (const t of list) t.destroy(false);
      crumbTex.clear();
      if (!root.destroyed) root.destroy({ children: true });
    },
  };
}
