// Pure helpers for reading the art catalog: no Pixi, no DOM, so they are unit-testable.
import type { AnimRow, Catalog, CropEntry, PointTuple, RectTuple, SpriteEntry } from "./catalog-types";

/** Stable 32-bit hash of a tile position (same tile -> same variant on every client). */
export function hashXY(x: number, y: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Picks 0 (the base tile) most of the time and 1..variants otherwise, so variant
 * tiles read as sprinkled detail rather than noise.
 */
export function pickVariant(hash: number, variants: number, baseWeight = 0.6): number {
  if (variants <= 0) return 0;
  const r = (hash % 1000) / 1000;
  if (r < baseWeight) return 0;
  const i = Math.floor(((r - baseWeight) / (1 - baseWeight)) * variants);
  return 1 + Math.min(variants - 1, i);
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Validates an [x,y,w,h] tuple with a positive size; anything else -> null. */
export function asRect(v: unknown): RectTuple | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(isNum)) return null;
  const [x, y, w, h] = v as number[];
  if (w! <= 0 || h! <= 0 || x! < 0 || y! < 0) return null;
  return [x!, y!, w!, h!];
}

/**
 * The sheet rect for a crop's stage and look. Ready crops never wilt, so a wilted ready crop keeps
 * its ready art; a crop without wilted or dead frames falls back to its stage art.
 */
export function cropRect(e: CropEntry, stage: 0 | 1 | 2 | 3, look: "normal" | "wilted" | "dead" = "normal"): RectTuple | null {
  if (look === "dead") {
    const dead = asRect(e.dead);
    if (dead) return dead;
  }
  if (look !== "normal" && stage < 3 && Array.isArray(e.wilted)) {
    const w = asRect(e.wilted[stage]);
    if (w) return w;
  }
  return Array.isArray(e.stages) ? asRect(e.stages[stage]) : null;
}

export function asPoint(v: unknown): PointTuple | null {
  if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum)) return null;
  return [v[0] as number, v[1] as number];
}

/** True if the rect lies fully inside an image of the given size. */
export function rectFits(r: RectTuple, imgW: number, imgH: number): boolean {
  return r[0] + r[2] <= imgW && r[1] + r[3] <= imgH;
}

/** Pixel anchor (relative to rect origin) -> Pixi anchor 0..1; default is bottom-centre. */
export function normAnchor(px: unknown, w: number, h: number, fallback: PointTuple = [0.5, 1]): { x: number; y: number } {
  const p = asPoint(px);
  if (!p || w <= 0 || h <= 0) return { x: fallback[0], y: fallback[1] };
  return { x: p[0] / w, y: p[1] / h };
}

/** Frame rects of one animation row of a uniform sheet. */
export function rowRects(row: AnimRow | undefined, frameW: number, frameH: number): RectTuple[] {
  if (!row || !isNum(row.row) || !isNum(row.frames) || row.frames <= 0 || row.row < 0) return [];
  const col = isNum(row.col) && row.col >= 0 ? row.col : 0;
  const out: RectTuple[] = [];
  for (let i = 0; i < row.frames; i++) out.push([(col + i) * frameW, row.row * frameH, frameW, frameH]);
  return out;
}

/**
 * Furniture rotation -> source rect. 0 = front (default rect), 1 = left, 2 = back, 3 = right
 * (a mirrored "left" when the sheet has no right view). Missing views fall back to the front.
 */
export function furnitureView(
  entry: SpriteEntry,
  rotation: 0 | 1 | 2 | 3,
): { rect: RectTuple; mirror: boolean; anchor?: PointTuple } | null {
  const base = asRect(entry.rect);
  if (!base) return null;
  const v = entry.variants && !Array.isArray(entry.variants) ? entry.variants : {};
  const anchors = entry.variantAnchors ?? {};
  const pick = (name: string, mirror: boolean) => {
    const rect = asRect(v[name]);
    if (!rect) return null;
    const anchor = asPoint(anchors[name]);
    return anchor ? { rect, mirror, anchor } : { rect, mirror };
  };
  if (rotation === 1) return pick("left", false) ?? { rect: base, mirror: false };
  if (rotation === 2) return pick("back", false) ?? { rect: base, mirror: false };
  // Facing right: its own art, else the left art mirrored, else the front mirrored (items only
  // allow rotation 3 without turned art where a mirror image reads right, see ItemDef.rotations).
  if (rotation === 3) return pick("right", false) ?? pick("left", true) ?? { rect: base, mirror: true };
  return { rect: base, mirror: false };
}

/**
 * Anchor (px) for a furniture view whose rect differs in size from the front rect: keeps the
 * front anchor's offset from the bottom centre, so side and back views stand on the same feet
 * point (a 2x1 rotated bed is wider and shorter than the 1x2 front view).
 */
export function viewAnchorPx(base: RectTuple, baseAnchor: PointTuple | null, view: RectTuple): PointTuple {
  const a = baseAnchor ?? [base[2] / 2, base[3]];
  if (view[2] === base[2] && view[3] === base[3]) return a;
  return [view[2] / 2 + (a[0] - base[2] / 2), view[3] - (base[3] - a[1])];
}

/**
 * Anchor for an overlay rect so that, placed at the same position as the main sprite,
 * it lines up with its pixels in the sheet.
 */
export function overlayAnchor(main: RectTuple, mainAnchorPx: PointTuple, overlay: RectTuple): { x: number; y: number } {
  return {
    x: (main[0] + mainAnchorPx[0] - overlay[0]) / overlay[2],
    y: (main[1] + mainAnchorPx[1] - overlay[1]) / overlay[3],
  };
}

/** Every PNG path (relative to the catalog) the catalog references. */
export function collectFiles(cat: Catalog): string[] {
  const files = new Set<string>();
  const sections = [
    cat.characters,
    cat.monsters,
    cat.animals,
    cat.terrain,
    cat.props,
    cat.buildings,
    cat.plants,
    cat.ores,
    cat.furniture,
    cat.crops,
    cat.icons,
  ];
  for (const sec of sections) {
    if (!sec || typeof sec !== "object") continue;
    for (const e of Object.values(sec)) {
      const f = (e as { file?: unknown } | null)?.file;
      if (typeof f === "string" && isSafePath(f)) files.add(f);
    }
  }
  for (const f of interiorFiles(cat)) if (isSafePath(f)) files.add(f);
  const sf = cat.shadows?.file;
  if (typeof sf === "string" && isSafePath(sf)) files.add(sf);
  return [...files];
}

/** Catalog paths must stay inside the asset folder. */
export function isSafePath(p: string): boolean {
  return /^[\w\-./]+\.png$/i.test(p) && !p.split("/").includes("..") && !p.startsWith("/");
}

/** Rect for a shadow size from either `shadows.rects[size]` or `shadows[size]`. */
export function shadowRect(cat: Catalog, size: string): RectTuple | null {
  const s = cat.shadows;
  if (!s) return null;
  return asRect(s.rects?.[size]) ?? asRect(s[size]);
}

/** PNGs the interior kit section uses (floor sheets, wall style sheets). */
export function interiorFiles(cat: Catalog): string[] {
  const out: string[] = [];
  const sec = cat.interior;
  if (!sec || typeof sec !== "object") return out;
  for (const e of Object.values(sec)) {
    const f = (e as { file?: unknown } | null)?.file;
    if (typeof f === "string") out.push(f);
  }
  const styles = (sec.walls as { styles?: Record<string, { file?: unknown }> } | undefined)?.styles;
  for (const st of Object.values(styles ?? {})) if (typeof st?.file === "string") out.push(st.file);
  return out;
}
