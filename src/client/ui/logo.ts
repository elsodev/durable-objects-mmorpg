// The Mossbrook logo as a heading: the pixel grid from logo-pixels.ts painted once onto a small
// canvas that CSS scales by whole pixels. Screen readers get the name as text.
import "./styles/logo.css";
import { LOGO_PALETTE, buildLogo, type LogoGrid } from "./logo-pixels";

export const LOGO_NAME = "Mossbrook";

let cached: LogoGrid | null = null;

function rgba(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function paint(canvas: HTMLCanvasElement, grid: LogoGrid): void {
  canvas.width = grid.w;
  canvas.height = grid.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(grid.w, grid.h);
  const colors = LOGO_PALETTE.map((c) => (c ? rgba(c) : null));
  grid.px.forEach((v, i) => {
    const c = colors[v];
    if (!c) return;
    img.data.set([c[0], c[1], c[2], 255], i * 4);
  });
  ctx.putImageData(img, 0, 0);
}

/** An `<h1>` holding the logo. The class sets `--logo-scale`, the whole CSS pixels per logo pixel. */
export function createLogoHeading(opts: { id?: string; className: string }): HTMLHeadingElement {
  cached ??= buildLogo();
  const h1 = document.createElement("h1");
  if (opts.id) h1.id = opts.id;
  h1.className = `dm-logo ${opts.className}`;
  const canvas = document.createElement("canvas");
  canvas.className = "dm-logo-art";
  canvas.setAttribute("aria-hidden", "true");
  paint(canvas, cached);
  h1.style.setProperty("--logo-w", String(cached.w));
  const text = document.createElement("span");
  text.className = "dm-logo-text";
  text.textContent = LOGO_NAME;
  h1.appendChild(canvas);
  h1.appendChild(text);
  return h1;
}
