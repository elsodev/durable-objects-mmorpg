// Ambient light/tint (screen layer), floating text and pooled particle bursts (overlay layer).
// Simulation lives in effects-sim.ts; this file only mirrors it onto Pixi display objects.
import { Container, Point, Sprite, Text, Texture } from "pixi.js";
import type { CreateEffects, Effects, Layers } from "../contracts";
import { TILE } from "../contracts";
import type { MapData, Vec2 } from "../../shared/types";
import {
  AMBIENT,
  FLOAT_COLORS,
  FloatTexts,
  FootstepTracker,
  ParticlePool,
  flicker,
  type FloatEntry,
} from "./effects-sim";

const PARTICLE_CAP = 256;
const LIGHT_TEX = 256;
/** The light is centred on the body, not the feet. */
const LIGHT_Y_OFFSET = -0.5 * TILE;
const AMBIENT_FADE = 0.4; // s

type Ambient = MapData["ambient"];

/** White core fading to `edge`, opaque, for a multiply-blended light hole. Null outside the browser. */
function makeRadialTexture(edge: number): Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = LIGHT_TEX;
  const g = c.getContext("2d");
  if (!g) return null;
  const r = LIGHT_TEX / 2;
  const hex = `#${edge.toString(16).padStart(6, "0")}`;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "#fff4dc");
  grad.addColorStop(0.3, "#f2e2c0");
  grad.addColorStop(0.65, mixHex(0xf2e2c0, edge, 0.6));
  grad.addColorStop(1, hex);
  g.fillStyle = hex;
  g.fillRect(0, 0, LIGHT_TEX, LIGHT_TEX);
  g.fillStyle = grad;
  g.fillRect(0, 0, LIGHT_TEX, LIGHT_TEX);
  return Texture.from(c, true);
}

function mixHex(a: number, b: number, t: number): string {
  const ch = (s: number) => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function solid(tint: number): Sprite {
  const s = new Sprite(Texture.WHITE);
  s.tint = tint;
  s.blendMode = "multiply";
  return s;
}

class AmbientLayer {
  readonly root = new Container({ label: "fx-ambient" });
  current(): Ambient | null {
    return this.kind;
  }
  private kind: Ambient | null = null;
  private fill: Sprite;
  private light: Sprite | null = null;
  /** Top, bottom, left, right covers around the light square. */
  private edges: Sprite[] = [];
  private lightTex: Texture | null = null;
  private fade = 1;
  private time = 0;

  constructor(private layers: Layers) {
    this.root.eventMode = "none";
    this.fill = solid(0xffffff);
    this.root.addChild(this.fill);
    layers.screen.addChild(this.root);
    this.set("day");
  }

  set(kind: Ambient): void {
    if (kind === this.kind) return;
    this.kind = kind;
    const look = AMBIENT[kind];
    this.fade = 0;
    this.root.alpha = 0;
    if (look.light > 0) {
      this.lightTex ??= makeRadialTexture(AMBIENT.cave.tint);
      this.ensureLight();
      if (this.light) this.light.visible = true;
      this.fill.visible = !this.light;
      this.fill.tint = look.tint;
      for (const e of this.edges) {
        e.tint = look.tint;
        e.visible = true;
      }
    } else {
      this.fill.visible = look.tint !== 0xffffff;
      this.fill.tint = look.tint;
      if (this.light) this.light.visible = false;
      for (const e of this.edges) e.visible = false;
    }
    this.root.visible = kind !== "day";
  }

  private ensureLight(): void {
    if (this.light || !this.lightTex) return;
    this.light = new Sprite(this.lightTex);
    this.light.anchor.set(0.5);
    this.light.blendMode = "multiply";
    this.root.addChild(this.light);
    for (let i = 0; i < 4; i++) {
      const e = solid(AMBIENT.cave.tint);
      this.edges.push(e);
      this.root.addChild(e);
    }
  }

  update(dt: number, you: Vec2 | null, w: number, h: number): void {
    this.time += dt;
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / AMBIENT_FADE);
      this.root.alpha = this.fade;
    }
    if (!this.root.visible) return;
    this.fill.position.set(0, 0);
    this.fill.setSize(w, h);
    const look = AMBIENT[this.kind ?? "day"];
    const light = this.light;
    if (look.light <= 0 || !light) return;
    let cx = w / 2;
    let cy = h / 2;
    if (you) {
      const g = this.layers.world.toGlobal(new Point(you.x * TILE, you.y * TILE + LIGHT_Y_OFFSET));
      const p = this.layers.screen.toLocal(g);
      cx = p.x;
      cy = p.y;
    }
    // Even size + integer centre puts every edge of the light square on a whole pixel, so the
    // covers can butt against it exactly. (Overlapping them multiplied the darkness twice and
    // drew a 1 px black line around the square.)
    const half = Math.round(look.light * TILE * flicker(this.time));
    const size = half * 2;
    const left = Math.round(cx) - half;
    const top = Math.round(cy) - half;
    light.position.set(left + half, top + half);
    light.setSize(size, size);
    const right = left + size;
    const bottom = top + size;
    this.placeEdge(0, 0, 0, w, Math.max(0, top));
    this.placeEdge(1, 0, bottom, w, Math.max(0, h - bottom));
    this.placeEdge(2, 0, top, Math.max(0, left), size);
    this.placeEdge(3, right, top, Math.max(0, w - right), size);
  }

  private placeEdge(i: number, x: number, y: number, w: number, h: number): void {
    const e = this.edges[i];
    if (!e) return;
    e.visible = w > 0 && h > 0;
    if (!e.visible) return;
    e.position.set(x, y);
    e.setSize(w, h);
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.lightTex?.destroy(true);
    this.lightTex = null;
  }
}

