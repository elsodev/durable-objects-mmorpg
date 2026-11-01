// Loads the LPC art pack described by /assets/lpc/catalog.json and slices it into textures.
// Anything the catalog lacks (or that fails to load) comes from art/placeholders.ts, so the
// game always renders, even with no art pack at all.
import { Assets, Graphics, Texture, groupD8, type Application, type TextureSource } from "pixi.js";
import { SCALE, type Art, type CharacterArt, type LoadArt, type Placeholders, type ShadowSize, type SpriteArt } from "../contracts";
import { Ground, type Facing, type ItemId } from "../../shared/types";
import type { BlobSet, GroundBlob, GroundEdgeArt } from "../render/ground";
import type { Catalog, CharacterEntry, DirRows, RectTuple, SpriteEntry } from "./catalog-types";
import { PROCEDURAL_INTERIOR_PROPS } from "./draw/interior";
import { fitIcon, opaqueBox } from "./icon-fit";
import { FENCE_TILE, fenceParts } from "../render/fence";
import { WET_TILLED_OFFSET, makePlaceholders, placeholderIconUrl } from "./placeholders";
import {
  asPoint,
  asRect,
  collectFiles,
  furnitureView,
  hashXY,
  normAnchor,
  overlayAnchor,
  pickVariant,
  rectFits,
  rowRects,
  shadowRect,
} from "./slice";

const FACINGS: Facing[] = ["up", "left", "down", "right"];

const TERRAIN_KEY: Partial<Record<Ground, string>> = {
  [Ground.Grass]: "grass",
  [Ground.Dirt]: "dirt",
  [Ground.Sand]: "sand",
  [Ground.Water]: "water",
  [Ground.Stone]: "stone",
  [Ground.Wood]: "wood",
  [Ground.Tilled]: "tilled",
  [Ground.CaveWall]: "cave_wall",
  [Ground.Wall]: "wall",
};

/** Map prop types the pack names differently. */
const PROP_ALIASES: Record<string, string> = { herb_patch: "herb_plant", tree: "tree_oak" };
/**
 * Props always drawn by placeholders.ts. The pack's "cottage" is a house seen from OUTSIDE (front
 * door, gable roof), but the home map uses this prop as the cottage's north wall seen from inside.
 */
const PROCEDURAL_PROPS: ReadonlySet<string> = new Set(["cottage", ...PROCEDURAL_INTERIOR_PROPS]);
const FENCE_FILE = "props/plain_fence_a.png";

/** Source-px sizes for procedural shadows when the pack has none. */
const SHADOW_SIZE: Record<ShadowSize, [number, number]> = {
  small: [18, 7],
  character: [28, 10],
  medium: [40, 14],
  large: [60, 20],
  tree: [80, 24],
};
const SHADOW_COLOR = 0x322125;

export const loadArt: LoadArt = async (app) => {
  const base = "/assets/lpc/";
  const cat = await fetchCatalog(`${base}catalog.json`);
  const sheets = await loadSheets(base, collectFiles(cat));
  return buildArt(app, cat, sheets);
};

async function fetchCatalog(url: string): Promise<Catalog> {
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const json: unknown = await res.json();
    return json && typeof json === "object" && !Array.isArray(json) ? (json as Catalog) : {};
  } catch (err) {
    console.warn("[art] catalog unavailable, using placeholders", err);
    return {};
  }
}

async function loadSheets(base: string, files: string[]): Promise<Map<string, TextureSource>> {
  const out = new Map<string, TextureSource>();
  const results = await Promise.allSettled(files.map((f) => Assets.load<Texture>(base + f)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value?.source) {
      r.value.source.scaleMode = "nearest";
      out.set(files[i]!, r.value.source);
    } else {
      console.warn(`[art] failed to load ${files[i]}`);
    }
  });
  return out;
}

