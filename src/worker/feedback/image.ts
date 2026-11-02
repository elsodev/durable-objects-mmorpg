// Screenshot validation for feedback uploads. The bytes alone decide what a file is (never the
// part's Content-Type or filename): the container must be a complete, well-formed PNG, JPEG or
// WebP with nothing after its end marker, its header dimensions must fit, and it must not carry
// markup that a browser could be talked into reading as HTML or SVG. Stored and served with the
// type sniffed here.
import { SCREENSHOT_MAX_BYTES, SCREENSHOT_SERVER_MAX_SIDE } from "../../shared/feedback";

export type ScreenshotType = "image/png" | "image/jpeg" | "image/webp";

export interface ScreenshotInfo {
  mime: ScreenshotType;
  ext: "png" | "jpg" | "webp";
  width: number;
  height: number;
}

export type ScreenshotVerdict = { ok: true; info: ScreenshotInfo } | { ok: false; status: 413 | 415 | 422; error: string };

const NOT_IMAGE = "Screenshots must be PNG, JPEG or WebP images.";
const BROKEN = "That screenshot couldn't be read.";

function u16be(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!;
}
function u32be(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
}
function u16le(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}
function u24le(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
}
function u32le(b: Uint8Array, i: number): number {
  return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)) + ((b[i + 3]! << 24) >>> 0);
}
function ascii(b: Uint8Array, i: number, n: number): string {
  let s = "";
  for (let k = 0; k < n && i + k < b.length; k++) s += String.fromCharCode(b[i + k]!);
  return s;
}

let crcTable: Uint32Array | null = null;
function crc32(b: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Every chunk's length, type and CRC checked; IHDR first, at least one IDAT, IEND last at the very end. */
export function parsePng(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 57 || !PNG_SIG.every((v, i) => b[i] === v)) return null;
  if (u32be(b, 8) !== 13 || ascii(b, 12, 4) !== "IHDR") return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  const depth = b[24]!;
  const color = b[25]!;
  if (![1, 2, 4, 8, 16].includes(depth) || ![0, 2, 3, 4, 6].includes(color)) return null;
  if (b[26] !== 0 || b[27] !== 0 || (b[28] !== 0 && b[28] !== 1)) return null;
  let off = 8;
  let idat = false;
  let first = true;
  while (off + 12 <= b.length) {
    const len = u32be(b, off);
    const type = ascii(b, off + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type) || len > b.length) return null;
    const end = off + 12 + len;
    if (end > b.length) return null;
    if (crc32(b, off + 4, off + 8 + len) !== u32be(b, off + 8 + len)) return null;
    if (first !== (type === "IHDR")) return null;
    first = false;
    if (type === "IDAT") idat = true;
    if (type === "IEND") return len === 0 && end === b.length && idat ? { width, height } : null;
    off = end;
  }
  return null;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Segment walk from SOI to EOI (which must end the file); the size comes from the first SOF. */
export function parseJpeg(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let off = 2;
  let size: { width: number; height: number } | null = null;
  let scanned = false;
  while (off < b.length) {
    if (b[off] !== 0xff) return null;
    while (off < b.length && b[off] === 0xff) off++;
    if (off >= b.length) return null;
    const m = b[off++]!;
    if (m === 0xd9) return size && scanned && off === b.length ? size : null;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;
    if (m === 0x00 || m === 0xd8) return null;
    if (off + 2 > b.length) return null;
    const len = u16be(b, off);
    if (len < 2 || off + len > b.length) return null;
    if (SOF.has(m)) {
      if (len < 8) return null;
      size ??= { height: u16be(b, off + 3), width: u16be(b, off + 5) };
    }
    off += len;
    if (m === 0xda) {
      scanned = true;
      // Entropy-coded data runs to the next marker that isn't a stuffed 0x00 or a restart.
      while (off + 1 < b.length) {
        if (b[off] === 0xff && b[off + 1] !== 0x00 && !(b[off + 1]! >= 0xd0 && b[off + 1]! <= 0xd7)) break;
        off++;
      }
      if (off + 1 >= b.length) return null;
    }
  }
  return null;
}

/** RIFF size must match the file exactly and every chunk must fit; size from VP8, VP8L or VP8X. */
export function parseWebp(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 25 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  if (u32le(b, 4) + 8 !== b.length) return null;
  let size: { width: number; height: number } | null = null;
  let off = 12;
  let first = true;
  while (off < b.length) {
    if (off + 8 > b.length) return null;
    const type = ascii(b, off, 4);
    const len = u32le(b, off + 4);
    if (!/^[A-Z0-9 ]{4}$/.test(type)) return null;
    const data = off + 8;
    const end = data + len + (len & 1);
    if (end > b.length) return null;
    if (first) {
      if (type === "VP8 ") {
        if (len < 10 || b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a) return null;
        size = { width: u16le(b, data + 6) & 0x3fff, height: u16le(b, data + 8) & 0x3fff };
      } else if (type === "VP8L") {
        if (len < 5 || b[data] !== 0x2f) return null;
        const bits = u32le(b, data + 1);
        size = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      } else if (type === "VP8X") {
        if (len < 10) return null;
        size = { width: u24le(b, data + 4) + 1, height: u24le(b, data + 7) + 1 };
      } else {
        return null;
      }
      first = false;
    }
    off = end;
  }
  return off === b.length ? size : null;
}

/**
 * Markup a browser might act on if it ever ignored our Content-Type (polyglots hide HTML in a PNG
 * text chunk or after the image data). Long, specific tags only, so compressed pixels can't match
 * by chance.
 */
const MARKUP = /<(?:script|html|!doctype|iframe|\?xml|body|svg[\s>/]|object|embed|meta[\s>]|link[\s>]|style[\s>])/i;

export function hasMarkup(b: Uint8Array): boolean {
  // One char per byte (not every runtime's TextDecoder knows latin1), so the regex sees raw bytes.
  const parts: string[] = [];
  for (let i = 0; i < b.length; i += 8192) parts.push(String.fromCharCode(...b.subarray(i, i + 8192)));
  return MARKUP.test(parts.join(""));
}

export function checkScreenshot(b: Uint8Array): ScreenshotVerdict {
  if (b.byteLength > SCREENSHOT_MAX_BYTES) return { ok: false, status: 413, error: "Screenshot too large (max 1.5 MB)." };
  let info: ScreenshotInfo | null = null;
  if (b[0] === 0x89) {
    const s = parsePng(b);
    if (s) info = { mime: "image/png", ext: "png", ...s };
  } else if (b[0] === 0xff) {
    const s = parseJpeg(b);
    if (s) info = { mime: "image/jpeg", ext: "jpg", ...s };
  } else if (b[0] === 0x52) {
    const s = parseWebp(b);
    if (s) info = { mime: "image/webp", ext: "webp", ...s };
  }
  if (!info) {
    const known = b[0] === 0x89 || b[0] === 0xff || b[0] === 0x52;
    return known ? { ok: false, status: 422, error: BROKEN } : { ok: false, status: 415, error: NOT_IMAGE };
  }
  if (info.width < 1 || info.height < 1 || info.width > SCREENSHOT_SERVER_MAX_SIDE || info.height > SCREENSHOT_SERVER_MAX_SIDE) {
    return { ok: false, status: 422, error: `Screenshots can be at most ${SCREENSHOT_SERVER_MAX_SIDE} pixels on a side.` };
  }
  if (hasMarkup(b)) return { ok: false, status: 422, error: BROKEN };
  return { ok: true, info };
}
