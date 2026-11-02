// Feedback screenshots: the whole view as the player sees it (game canvas + DOM HUD), then the
// dragged area cut out, downscaled and encoded under the upload cap.
//
// The game canvas comes from the renderer's extract API (a WebGPU or WebGL canvas can't be read
// back once presented); html-to-image draws the HUD through an SVG foreignObject, skipping the
// feedback UI itself; the two are layered onto one 2D canvas.
import { getFontEmbedCSS, toCanvas } from "html-to-image";
import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_SIDE } from "../../shared/feedback";
import { encodePlan, fitWithin, toSourceRect, type Rect, type Size } from "./feedback-rect-logic";

export interface ViewShot {
  /** The view at `scale` device pixels per CSS pixel. */
  canvas: HTMLCanvasElement;
  /** CSS pixel size of the captured view. */
  view: Size;
}

export interface CaptureSources {
  /** The game canvas as drawn now (GameApi.captureView), or null. */
  game(): HTMLCanvasElement | null;
  /** Where the game canvas sits on screen. */
  gameRect(): DOMRect | null;
  /** The DOM UI root (#ui) to draw over the game. */
  ui: HTMLElement;
  /** Nodes to leave out of the DOM capture (the feedback UI). */
  skip(node: Node): boolean;
}

const BACKGROUND = "#2b3a2e";
const DOM_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Leaves out what can't show: hidden panels (less to clone), and images without a source, which
 * html-to-image would otherwise "embed" by fetching the page itself and then fail on.
 */
function visibleNode(n: Node): boolean {
  if (!(n instanceof Element)) return true;
  if (n instanceof HTMLImageElement && !n.getAttribute("src")) return false;
  if (n.hasAttribute("hidden")) return false;
  return getComputedStyle(n).display !== "none";
}

/** The web fonts as inline CSS, fetched once per page: the slow part of a HUD capture. */
let fontCssMemo: Promise<string> | null = null;
function fontCss(node: HTMLElement): Promise<string> {
  fontCssMemo ??= getFontEmbedCSS(node);
  return fontCssMemo;
}

/** Starts fetching the fonts when the form opens, so "Add screenshot" is quicker. */
export function warmCapture(ui: HTMLElement): void {
  fontCss(ui).catch(() => {
    fontCssMemo = null;
  });
}

async function domLayer(src: CaptureSources, scale: number): Promise<HTMLCanvasElement | null> {
  const r = src.ui.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const opts = {
    pixelRatio: scale,
    width: Math.round(r.width),
    height: Math.round(r.height),
    filter: (n: HTMLElement) => !src.skip(n) && visibleNode(n),
  };
  try {
    const fontEmbedCSS = await withTimeout(fontCss(src.ui), DOM_TIMEOUT_MS);
    return await withTimeout(toCanvas(src.ui, { ...opts, fontEmbedCSS }), DOM_TIMEOUT_MS);
  } catch (err) {
    fontCssMemo = null;
    // Usually the web fonts couldn't be fetched for embedding: the HUD in fallback fonts beats none.
    console.warn("[feedback] HUD capture failed, retrying without fonts", err);
  }
  try {
    return await withTimeout(toCanvas(src.ui, { ...opts, skipFonts: true }), DOM_TIMEOUT_MS);
  } catch (err) {
    console.warn("[feedback] HUD capture failed; the screenshot shows the game only", err);
    return null;
  }
}

/** Captures the whole window. Never throws; at worst the result is the bare background. */
export async function captureWholeView(src: CaptureSources): Promise<ViewShot> {
  const view: Size = { w: Math.max(1, window.innerWidth), h: Math.max(1, window.innerHeight) };
  const scale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(view.w * scale);
  canvas.height = Math.round(view.h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { canvas, view };
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  const game = src.game();
  const gr = src.gameRect();
  if (game && gr && game.width > 0 && game.height > 0) {
    ctx.drawImage(game, gr.left * scale, gr.top * scale, gr.width * scale, gr.height * scale);
  }
  const dom = await domLayer(src, scale);
  if (dom && dom.width > 0 && dom.height > 0) {
    const ur = src.ui.getBoundingClientRect();
    ctx.drawImage(dom, ur.left * scale, ur.top * scale, ur.width * scale, ur.height * scale);
  }
  return { canvas, view };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), type, quality);
    } catch {
      resolve(null);
    }
  });
}

const ALLOWED = new Set(["image/webp", "image/jpeg", "image/png"]);

export interface EncodedShot {
  blob: Blob;
  width: number;
  height: number;
}

/** The dragged area (CSS pixels) of a shot, as the smallest attempt that fits the upload cap. */
export async function cropAndEncode(shot: ViewShot, area: Rect): Promise<EncodedShot | null> {
  const src = toSourceRect(area, shot.view, { w: shot.canvas.width, h: shot.canvas.height });
  for (const step of encodePlan(SCREENSHOT_MAX_SIDE)) {
    const size = fitWithin({ w: src.w, h: src.h }, step.maxSide);
    const out = document.createElement("canvas");
    out.width = size.w;
    out.height = size.h;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(shot.canvas, src.x, src.y, src.w, src.h, 0, 0, size.w, size.h);
    const blob = await toBlob(out, step.type, step.quality);
    // A browser without WebP hands back PNG instead; that's fine when it fits.
    if (blob && ALLOWED.has(blob.type) && blob.size <= SCREENSHOT_MAX_BYTES) return { blob, width: size.w, height: size.h };
  }
  return null;
}