function buildArt(app: Application, cat: Catalog, sheets: Map<string, TextureSource>): Art {
  // Placeholders are created lazily: with a complete pack they may never be needed.
  let ph: Placeholders | null = null;
  const fb = (): Placeholders => {
    if (!ph) {
      try {
        ph = makePlaceholders(app);
      } catch (err) {
        console.warn("[art] placeholders failed, using blank textures", err);
        ph = blankPlaceholders();
      }
    }
    return ph;
  };

  const sliceCache = new Map<string, Texture | null>();
  const slice = (file: string, rect: RectTuple | null, mirror = false): Texture | null => {
    if (!rect) return null;
    const key = `${file}|${rect.join(",")}|${mirror ? 1 : 0}`;
    const hit = sliceCache.get(key);
    if (hit !== undefined) return hit;
    const source = sheets.get(file);
    let tex: Texture | null = null;
    if (source && rectFits(rect, source.width, source.height)) {
      const [x, y, width, height] = rect;
      tex = new Texture({
        source,
        frame: { x, y, width, height } as Texture["frame"],
        rotate: mirror ? groupD8.MIRROR_HORIZONTAL : 0,
      });
    }
    sliceCache.set(key, tex);
    return tex;
  };

  const spriteFrom = (entry: SpriteEntry | undefined, rect: RectTuple | null, mirror = false): SpriteArt | null => {
    if (!entry || !rect) return null;
    const texture = slice(entry.file, rect, mirror);
    if (!texture) return null;
    const a = normAnchor(entry.anchor, rect[2], rect[3]);
    const art: SpriteArt = { texture, anchor: mirror ? { x: 1 - a.x, y: a.y } : a };
    if (typeof entry.shadow === "string" && entry.shadow in SHADOW_SIZE) art.shadow = entry.shadow as ShadowSize;
    return art;
  };

  // ---- ground
  const groundCache = new Map<string, Texture[]>();
  const terrainTiles = (key: string): Texture[] => {
    let list = groundCache.get(key);
    if (!list) {
      const t = cat.terrain?.[key];
      list = [];
      if (t) {
        const tile = slice(t.file, asRect(t.tile));
        if (tile) {
          list.push(tile);
          for (const v of Array.isArray(t.variants) ? t.variants : []) {
            const vt = slice(t.file, asRect(v));
            if (vt) list.push(vt);
          }
        }
      }
      groundCache.set(key, list);
    }
    return list;
  };
  const ground = (kind: Ground, x: number, y: number): Texture => {
    const h = hashXY(x, y);
    const key = TERRAIN_KEY[kind];
    const tiles = key ? terrainTiles(key) : [];
    if (tiles.length) return tiles[pickVariant(h, tiles.length - 1)]!;
    return fb().ground(kind, pickVariant(h, 3));
  };

  // ---- characters
  const charCache = new Map<string, CharacterArt>();
  const buildCharacter = (e: CharacterEntry): CharacterArt | null => {
    const fw = e.frameW ?? 64;
    const fh = e.frameH ?? 64;
    const rows = (dirs: DirRows | undefined): Record<Facing, Texture[]> | null => {
      if (!dirs) return null;
      const out = {} as Record<Facing, Texture[]>;
      for (const f of FACINGS) {
        const frames = rowRects(dirs[f], fw, fh).map((r) => slice(e.file, r));
        if (!frames.length || frames.some((t) => !t)) return null;
        out[f] = frames as Texture[];
      }
      return out;
    };
    const walk = rows(e.animations?.walk);
    if (!walk) return null;
    const idleRows = rows(e.animations?.idle);
    const idle = {} as Record<Facing, Texture>;
    for (const f of FACINGS) idle[f] = idleRows?.[f][0] ?? walk[f][0]!;
    const art: CharacterArt = { walk, idle, anchor: normAnchor(e.anchor, fw, fh, [0.5, 0.94]) };
    const attack = rows(e.animations?.slash) ?? rows(e.animations?.attack);
    if (attack) art.attack = attack;
    if (typeof e.shadow === "string" && e.shadow in SHADOW_SIZE) art.shadow = e.shadow as ShadowSize;
    if (e.flying) art.flying = true;
    if (typeof e.hover === "number" && Number.isFinite(e.hover) && e.hover > 0) art.hover = e.hover * SCALE;
    return art;
  };
  const character = (key: string): CharacterArt => {
    let art = charCache.get(key);
    if (!art) {
      const e = cat.characters?.[key] ?? cat.monsters?.[key];
      art = (e && buildCharacter(e)) || fb().character(key);
      charCache.set(key, art);
    }
    return art;
  };

  // ---- props
  const propCache = new Map<string, SpriteArt>();
  const buildProp = (e: SpriteEntry): SpriteArt | null => {
    const rect = asRect(e.rect);
    const art = spriteFrom(e, rect);
    if (!art || !rect) return null;
    if (Array.isArray(e.frames)) {
      const frames = e.frames.map((r) => slice(e.file, asRect(r)));
      if (frames.length > 1 && frames.every((t) => t)) {
        art.frames = frames as Texture[];
        art.texture = art.frames[0]!;
      }
    }
    const anchorPx = asPoint(e.anchor) ?? [rect[2] / 2, rect[3]];
    const front = asRect(e.frontOverlay);
    const frontTex = slice(e.file, front);
    if (front && frontTex)
      art.front = {
        texture: frontTex,
        anchor: e.frontAligned ? { x: anchorPx[0] / front[2], y: anchorPx[1] / front[3] } : overlayAnchor(rect, anchorPx, front),
      };
    const surf = asRect(e.surface);
    if (surf) art.surface = { x: surf[0] - anchorPx[0], y: surf[1] - anchorPx[1], w: surf[2], h: surf[3] };
    const keeper = asPoint(e.keeper);
    if (keeper) art.keeper = { x: (keeper[0] - anchorPx[0]) * SCALE, y: (keeper[1] - anchorPx[1]) * SCALE };
    const label = asPoint(e.labelAnchor);
    if (label) art.label = { x: (label[0] - anchorPx[0]) * SCALE, y: (label[1] - anchorPx[1]) * SCALE };
    return art;
  };
  const prop = (type: string): SpriteArt => {
    let art = propCache.get(type);
    if (!art) {
      const alias = PROP_ALIASES[type];
      const e = PROCEDURAL_PROPS.has(type)
        ? undefined
        : cat.props?.[type] ?? cat.buildings?.[type] ?? cat.plants?.[type] ?? (alias ? cat.plants?.[alias] : undefined);
      art = (e && buildProp(e)) || fb().prop(type);
      propCache.set(type, art);
    }
    return art;
  };

  // ---- crops, rocks, furniture, icons
  const memo = <K extends string>(make: (k: K) => SpriteArt): ((k: K) => SpriteArt) => {
    const cache = new Map<K, SpriteArt>();
    return (k) => {
      let v = cache.get(k);
      if (!v) cache.set(k, (v = make(k)));
      return v;
    };
  };

  const cropArt = memo<string>((k) => {
    const [cropId, s] = k.split("|") as [string, string];
    const stage = Number(s) as 0 | 1 | 2 | 3;
    const e = cat.crops?.[cropId.replace(/^seed_/, "")];
    const rect = Array.isArray(e?.stages) ? asRect(e.stages[stage]) : null;
    return (e && spriteFrom({ ...e, rect: rect ?? undefined }, rect)) || fb().crop(cropId, stage);
  });

  const rockArt = memo<"stone" | "copper" | "iron" | "gem">((ore) => {
    const e = cat.ores?.[`rock_${ore}`];
    return (e && spriteFrom(e, asRect(e.rect))) || fb().rock(ore);
  });

  const furnitureArt = memo<string>((k) => {
    const [item, r] = k.split("|") as [string, string];
    const rotation = Number(r) as 0 | 1 | 2 | 3;
    const e = cat.furniture?.[item];
    const view = e ? furnitureView(e, rotation) : null;
    return (e && view && spriteFrom(e, view.rect, view.mirror)) || fb().furniture(item, rotation);
  });

  const iconCache = new Map<ItemId, Texture>();
  const icon = (item: ItemId): Texture => {
    let tex = iconCache.get(item);
    if (!tex) {
      const e = cat.icons?.[item];
      tex = (e && slice(e.file, asRect(e.rect))) || fb().icon(item);
      iconCache.set(item, tex);
    }
    return tex;
  };

  const urlCache = new Map<ItemId, string>();
  const iconUrl = (item: ItemId): string => {
    let url = urlCache.get(item);
    if (url === undefined) {
      // Missing from the pack: draw the placeholder straight to a 2D canvas (no GPU readback).
      url = (!cat.icons?.[item] && placeholderIconUrl(item)) || textureToDataUrl(app, icon(item));
      urlCache.set(item, url);
    }
    return url;
  };

  const shadowCache = new Map<ShadowSize, Texture>();
  const shadow = (size: ShadowSize): Texture => {
    let tex = shadowCache.get(size);
    if (!tex) {
      const file = cat.shadows?.file;
      tex = (typeof file === "string" && slice(file, shadowRect(cat, size))) || ellipseShadow(app, size);
      shadowCache.set(size, tex);
    }
    return tex;
  };

  // ---- terrain transition blobs (GroundEdgeArt in render/ground.ts)
  const blobCache = new Map<string, GroundBlob | null>();
  const groundBlob = (set: BlobSet): GroundBlob | null => {
    if (blobCache.has(set)) return blobCache.get(set)!;
    const [terrain, bank] = set.split(".") as [string, string | undefined];
    const t = cat.terrain?.[terrain];
    const edges = (t?.edges ?? null) as Record<string, unknown> | null;
    let blob: GroundBlob | null = null;
    if (t && edges) {
      const outerKey = bank ? `${bank}BankOverlay3x3` : "outer3x3";
      const innerKey = bank ? `${bank}Inner2x2` : "inner2x2";
      const outer3x3 = slice(t.file, asRect(edges[outerKey]));
      const inner2x2 = slice(t.file, asRect(edges[innerKey]));
      if (outer3x3 && inner2x2) blob = { outer3x3, inner2x2 };
    }
    blobCache.set(set, blob);
    return blob;
  };

  // ---- autotiled fences (render/fence.ts): composed per neighbour mask from the plain fence sheet
  const fenceCache = new Map<number, SpriteArt | null>();
  const fence = (mask: number): SpriteArt | null => {
    if (fenceCache.has(mask)) return fenceCache.get(mask)!;
    let out: SpriteArt | null = null;
    const res = sheets.get(FENCE_FILE)?.resource as CanvasImageSource | undefined;
    if (res && typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = FENCE_TILE.w;
      c.height = FENCE_TILE.h;
      const g = c.getContext("2d");
      if (g) {
        g.imageSmoothingEnabled = false;
        for (const p of fenceParts(mask)) {
          const [sx, sy, w, h] = p.src;
          g.drawImage(res, sx, sy, w, h, p.dx, p.dy, w, h);
        }
        const texture = Texture.from(c);
        texture.source.scaleMode = "nearest";
        out = { texture, anchor: { x: 0.5, y: FENCE_TILE.feetY / FENCE_TILE.h } };
      }
    }
    fenceCache.set(mask, out);
    return out;
  };

  // ---- interior kit: floors and wall tops
  const floor = (style: string, x: number, y: number): Texture | null => {
    const e = cat.interior?.[style] as { file?: unknown; tile?: unknown; variants?: unknown } | undefined;
    if (!e || typeof e.file !== "string") return null;
    const rects = [e.tile, ...(Array.isArray(e.variants) ? e.variants : [])].map(asRect).filter((r): r is RectTuple => !!r);
    if (rects.length === 0) return null;
    return slice(e.file, rects[pickVariant(hashXY(x, y), rects.length - 1)]!);
  };
  const wallBorder = (style: string, piece: string): Texture | null => {
    const walls = cat.interior?.walls as { styles?: Record<string, { file?: unknown; pieces?: Record<string, unknown> }> } | undefined;
    const st = walls?.styles?.[style];
    if (!st || typeof st.file !== "string") return null;
    return slice(st.file, asRect(st.pieces?.[piece]));
  };

  const art: Art & GroundEdgeArt = {
    groundBlob,
    fence,
    ground,
    floor,
    wallBorder,
    prop,
    character,
    crop: (c, stage) => cropArt(`${c}|${stage}`),
    rock: rockArt,
    furniture: (item, rotation) => furnitureArt(`${item}|${rotation}`),
    icon,
    iconUrl,
    shadow,
    tilledWet: (x, y) => {
      const tiles = terrainTiles("tilled_wet");
      if (tiles.length) return tiles[pickVariant(hashXY(x, y), tiles.length - 1)]!;
      // No wet sheet in the pack: placeholders draw the watered look as Tilled variants 4..7.
      return fb().ground(Ground.Tilled, WET_TILLED_OFFSET + pickVariant(hashXY(x, y), 3));
    },
  };
  return art;
}

