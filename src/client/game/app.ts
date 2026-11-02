// See ../contracts.ts for the contract.
import { Application, Container, Rectangle, RendererType, TextureStyle, type Ticker } from "pixi.js";
import type { CreateGameApp, GameApp, Layers } from "../contracts";

const BACKGROUND = 0x2b3a2e; // dark moss, shown before the ground layer draws

type Kind = GameApp["renderer"];

/** Maps Pixi's renderer type/name to our two supported kinds (anything non-WebGPU counts as WebGL). */
export function rendererKind(type: number | undefined, name?: string): Kind {
  if (type === RendererType.WEBGPU) return "webgpu";
  if (type === undefined && name?.toLowerCase() === "webgpu") return "webgpu";
  return "webgl";
}

/** Runs cb every frame with elapsed ms (clamped so a backgrounded tab doesn't produce a giant step). */
export function onFrame(app: Application, cb: (dtMs: number) => void, maxDtMs = 100): () => void {
  const fn = (t: Ticker) => cb(Math.min(t.deltaMS, maxDtMs));
  app.ticker.add(fn);
  return () => {
    app.ticker.remove(fn);
  };
}

export function createLayers(): Layers {
  const world = new Container({ label: "world" });
  const ground = new Container({ label: "ground" });
  const groundOverlay = new Container({ label: "groundOverlay" });
  const sorted = new Container({ label: "sorted", sortableChildren: true });
  const overlay = new Container({ label: "overlay" });
  const screen = new Container({ label: "screen" });
  // The overlay (names, hp bars, float text) is drawn after `screen` so cave darkness doesn't dim
  // it; the camera moves it together with `world`.
  world.addChild(ground, groundOverlay, sorted);
  return { world, ground, groundOverlay, sorted, overlay, screen };
}

/** Destroys every child of the world sub-layers but keeps the layers (and shared textures) alive. */
export function clearLayers(layers: Layers): void {
  for (const layer of [layers.ground, layers.groundOverlay, layers.sorted, layers.overlay]) {
    for (const child of layer.removeChildren()) child.destroy({ children: true });
  }
}

/**
 * The stage as it looks on screen, as a 2D canvas. A WebGPU or WebGL canvas can't be read back
 * once presented, so the frame is rendered again into a texture through the extract API.
 */
export function captureView(app: Application): HTMLCanvasElement | null {
  try {
    const { width, height } = app.screen;
    if (width <= 0 || height <= 0) return null;
    return app.renderer.extract.canvas({
      target: app.stage,
      frame: new Rectangle(0, 0, width, height),
      resolution: Math.min(app.renderer.resolution, 2),
      clearColor: BACKGROUND,
    }) as HTMLCanvasElement;
  } catch (err) {
    console.warn("[dmmo] view capture failed", err);
    return null;
  }
}

async function initApp(mount: HTMLElement, preference: "webgpu" | "webgl"): Promise<Application> {
  const app = new Application();
  try {
    await app.init({
      preference,
      resizeTo: mount,
      antialias: false,
      background: BACKGROUND,
      autoDensity: true,
      resolution: globalThis.devicePixelRatio || 1,
      roundPixels: true,
    });
    return app;
  } catch (err) {
    try {
      app.destroy(true);
    } catch {
      // half-initialised app; nothing more to release
    }
    throw err;
  }
}

export const createGameApp: CreateGameApp = async (mount) => {
  // Pixel art: must be set before any texture (art, placeholders) is created.
  TextureStyle.defaultOptions.scaleMode = "nearest";

  let app: Application;
  try {
    app = await initApp(mount, "webgpu");
  } catch (err) {
    // A canvas that failed getContext('webgpu') can't be reused, so initApp builds a fresh one.
    console.warn("[dmmo] WebGPU init failed, retrying with WebGL", err);
    app = await initApp(mount, "webgl");
  }

  const renderer = rendererKind(app.renderer.type, app.renderer.name);
  const canvas = app.canvas;
  canvas.style.display = "block";
  canvas.style.imageRendering = "pixelated";
  canvas.addEventListener("contextmenu", preventDefault);
  mount.appendChild(canvas);

  const layers = createLayers();
  app.stage.addChild(layers.world, layers.screen, layers.overlay);

  // resizeTo only listens to window resize; the mount can also change size on its own (HUD, mobile bars).
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => app.resize());
    ro.observe(mount);
  }

  let destroyed = false;
  return {
    app,
    layers,
    renderer,
    width: () => app.screen.width,
    height: () => app.screen.height,
    clearWorld: () => clearLayers(layers),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ro?.disconnect();
      canvas.removeEventListener("contextmenu", preventDefault);
      // Textures belong to the art cache, which may outlive this app instance's display tree.
      app.destroy({ removeView: true }, { children: true });
    },
  };
};

function preventDefault(e: Event): void {
  e.preventDefault();
}