class FloatTextLayer {
  readonly root = new Container({ label: "fx-float" });
  private sim = new FloatTexts(24);
  private views = new Map<number, Text>();
  private free: Text[] = [];

  constructor(layers: Layers) {
    this.root.eventMode = "none";
    layers.overlay.addChild(this.root);
  }

  add(x: number, y: number, text: string, kind: FloatEntry["kind"]): void {
    const { entry, evicted } = this.sim.add(x, y, text, kind);
    if (evicted) this.release(evicted.id);
    if (!entry.text) {
      this.sim.entries.pop();
      return;
    }
    const t = this.free.pop() ?? this.make();
    t.text = entry.text;
    t.style.fill = FLOAT_COLORS[kind];
    t.visible = true;
    this.views.set(entry.id, t);
    this.root.addChild(t);
    this.sync(entry, t);
  }

  private make(): Text {
    const t = new Text({
      text: "",
      style: {
        fontFamily: "monospace",
        fontSize: 15,
        fontWeight: "bold",
        fill: 0xffffff,
        stroke: { color: 0x1b1a24, width: 4, join: "round" },
      },
    });
    t.anchor.set(0.5, 1);
    t.roundPixels = true;
    return t;
  }

  private sync(e: FloatEntry, t: Text): void {
    t.position.set(Math.round(e.x), Math.round(e.y + e.dy));
    t.alpha = e.alpha;
    t.scale.set(e.scale);
  }

  private release(id: number): void {
    const t = this.views.get(id);
    if (!t) return;
    this.views.delete(id);
    t.visible = false;
    this.root.removeChild(t);
    if (this.free.length < 16) this.free.push(t);
    else t.destroy();
  }

  update(dt: number): void {
    for (const e of this.sim.step(dt)) this.release(e.id);
    for (const e of this.sim.entries) {
      const t = this.views.get(e.id);
      if (t) this.sync(e, t);
    }
  }

  destroy(): void {
    this.sim.clear();
    this.views.clear();
    for (const t of this.free) t.destroy();
    this.free = [];
    this.root.destroy({ children: true });
  }
}

class ParticleLayer {
  readonly root = new Container({ label: "fx-particles" });
  readonly pool = new ParticlePool(PARTICLE_CAP);
  private sprites: (Sprite | undefined)[] = new Array(PARTICLE_CAP);

  constructor(layers: Layers) {
    this.root.eventMode = "none";
    layers.overlay.addChild(this.root);
  }

  burst(x: number, y: number, kind: Parameters<ParticlePool["burst"]>[2], scale = 1): void {
    for (const i of this.pool.burst(x, y, kind, Math.random, scale)) {
      let s = this.sprites[i];
      if (!s) {
        s = new Sprite(Texture.WHITE);
        s.anchor.set(0.5);
        this.sprites[i] = s;
        this.root.addChild(s);
      }
      const p = this.pool.slots[i]!;
      s.tint = p.color;
      s.blendMode = p.additive ? "add" : "normal";
    }
  }

  update(dt: number): void {
    this.pool.step(dt);
    for (let i = 0; i < PARTICLE_CAP; i++) {
      const s = this.sprites[i];
      if (!s) continue;
      const p = this.pool.slots[i]!;
      s.visible = p.active && p.alpha > 0.01;
      if (!s.visible) continue;
      s.position.set(Math.round(p.x), Math.round(p.y));
      const size = Math.max(1, Math.round(p.size * p.scale));
      s.setSize(size, size);
      s.alpha = p.alpha;
    }
  }

  destroy(): void {
    this.pool.clear();
    this.root.destroy({ children: true });
  }
}

export const createEffects: CreateEffects = (layers, viewport): Effects => {
  const ambient = new AmbientLayer(layers);
  const particles = new ParticleLayer(layers);
  const floats = new FloatTextLayer(layers);
  const steps = new FootstepTracker();
  let destroyed = false;

  return {
    setAmbient(kind) {
      if (destroyed) return;
      ambient.set(kind);
    },
    floatText(at, text, kind) {
      if (destroyed) return;
      // Start above the head (characters are ~2 tiles tall at feet anchor).
      floats.add(at.x * TILE, at.y * TILE - TILE * 1.4, text, kind);
    },
    burst(at, kind) {
      if (destroyed) return;
      particles.burst(at.x * TILE, at.y * TILE, kind);
    },
    update(dtMs, you) {
      if (destroyed) return;
      // Clamp so a backgrounded tab doesn't fast-forward every effect at once.
      const dt = Math.min(Math.max(dtMs, 0), 100) / 1000;
      const { w, h } = viewport();
      if (steps.update(dt, you) && you && ambient.current() !== "indoor") particles.burst(you.x * TILE, you.y * TILE, "dust", 0.35);
      particles.update(dt);
      floats.update(dt);
      ambient.update(dt, you, w, h);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      floats.destroy();
      particles.destroy();
      ambient.destroy();
    },
  };
};