function ellipseShadow(app: Application, size: ShadowSize): Texture {
  const [w, h] = SHADOW_SIZE[size];
  const g = new Graphics()
    .ellipse(w / 2, h / 2, w / 2, h / 2)
    .fill({ color: SHADOW_COLOR, alpha: 0.3 })
    .ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 1.5)
    .fill({ color: SHADOW_COLOR, alpha: 0.2 });
  const tex = app.renderer.generateTexture({ target: g, resolution: 1 });
  tex.source.scaleMode = "nearest";
  g.destroy();
  return tex;
}

const BLANK_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const ICON_PX = 32;

/** Crops a copied icon cell to its sprite and scales it up by a whole factor (see icon-fit.ts). */
function fitToIconCell(src: HTMLCanvasElement, srcCtx: CanvasRenderingContext2D): string | null {
  const box = opaqueBox(srcCtx.getImageData(0, 0, src.width, src.height).data, src.width, src.height);
  if (!box) return null;
  const fit = fitIcon(box, ICON_PX);
  const out = document.createElement("canvas");
  out.width = ICON_PX;
  out.height = ICON_PX;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, box.x, box.y, box.w, box.h, fit.x, fit.y, fit.w, fit.h);
  return out.toDataURL("image/png");
}

/** Image-backed textures are copied with a 2D canvas (no GPU readback); generated ones via extract. */
function textureToDataUrl(app: Application, tex: Texture): string {
  try {
    const res = tex.source.resource as unknown;
    const drawable =
      (typeof ImageBitmap !== "undefined" && res instanceof ImageBitmap) ||
      (typeof HTMLImageElement !== "undefined" && res instanceof HTMLImageElement) ||
      (typeof HTMLCanvasElement !== "undefined" && res instanceof HTMLCanvasElement);
    if (drawable && !tex.rotate) {
      const { x, y, width, height } = tex.frame;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(res as CanvasImageSource, x, y, width, height, 0, 0, width, height);
        return fitToIconCell(canvas, ctx) ?? canvas.toDataURL("image/png");
      }
    }
    return app.renderer.extract.canvas(tex).toDataURL?.("image/png") ?? BLANK_PNG;
  } catch (err) {
    console.warn("[art] icon extract failed", err);
    return BLANK_PNG;
  }
}

/** Last resort if placeholders.ts itself fails: blank textures keep the game running. */
function blankPlaceholders(): Placeholders {
  const tex = Texture.WHITE;
  const sprite: SpriteArt = { texture: tex, anchor: { x: 0.5, y: 1 } };
  const dirs = <T>(v: T): Record<Facing, T> => ({ up: v, left: v, down: v, right: v });
  const ch: CharacterArt = { walk: dirs([tex]), idle: dirs(tex), anchor: { x: 0.5, y: 1 } };
  return {
    ground: () => tex,
    prop: () => sprite,
    character: () => ch,
    crop: () => sprite,
    rock: () => sprite,
    furniture: () => sprite,
    icon: () => tex,
  };
}
