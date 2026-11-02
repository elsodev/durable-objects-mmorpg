// Meals served across the bar counter (EntityState.meal, shared/counterMeal.ts): the plate on the
// counter in front of the stool, the food on it losing a bite at a time, a morsel lifted to the
// mouth for each bite (a drink's cup lifted whole), crumbs, and the chewing sound. Every client
// draws every sitter's meal, so the whole room sees who is eating what. The sitter's lean is in
// entities.ts; the timeline is in counter-meal-logic.ts.
import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import type { Art, Layers } from "../contracts";
import { SCALE, TILE } from "../contracts";
import type { EntityState, ItemId, MapProp, Vec2 } from "../../shared/types";
import { MEAL_BITES } from "../../shared/counterMeal";
import { mealBitesBetween, mealMotion } from "./counter-meal-logic";
import { createFoodCutter, isDrink } from "./food-in-hand";
import { placeOnSurface, propFeet, surfaceUnder, TABLE_SORT_BIAS } from "./props-geom";
import { seatedZ } from "./sit-pose";

/** Plate size in source px (an oval seen from above and in front). */
const PLATE = { rx: 9, ry: 3.5 };
/** The food sits a little smaller than its icon so it fits the plate. */
const FOOD_SCALE = 0.85;
/** Source px from the head's top point down to the mouth. */
const MOUTH_DROP = 12;
const CRUMBS_PER_BITE = 3;
const CRUMB_LIFE_MS = 420;

interface Plate {
  key: string;
  start: number;
  lastAge: number;
  item: ItemId;
  root: Container;
  dish: Graphics;
  food: Sprite;
  morsel: Sprite;
  /** Where the food sits on the counter (world px). */
  at: Vec2;
  /** Sort z just above the counter's tabletop clutter. */
  z: number;
}

interface Crumb {
  sprite: Sprite;
  vx: number;
  vy: number;
  floor: number;
  age: number;
}

export interface CounterMeals {
  /**
   * Call every frame after entities.sync. `headOf` is the sitter's head (world px); `beat` fires
   * on each bite (sound).
   */
  sync(states: EntityState[], headOf: (id: string) => Vec2 | null, nowMs: number, dtMs: number): void;
  destroy(): void;
}

export interface CounterMealOpts {
  beat?(id: string, item: ItemId): void;
  rand?: () => number;
}

/** The dish: a soft shadow, the rim and the glazed middle. */
function drawDish(g: Graphics): void {
  const rx = PLATE.rx * SCALE;
  const ry = PLATE.ry * SCALE;
  g.clear()
    .ellipse(0, SCALE, rx + SCALE, ry + SCALE * 0.5)
    .fill({ color: 0x2a1a10, alpha: 0.28 })
    .ellipse(0, 0, rx, ry)
    .fill({ color: 0xd8d0c0 })
    .stroke({ color: 0x8a7f70, width: SCALE * 0.5 })
    .ellipse(0, -SCALE * 0.25, rx * 0.72, ry * 0.62)
    .fill({ color: 0xf6f1e6 });
}

