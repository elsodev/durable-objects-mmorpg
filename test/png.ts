// A tiny PNG reader for art tests: 8-bit RGB/RGBA and palette images (1-8 bit, with tRNS),
// non-interlaced, which is everything in the art pack.
const proc = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process;
const fs = proc.getBuiltinModule("node:fs") as { readFileSync(p: string): Uint8Array };
const zlib = proc.getBuiltinModule("node:zlib") as { inflateSync(b: Uint8Array): Uint8Array };

export interface Png {
  w: number;
  h: number;
  /** Alpha at (x, y); 0 outside the image. */
  alpha(x: number, y: number): number;
}

/** Width and height from the IHDR chunk only. */
export function pngSize(path: string): { w: number; h: number } {
  const buf = fs.readFileSync(path);
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
}

export function readPng(path: string): Png {
  const buf = new Uint8Array(fs.readFileSync(path));
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const w = v.getUint32(16);
  const h = v.getUint32(20);
  const depth = buf[24]!;
  const type = buf[25]!;
  if (buf[28] !== 0) throw new Error(`${path}: interlaced PNG`);
  const idat: Uint8Array[] = [];
  let trns: Uint8Array | null = null;
  for (let o = 8; o < buf.length; ) {
    const len = v.getUint32(o);
    const name = String.fromCharCode(...buf.subarray(o + 4, o + 8));
    if (name === "IDAT") idat.push(buf.subarray(o + 8, o + 8 + len));
    if (name === "tRNS") trns = buf.subarray(o + 8, o + 8 + len);
    o += 12 + len;
  }
  const all = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of idat) {
    all.set(c, at);
    at += c.length;
  }
  const raw = zlib.inflateSync(all);
  const channels = type === 6 ? 4 : type === 2 ? 3 : type === 4 ? 2 : 1;
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((w * channels * depth) / 8);
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= bpp ? out[y * stride + i - bpp]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c = i >= bpp && y > 0 ? out[(y - 1) * stride + i - bpp]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!;
      out[y * stride + i] = (x + pred) & 0xff;
    }
  }
  const alpha = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    const row = y * stride;
    if (type === 6) return out[row + x * 4 + 3]!;
    if (type === 4) return out[row + x * 2 + 1]!;
    if (type === 2) return 255;
    if (type === 3) {
      const perByte = 8 / depth;
      const byte = out[row + Math.floor(x / perByte)]!;
      const shift = 8 - depth * ((x % perByte) + 1);
      const idx = (byte >> shift) & ((1 << depth) - 1);
      return trns && idx < trns.length ? trns[idx]! : 255;
    }
    return 255;
  };
  return { w, h, alpha };
}
