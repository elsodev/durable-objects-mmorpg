// Home day/night: a multiply tint over the whole screen that follows the home clock, plus warm
// glows on lamps and lantern posts once evening falls. Public zones never create this layer.
import { Container, Sprite, Texture } from "pixi.js";
import type { Layers } from "../contracts";
import { TILE } from "../contracts";
import type { Vec2 } from "../../shared/types";
import { daylightTint, lampStrength } from "../../shared/engine/homeclock";

export interface Daylight {
  /** minutes: home clock (minutes after midnight); lights: glow centres in tile coords. */
  update(minutes: number, lights: readonly Vec2[], w: number, h: number, timeMs: number): void;
  destroy(): void;
}

const GLOW_TEX = 128;
/** Glow radius in tiles at full strength. */
const GLOW_RADIUS = 3.2;

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

export function createDaylight(layers: Layers): Daylight {
  const tint = new Sprite(Texture.WHITE);
  tint.blendMode = "multiply";
  tint.eventMode = "none";
  tint.label = "fx-daylight";
  layers.screen.addChild(tint);

  const glows = new Container({ label: "fx-lamps" });
  glows.eventMode = "none";
  // The overlay layer draws above the screen tint, so lamps stay bright at night.
  layers.overlay.addChildAt(glows, 0);
  const tex = glowTexture();
  const pool: Sprite[] = [];

  return {
    update(minutes, lights, w, h, timeMs) {
      tint.tint = daylightTint(minutes);
      tint.visible = tint.tint !== 0xffffff;
      tint.position.set(0, 0);
      tint.setSize(w, h);

      const k = lampStrength(minutes);
      glows.visible = k > 0 && !!tex;
      if (!glows.visible || !tex) return;
      while (pool.length < lights.length) {
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        s.blendMode = "add";
        glows.addChild(s);
        pool.push(s);
      }
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        const l = lights[i];
        s.visible = !!l;
        if (!l) continue;
        // A slow, per-lamp flicker so a row of lamps doesn't pulse in sync.
        const flick = 1 + 0.04 * Math.sin(timeMs / 260 + i * 1.7);
        const size = GLOW_RADIUS * 2 * TILE * flick;
        s.position.set(l.x * TILE, l.y * TILE);
        s.setSize(size, size);
        s.alpha = k;
      }
    },
    destroy() {
      tint.destroy();
      glows.destroy({ children: true });
      tex?.destroy(true);
    },
  };
}