export function createCounterMeals(art: Art, layers: Layers, props: readonly MapProp[], opts: CounterMealOpts = {}): CounterMeals {
  const rand = opts.rand ?? Math.random;
  const cutter = createFoodCutter(art);
  const plates = new Map<string, Plate>();
  const crumbs: Crumb[] = [];
  const morselTex = new Map<ItemId, Texture>();

  function iconOf(item: ItemId): Texture | null {
    try {
      return art.icon(item);
    } catch {
      return null;
    }
  }

  /** A small square from the middle of the food's icon: the forkful lifted to the mouth. */
  function morselOf(item: ItemId): Texture {
    const hit = morselTex.get(item);
    if (hit) return hit;
    const tex = iconOf(item);
    let out = Texture.EMPTY;
    if (tex) {
      const f = tex.frame;
      const size = Math.max(2, Math.floor(Math.min(f.width, f.height) * 0.22));
      out = new Texture({ source: tex.source, frame: new Rectangle(f.x + Math.floor((f.width - size) / 2), f.y + Math.floor((f.height - size) / 2), size, size) });
    }
    morselTex.set(item, out);
    return out;
  }

  /** The plate's spot on the counter's top (world px), like any tabletop item; null off a counter. */
  function spotOf(meal: NonNullable<EntityState["meal"]>): { at: Vec2; z: number } {
    const tile = { id: "", type: "plate", x: Math.floor(meal.x), y: Math.floor(meal.y), w: 1, h: 1 } as MapProp;
    const table = surfaceUnder(tile, props);
    const top = table ? art.prop(table.type).surface : undefined;
    if (!table || !top) return { at: { x: meal.x * TILE, y: meal.y * TILE }, z: (tile.y + 1) * TILE + TABLE_SORT_BIAS + 0.2 };
    const tf = propFeet(table);
    const d = placeOnSurface(tile, table, top, { w: PLATE.rx * 2, h: PLATE.ry * 2 + 1, ax: PLATE.rx, ay: PLATE.ry });
    return { at: { x: tf.x * TILE + d.x * SCALE, y: tf.y * TILE + d.y * SCALE }, z: (table.y + table.h) * TILE + TABLE_SORT_BIAS + 0.2 };
  }

  function start(s: EntityState, key: string, now: number): Plate {
    const meal = s.meal!;
    const { at, z } = spotOf(meal);
    const root = new Container({ label: "counter-meal" });
    root.position.set(at.x, at.y);
    root.zIndex = z;
    const dish = new Graphics();
    const drink = isDrink(meal.item);
    // A drink stands on the bare counter; food comes on a plate.
    if (!drink) drawDish(dish);
    const food = new Sprite();
    food.anchor.set(0.5, drink ? 0.85 : 0.7);
    food.scale.set(drink ? 1 : FOOD_SCALE);
    const morsel = new Sprite(morselOf(meal.item));
    morsel.anchor.set(0.5);
    morsel.scale.set(SCALE);
    morsel.visible = false;
    root.addChild(dish, food);
    layers.sorted.addChild(root, morsel);
    const p: Plate = { key, start: now, lastAge: -1, item: meal.item, root, dish, food, morsel, at, z };
    plates.set(s.id, p);
    return p;
  }

  function stop(id: string): void {
    const p = plates.get(id);
    if (!p) return;
    p.root.destroy({ children: true });
    p.morsel.destroy();
    plates.delete(id);
  }

  function spawnCrumbs(item: ItemId, at: Vec2, floor: number): void {
    const tex = morselOf(item);
    if (tex === Texture.EMPTY) return;
    for (let i = 0; i < CRUMBS_PER_BITE; i++) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.scale.set(SCALE * 0.4);
      s.position.set(at.x + (rand() - 0.5) * 10, at.y);
      s.zIndex = Number.MAX_SAFE_INTEGER;
      layers.overlay.addChild(s);
      crumbs.push({ sprite: s, vx: (rand() - 0.5) * 90, vy: -40 - rand() * 50, floor, age: 0 });
    }
  }

  return {
    sync(states, headOf, now, dtMs) {
      const here = new Set<string>();
      for (const s of states) {
        const meal = s.act?.k === "sit" ? s.meal : undefined;
        if (!meal) continue;
        here.add(s.id);
        const key = `${meal.seat}:${meal.at}:${meal.item}`;
        let p = plates.get(s.id);
        if (p && p.key !== key) {
          stop(s.id);
          p = undefined;
        }
        p ??= start(s, key, now);
        const age = now - p.start;
        const m = mealMotion(age);
        const drink = isDrink(p.item);
        const head = headOf(s.id);
        const mouth = head ? { x: head.x, y: head.y + MOUTH_DROP * SCALE } : null;

        // The food on the plate: a bite gone per bite; the last bite finishes it.
        const tex = m.bites < MEAL_BITES ? cutter.cut(p.item, drink ? 0 : m.bites, 1) : null;
        if (tex) {
          if (p.food.texture !== tex) p.food.texture = tex;
          p.food.visible = true;
        } else p.food.visible = false;

        // A drink is lifted whole to the lips and set back down; food goes up a forkful at a time.
        p.food.position.set(0, -SCALE);
        p.morsel.visible = false;
        if (mouth && m.eating) {
          const lift = drink ? m.lean : m.morsel;
          if (lift !== null && lift > 0) {
            const from = { x: p.at.x, y: p.at.y - SCALE * 3 };
            const x = from.x + (mouth.x - from.x) * lift;
            const y = from.y + (mouth.y - from.y) * lift - Math.sin(Math.PI * lift) * 6 * SCALE;
            if (drink) p.food.position.set(x - p.at.x, y - p.at.y);
            else {
              p.morsel.position.set(x, y);
              p.morsel.visible = true;
            }
          }
        }
        // Facing away from the viewer the head hides the forkful at the mouth; otherwise it's in front.
        const sitZ = seatedZ(s.y);
        p.morsel.zIndex = s.facing === "up" ? sitZ - 0.05 : sitZ + 0.05;
        // A lifted cup passes in front of the counter to the sitter's face.
        p.root.zIndex = drink && m.lean > 0 && s.facing !== "up" ? sitZ + 0.05 : p.z;

        const bites = mealBitesBetween(p.lastAge, age);
        for (let i = 0; i < bites; i++) {
          if (!drink) spawnCrumbs(p.item, { x: p.at.x, y: p.at.y - SCALE * 4 }, p.at.y);
          opts.beat?.(s.id, p.item);
        }
        p.lastAge = age;
      }
      for (const id of [...plates.keys()]) if (!here.has(id)) stop(id);

      const dt = Math.min(100, Math.max(0, dtMs)) / 1000;
      for (let i = crumbs.length - 1; i >= 0; i--) {
        const c = crumbs[i]!;
        c.age += dt * 1000;
        c.vy += 700 * dt;
        c.sprite.x += c.vx * dt;
        c.sprite.y = Math.min(c.floor, c.sprite.y + c.vy * dt);
        c.sprite.alpha = Math.max(0, 1 - c.age / CRUMB_LIFE_MS);
        if (c.age >= CRUMB_LIFE_MS) {
          c.sprite.destroy();
          crumbs.splice(i, 1);
        }
      }
    },
    destroy() {
      for (const id of [...plates.keys()]) stop(id);
      for (const c of crumbs) c.sprite.destroy();
      crumbs.length = 0;
      for (const t of morselTex.values()) if (t !== Texture.EMPTY) t.destroy(false);
      morselTex.clear();
      cutter.destroy();
    },
  };
}
