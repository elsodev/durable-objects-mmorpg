// A tiny software pixel canvas. Every placeholder is drawn here first (pure, testable, no Pixi),
// then the outline pass adds the dark LPC silhouette and placeholders.ts turns it into a texture.
import { mix, outlineOf, type Rgb } from "../palette";

export interface Run {
  x: number;
  y: number;
  w: number;
  h: number;
  color: Rgb;
  alpha: number; // 0..1
}

export class PixelGrid {
  readonly color: Uint32Array;
  readonly alpha: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.color = new Uint32Array(w * h);
    this.alpha = new Uint8Array(w * h);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** a in 0..255. Translucent pixels blend over what is already there. */
  px(x: number, y: number, c: Rgb, a = 255): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inside(x, y) || a <= 0) return;
    const i = y * this.w + x;
    if (a >= 255 || this.alpha[i] === 0) {
      this.color[i] = c;
      this.alpha[i] = Math.max(a, this.alpha[i]);
      return;
    }
    this.color[i] = mix(this.color[i], c, a / 255);
    this.alpha[i] = Math.min(255, this.alpha[i] + a);
  }

  get(x: number, y: number): Rgb | null {
    if (!this.inside(x, y)) return null;
    const i = y * this.w + x;
    return this.alpha[i] ? this.color[i] : null;
  }

  opaque(x: number, y: number): boolean {
    return this.inside(x, y) && this.alpha[y * this.w + x] > 0;
  }

  clear(x: number, y: number): void {
    if (this.inside(x, y)) this.alpha[y * this.w + x] = 0;
  }

  rect(x: number, y: number, w: number, h: number, c: Rgb, a = 255): void {
    for (let yy = Math.floor(y); yy < y + h; yy++) for (let xx = Math.floor(x); xx < x + w; xx++) this.px(xx, yy, c, a);
  }

  /** Rectangle with 1 px border in its own outline colour. */
  box(x: number, y: number, w: number, h: number, fill: Rgb, border: Rgb = outlineOf(fill)): void {
    this.rect(x, y, w, h, border);
    this.rect(x + 1, y + 1, w - 2, h - 2, fill);
  }

  /** Paints only over pixels that are already opaque (for shading inside a silhouette). */
  tint(x: number, y: number, w: number, h: number, c: Rgb, a = 255): void {
    for (let yy = Math.floor(y); yy < y + h; yy++)
      for (let xx = Math.floor(x); xx < x + w; xx++) if (this.opaque(xx, yy)) this.px(xx, yy, c, a);
  }

  hline(x: number, y: number, w: number, c: Rgb, a = 255): void {
    this.rect(x, y, w, 1, c, a);
  }

  vline(x: number, y: number, h: number, c: Rgb, a = 255): void {
    this.rect(x, y, 1, h, c, a);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Rgb, a = 255): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Filled ellipse centred on (cx, cy); half-pixel centres give symmetric even widths. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Rgb, a = 255): void {
    if (rx <= 0 || ry <= 0) return;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const dy = (y + 0.5 - cy) / ry;
      if (Math.abs(dy) > 1) continue;
      const half = rx * Math.sqrt(1 - dy * dy);
      const x0 = Math.round(cx - half);
      const x1 = Math.round(cx + half);
      for (let x = x0; x < x1; x++) this.px(x, y, c, a);
    }
  }

  /** Ellipse filled with base colour, a shadowed lower-right crescent and a lit upper-left one. */
  ball(cx: number, cy: number, rx: number, ry: number, base: Rgb, dark: Rgb, light: Rgb): void {
    this.ellipse(cx, cy, rx, ry, dark);
    this.ellipse(cx - rx * 0.12, cy - ry * 0.14, rx * 0.86, ry * 0.84, base);
    this.ellipse(cx - rx * 0.35, cy - ry * 0.4, rx * 0.36, ry * 0.3, light);
  }

  /** Scanline polygon fill (even-odd). */
  poly(points: [number, number][], c: Rgb, a = 255): void {
    const ys = points.map((p) => p[1]);
    const minY = Math.floor(Math.min(...ys));
    const maxY = Math.ceil(Math.max(...ys));
    for (let y = minY; y <= maxY; y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.round(xs[i]); x < Math.round(xs[i + 1]); x++) this.px(x, y, c, a);
      }
    }
  }

  /**
   * Adds a 1 px outline on transparent pixels next to the silhouette. With `self`, each outline
   * pixel takes a darkened version of its neighbour, which reads softer than flat black (LPC style).
   */
  outline(c: Rgb | "self" = "self", minAlpha = 200): void {
    const add: [number, number, Rgb][] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.alpha[y * this.w + x]) continue;
        let n: Rgb | null = null;
        for (const [dx, dy] of NEIGHBOURS) {
          const xx = x + dx;
          const yy = y + dy;
          if (this.inside(xx, yy) && this.alpha[yy * this.w + xx] >= minAlpha) {
            n = this.color[yy * this.w + xx];
            break;
          }
        }
        if (n !== null) add.push([x, y, c === "self" ? outlineOf(n) : c]);
      }
    }
    for (const [x, y, col] of add) this.px(x, y, col);
  }

  /** Copies opaque pixels of src at (dx, dy), optionally mirrored horizontally. */
  blit(src: PixelGrid, dx: number, dy: number, flipX = false): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const i = y * src.w + x;
        if (!src.alpha[i]) continue;
        this.px(dx + (flipX ? src.w - 1 - x : x), dy + y, src.color[i], src.alpha[i]);
      }
    }
  }

  /** Nearest-colour majority downscale by an integer factor (used for furniture icons). */
  downscale(f: number): PixelGrid {
    const out = new PixelGrid(Math.ceil(this.w / f), Math.ceil(this.h / f));
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        const counts = new Map<Rgb, number>();
        let filled = 0;
        for (let yy = 0; yy < f; yy++) {
          for (let xx = 0; xx < f; xx++) {
            const col = this.get(x * f + xx, y * f + yy);
            if (col === null) continue;
            filled++;
            counts.set(col, (counts.get(col) ?? 0) + 1);
          }
        }
        if (filled * 2 < f * f) continue;
        let best: Rgb = 0;
        let bestN = -1;
        for (const [col, n] of counts) if (n > bestN) [best, bestN] = [col, n];
        out.px(x, y, best);
      }
    }
    return out;
  }

  /** Same-colour pixels merged into horizontal runs, then stacked runs merged into rectangles. */
  runs(): Run[] {
    const done: Run[] = [];
    let open = new Map<string, Run>();
    for (let y = 0; y < this.h; y++) {
      const next = new Map<string, Run>();
      let x = 0;
      while (x < this.w) {
        const i = y * this.w + x;
        const a = this.alpha[i];
        if (!a) {
          x++;
          continue;
        }
        const c = this.color[i];
        let len = 1;
        while (x + len < this.w && this.alpha[i + len] === a && this.color[i + len] === c) len++;
        const key = `${x},${len},${c},${a}`;
        const prev = open.get(key);
        if (prev) {
          prev.h++;
          open.delete(key);
          next.set(key, prev);
        } else {
          next.set(key, { x, y, w: len, h: 1, color: c, alpha: a / 255 });
        }
        x += len;
      }
      for (const r of open.values()) done.push(r);
      open = next;
    }
    for (const r of open.values()) done.push(r);
    return done;
  }
}

const NEIGHBOURS: [number, number][] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];
