// Night light. At home: a multiply tint over the whole screen that follows the home clock, plus
// warm glows on lamps and fires and lit house windows once evening falls. In caves: the lamp and
// fire glows only, always on (the cave's own darkness is effects.ts's ambient layer).
// Other public zones never create this layer.
import { Container, Sprite, Texture } from "pixi.js";
import type { Layers, LightSpot, LitWindowsView, SpriteArt } from "../contracts";
import { TILE } from "../contracts";
import { daylightTint, interiorTint, lampStrength } from "../../shared/engine/homeclock";
import { glowAlpha, windowGlow } from "./light-points";
import { createLitWindows } from "./lit-windows";

export interface Daylight {
  /** minutes: home clock (minutes after midnight); lights: glow centres in tile coords. */
  update(minutes: number, lights: readonly LightSpot[], w: number, h: number, timeMs: number): void;
  destroy(): void;
}

export interface DaylightOpts {
  /** Inside the house the light is a warm interior glow that dims at night, not the sky. */
  indoor?: boolean;
  /** Underground: no clock and no tint, the lamps always burn. */
  cave?: boolean;
  /** Buildings whose windows light up at night, with their overlay art. */
  windows?: readonly { view: LitWindowsView; art: SpriteArt }[];
}

const GLOW_TEX = 128;
/** Glow radius (tiles) of the light spilling out of a lit window. */
const WINDOW_GLOW = 1.6;
/** Window spill is softer than a lamp. */
const WINDOW_GLOW_ALPHA = 0.55;

function glowTexture(): Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = GLOW_TEX;
  const g = c.getContext("2d");
  if (!g) return null;
  const r = GLOW_TEX / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255,214,140,0.75)");
  grad.addColorStop(0.35, "rgba(255,180,90,0.35)");
  grad.addColorStop(1, "rgba(255,150,60,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, GLOW_TEX, GLOW_TEX);
  return Texture.from(c, true);
}

export function createDaylight(layers: Layers, opts: DaylightOpts = {}): Daylight {
  const tintAt = opts.cave ? () => 0xffffff : opts.indoor ? interiorTint : daylightTint;
  const strength = opts.cave ? () => 1 : lampStrength;
  const tint = new Sprite(Texture.WHITE);
  tint.blendMode = "multiply";
  tint.eventMode = "none";
  tint.label = "fx-daylight";
  layers.screen.addChild(tint);

  // The overlay layer draws above the screen tint, so lamps and windows stay bright at night.
  const night = new Container({ label: "fx-night" });
  night.eventMode = "none";
  layers.overlay.addChildAt(night, 0);
  const windows = createLitWindows(layers.sorted, night, opts.windows ?? []);
  const spill = (opts.windows ?? []).flatMap(({ view }) => view.windows.map((r) => windowGlow(r, WINDOW_GLOW)));
  const glows = new Container({ label: "fx-lamps" });
  night.addChild(glows);
  const tex = glowTexture();
  const pool: Sprite[] = [];

  function glowAt(i: number, l: LightSpot, alpha: number, timeMs: number): void {
    let s = pool[i];
    if (!s) {
      s = new Sprite(tex!);
      s.anchor.set(0.5);
      s.blendMode = "add";
      glows.addChild(s);
      pool.push(s);
    }
    // A slow, per-lamp flicker so a row of lamps doesn't pulse in sync.
    const flick = 1 + 0.04 * Math.sin(timeMs / 260 + i * 1.7);
    const size = l.radius * 2 * TILE * flick;
    s.visible = true;
    s.position.set(l.x * TILE, l.y * TILE);
    s.setSize(size, size);
    s.alpha = alpha;
  }

  return {
    update(minutes, lights, w, h, timeMs) {
      const t = tintAt(minutes);
      tint.tint = t;
      tint.visible = t !== 0xffffff;
      tint.position.set(0, 0);
      tint.setSize(w, h);

      const k = strength(minutes);
      windows.update(k, t);
      glows.visible = k > 0 && !!tex;
      if (!glows.visible) return;
      let n = 0;
      const a = glowAlpha(k, lights.length, !!opts.indoor);
      for (const l of lights) glowAt(n++, l, a, timeMs);
      for (const l of spill) glowAt(n++, l, k * WINDOW_GLOW_ALPHA, timeMs);
      for (let i = n; i < pool.length; i++) pool[i]!.visible = false;
    },
    destroy() {
      tint.destroy();
      windows.destroy();
      night.destroy({ children: true });
      tex?.destroy(true);
    },
  };
}
