// Upload validation by magic bytes (never trust the client's content-type).

export const MAX_UPLOAD_BYTES = 1024 * 1024;

export type ImageKind = { mime: "image/png"; ext: "png" } | { mime: "image/webp"; ext: "webp" };

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 8 && PNG_SIG.every((b, i) => bytes[i] === b)) return { mime: "image/png", ext: "png" };
  // "RIFF" <size> "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

/** Reads a body up to `max` bytes; returns null as soon as it is larger. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** R2 prefixes /files/* never serves: feedback screenshots are for admins only (/api/feedback). */
export const PRIVATE_FILE_PREFIXES: readonly string[] = ["feedback/"];

/** R2 keys served by /files/*: plain path segments of safe chars only (no "..", no empty segments). */
export function isSafeFileKey(key: string): boolean {
  if (PRIVATE_FILE_PREFIXES.some((p) => key.toLowerCase().startsWith(p))) return false;
  if (key.length === 0 || key.length > 256) return false;
  return key.split("/").every((seg) => /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(seg) && !seg.includes(".."));
}
