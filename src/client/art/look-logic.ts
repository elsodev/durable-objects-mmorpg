// Pure parts of the character compositor (no DOM, no Pixi): reading custom.json, choosing the
// layer files for a look, and the small LRU that bounds how many composited sheets we keep.
import { LOOK_OPTIONS, LOOK_PARTS, lookKey, type LookPart } from "../../shared/look";
import type { Facing, Look } from "../../shared/types";

/** One option as the art pack lists it. `file` is relative to the manifest; hair styles have none. */
export interface LookOptionArt {
  id: string;
  label: string;
  file?: string;
  swatch?: string;
}

export interface LookRow {
  row: number;
  frames: number;
  col?: number;
}

/** The subset of assets/lpc/custom/custom.json the client uses. */
export interface LookManifest {
  frameW: number;
  frameH: number;
  sheetW: number;
  sheetH: number;
  anchor: [number, number];
  /** Draw order, bottom first: "body" (skin), "eyes", "shoes", "bottom", "top", "hair". */
  order: string[];
  walk: Record<Facing, LookRow>;
  slash: Record<Facing, LookRow> | null;
  /** Ids, labels and swatches per part (the "body" part lists the body types). */
  options: Record<LookPart, LookOptionArt[]>;
  /** Layer files per body type: files[body][layer part][option id]; hair is keyed "style:color". */
  files: Record<string, BodyFiles>;
  /** Same layers' action sheets (thrust, sit, hurt rows), loaded only when an action is first shown. */
  actionFiles: Record<string, BodyFiles>;
  /** Where each source animation lives: the walk/slash sheet ("base") or the action sheet ("act"). */
  anims: Record<string, AnimSpec>;
  /** Action animations ("hoe", "smash", "harvest", "hurt", ...), built from source animation frames. */
  actions: Record<string, ActionSpec>;
  /** Item id -> its action and tool layer sheets (drawn behind / in front of the character). */
  tools: Record<string, ToolArt>;
  /** Catalog character sheets (player_1, smith, ...) that have action sheets too. */
  characters: Record<string, FixedCharacterArt>;
}

/** A catalog character's whole-figure sheets (walk/slash like a layer's base sheet, plus its action sheet). */
export interface FixedCharacterArt {
  base: string;
  act: string;
  /** Actions this character cannot do (the generator lacks a frame for one of its garments). */
  missing: string[];
}

/** Who acts: a custom look, or a catalog character sheet by sprite id. */
export type Actor = Look | { sprite: string };

export interface AnimSpec {
  sheet: "base" | "act";
  /** First row in that sheet; with rows = 4 the rows are up, left, down, right. rows = 1: one row for every facing. */
  row: number;
  rows: number;
  frames: number;
}

export interface ActionFrame {
  anim: string;
  col: number;
}

export interface ActionSpec {
  /** Action frames are frameSize square; the 64 px layer frames sit centred in them. */
  frameSize: number;
  frames: ActionFrame[];
  /** Milliseconds per frame. */
  ms: number;
  /** Stay on the last frame instead of returning to idle (faint). */
  hold: boolean;
}

/** Tool layer sheets are laid out like the action: 4 rows (up, left, down, right) x its frames, frameSize cells. */
export interface ToolArt {
  action: string;
  bg?: string;
  fg?: string;
}

/** One body type's layer files. Pixel-identical layers may be shared between bodies. */
export type BodyFiles = Record<LayerPart, Record<string, string>>;
export type LayerPart = "skin" | "eyes" | "shoes" | "bottom" | "top" | "hair";
const LAYER_PARTS: readonly LayerPart[] = ["skin", "eyes", "shoes", "bottom", "top", "hair"];

const FACINGS: Facing[] = ["up", "left", "down", "right"];
/** Manifest layer name -> layer part (the skin sheet is the "body" layer). */
const LAYER_PART: Record<string, LayerPart> = { body: "skin", eyes: "eyes", shoes: "shoes", bottom: "bottom", top: "top", hair: "hair" };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function rows(v: unknown): Record<Facing, LookRow> | null {
  if (!isObj(v)) return null;
  const out = {} as Record<Facing, LookRow>;
  for (const f of FACINGS) {
    const r = v[f];
    if (!isObj(r) || !isNum(r.row) || !isNum(r.frames) || r.frames < 1) return null;
    out[f] = { row: r.row, frames: r.frames, ...(isNum(r.col) ? { col: r.col } : {}) };
  }
  return out;
}

function bodyFiles(json: Obj): Record<string, BodyFiles> {
  const files: Record<string, BodyFiles> = {};
  for (const [body, fm] of Object.entries(json)) {
    if (!isObj(fm)) continue;
    const bf = {} as BodyFiles;
    for (const lp of LAYER_PARTS) {
      bf[lp] = {};
      const src = fm[lp];
      if (isObj(src)) for (const [k, v] of Object.entries(src)) if (typeof v === "string") bf[lp][k] = v;
    }
    files[body] = bf;
  }
  return files;
}

/** Validates the fetched JSON; null if anything the compositor needs is missing. */
export function parseLookManifest(json: unknown): LookManifest | null {
  if (!isObj(json) || !isObj(json.options) || !isObj(json.layout)) return null;
  const { frameW, frameH, sheetW, sheetH } = json;
  if (!isNum(frameW) || !isNum(frameH) || !isNum(sheetW) || !isNum(sheetH) || !frameW || !frameH) return null;
  const walk = rows(json.layout.walk);
  if (!walk) return null;
  const order = Array.isArray(json.order) ? json.order.filter((x): x is string => typeof x === "string") : [];
  if (order.length === 0) return null;
  const opts = json.options;
  const options = {} as Record<LookPart, LookOptionArt[]>;
  for (const part of LOOK_PARTS) {
    const list = Array.isArray(opts[part]) ? (opts[part] as unknown[]) : [];
    options[part] = list.filter(isObj).flatMap((o) =>
      typeof o.id === "string"
        ? [
            {
              id: o.id,
              label: typeof o.label === "string" ? o.label : o.id,
              ...(typeof o.file === "string" ? { file: o.file } : {}),
              ...(typeof o.swatch === "string" ? { swatch: o.swatch } : {}),
            },
          ]
        : [],
    );
  }
  if (!isObj(json.files)) return null;
  const files = bodyFiles(json.files);
  if (Object.keys(files).length === 0) return null;
  const actionFiles: Record<string, BodyFiles> = isObj(json.actionFiles) ? bodyFiles(json.actionFiles) : {};
  const anims: Record<string, AnimSpec> = {};
  if (isObj(json.anims))
    for (const [k, v] of Object.entries(json.anims))
      if (isObj(v) && (v.sheet === "base" || v.sheet === "act") && isNum(v.row) && (v.rows === 1 || v.rows === 4) && isNum(v.frames))
        anims[k] = { sheet: v.sheet, row: v.row, rows: v.rows, frames: v.frames };
  const actions: Record<string, ActionSpec> = {};
  if (isObj(json.actions))
    for (const [k, v] of Object.entries(json.actions)) {
      if (!isObj(v) || !isNum(v.frameSize) || v.frameSize < frameW || !Array.isArray(v.frames) || v.frames.length === 0) continue;
      const frames: ActionFrame[] = [];
      for (const f of v.frames) {
        const [anim, col] = typeof f === "string" ? f.split(",") : [];
        const c = Number(col);
        if (anim && Object.hasOwn(anims, anim) && Number.isInteger(c) && c >= 0 && c < anims[anim]!.frames) frames.push({ anim, col: c });
      }
      if (frames.length !== v.frames.length) continue;
      actions[k] = { frameSize: v.frameSize, frames, ms: isNum(v.ms) && v.ms > 0 ? v.ms : 100, hold: v.hold === true };
    }
  const tools: Record<string, ToolArt> = {};
  if (isObj(json.tools))
    for (const [k, v] of Object.entries(json.tools))
      if (isObj(v) && typeof v.action === "string" && Object.hasOwn(actions, v.action))
        tools[k] = {
          action: v.action,
          ...(typeof v.bg === "string" ? { bg: v.bg } : {}),
          ...(typeof v.fg === "string" ? { fg: v.fg } : {}),
        };
  const a = Array.isArray(json.anchor) && isNum(json.anchor[0]) && isNum(json.anchor[1]) ? json.anchor : null;
  const characters: Record<string, FixedCharacterArt> = {};
  if (isObj(json.characters))
    for (const [k, v] of Object.entries(json.characters))
      if (isObj(v) && typeof v.base === "string" && typeof v.act === "string")
        characters[k] = {
          base: v.base,
          act: v.act,
          missing: Array.isArray(v.missing) ? v.missing.filter((x): x is string => typeof x === "string") : [],
        };
  return {
    frameW,
    frameH,
    sheetW,
    sheetH,
    anchor: a ? [a[0] as number, a[1] as number] : [frameW / 2, frameH * 0.94],
    order,
    walk,
    slash: rows(json.layout.slash),
    options,
    files,
    actionFiles,
    anims,
    actions,
    tools,
    characters,
  };
}

const own = (o: Record<string, string>, k: string): string | null => (Object.hasOwn(o, k) ? o[k]! : null);

/** Key of a look's layer within its part: the option id, or "style:color" for hair. */
function layerKey(part: LayerPart, look: Look): string {
  return part === "hair" ? `${look.hairStyle}:${look.hairColor}` : look[part];
}

/**
 * Layer files to draw for `look`, bottom first, following the manifest's `order`, from the
 * look's body type. Unknown ids (or an unknown body) are skipped.
 */
export function layerFiles(m: LookManifest, look: Look, sheet: "base" | "act" = "base"): string[] {
  const out: string[] = [];
  for (const layer of m.order) {
    const file = layerFileAt(m, look, sheet, layer);
    if (file) out.push(file);
  }
  return out;
}

/** Every walk/slash layer file the manifest can reference, across all bodies (preloaded once, they are small). Action sheets load lazily. */
export function allLayerFiles(m: LookManifest): string[] {
  const set = new Set<string>();
  for (const bf of Object.values(m.files)) for (const lp of LAYER_PARTS) for (const f of Object.values(bf[lp])) set.add(f);
  return [...set];
}

/** One drawImage call of an action sheet: source rect in `file`, destination x/y in the action sheet. */
export interface ActionDraw {
  file: string;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
}

/** Everything needed to compose one action sheet for a look (4 facing rows x the action's frames). */
export interface ActionPlan {
  action: string;
  spec: ActionSpec;
  width: number;
  height: number;
  /** Bottom first: tool background, the look's layers frame by frame, tool foreground. */
  draws: ActionDraw[];
  files: string[];
}

/** Resolves an action name or a tool item id ("pickaxe_iron") to [action, tool item or null]. */
export function resolveAction(m: LookManifest, nameOrItem: string): [string, string | null] | null {
  if (Object.hasOwn(m.tools, nameOrItem)) return [m.tools[nameOrItem]!.action, nameOrItem];
  if (Object.hasOwn(m.actions, nameOrItem)) return [nameOrItem, null];
  return null;
}

/** Key that names an actor in caches. */
export function actorKey(who: Actor): string {
  return "sprite" in who ? `sprite:${who.sprite}` : lookKey(who);
}

/** The actor's layers bottom first, each as its walk/slash sheet and its action sheet. */
function actorLayers(m: LookManifest, who: Actor): { base: string | null; act: string | null }[] | null {
  if ("sprite" in who) {
    const c = Object.hasOwn(m.characters, who.sprite) ? m.characters[who.sprite]! : null;
    return c ? [{ base: c.base, act: c.act }] : null;
  }
  return m.order.map((layer) => ({ base: layerFileAt(m, who, "base", layer), act: layerFileAt(m, who, "act", layer) }));
}

/**
 * Plan for drawing `who` (a look, or a catalog character by sprite id) doing `nameOrItem` (an
 * action, or a tool item which picks its action and adds its layers). Null when there is no such
 * action, or the character cannot do it. Tool layers follow the generator's split: "bg" sits below
 * the body (zPos 8-9), "fg" above the hair (zPos 150).
 */
export function actionPlan(m: LookManifest, who: Actor, nameOrItem: string): ActionPlan | null {
  const r = resolveAction(m, nameOrItem);
  if (!r) return null;
  const [action, item] = r;
  const layers = actorLayers(m, who);
  if (!layers) return null;
  if ("sprite" in who && m.characters[who.sprite]!.missing.includes(action)) return null;
  const spec = m.actions[action]!;
  const fs = spec.frameSize;
  const width = spec.frames.length * fs;
  const height = FACINGS.length * fs;
  const off = (fs - m.frameW) / 2;
  const draws: ActionDraw[] = [];
  const tool = item ? m.tools[item]! : null;
  const whole = (file: string): ActionDraw => ({ file, sx: 0, sy: 0, sw: width, sh: height, dx: 0, dy: 0 });
  if (tool?.bg) draws.push(whole(tool.bg));
  // Layer by layer (each layer is one z level), every frame of every facing.
  for (const layer of layers) {
    for (let fi = 0; fi < FACINGS.length; fi++) {
      spec.frames.forEach((f, j) => {
        const a = m.anims[f.anim]!;
        const file = a.sheet === "base" ? layer.base : layer.act;
        if (!file) return;
        const row = a.row + (a.rows === 4 ? fi : 0);
        draws.push({ file, sx: f.col * m.frameW, sy: row * m.frameH, sw: m.frameW, sh: m.frameH, dx: j * fs + off, dy: fi * fs + off });
      });
    }
  }
  if (tool?.fg) draws.push(whole(tool.fg));
  return { action, spec, width, height, draws, files: [...new Set(draws.map((d) => d.file))] };
}

function layerFileAt(m: LookManifest, look: Look, sheet: "base" | "act", layer: string): string | null {
  const all = sheet === "base" ? m.files : m.actionFiles;
  const bf = Object.hasOwn(all, look.body) ? all[look.body]! : null;
  const part = Object.hasOwn(LAYER_PART, layer) ? LAYER_PART[layer]! : null;
  return bf && part ? own(bf[part], layerKey(part, look)) : null;
}

/** Option ids in the manifest that the shared validator does not know (should be empty). */
export function unknownOptionIds(m: LookManifest): string[] {
  const bad: string[] = [];
  for (const part of LOOK_PARTS) for (const o of m.options[part]) if (!LOOK_OPTIONS[part].includes(o.id)) bad.push(`${part}:${o.id}`);
  return bad;
}

/** Pixel rects [x, y, w, h] of one animation row in a composited sheet. */
export function rowFrames(m: LookManifest, r: LookRow): [number, number, number, number][] {
  const col = r.col ?? 0;
  return Array.from({ length: r.frames }, (_, i) => [(col + i) * m.frameW, r.row * m.frameH, m.frameW, m.frameH]);
}

export { lookKey };

/**
 * Least-recently-used map with a hard size cap. `set` returns what it evicted so the caller
 * can release it (or simply drop the reference).
 */
export class LruCache<V> {
  private map = new Map<string, V>();
  constructor(readonly max: number) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V): V[] {
    this.map.delete(key);
    this.map.set(key, value);
    const evicted: V[] = [];
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      evicted.push(this.map.get(oldest)!);
      this.map.delete(oldest);
    }
    return evicted;
  }

  clear(): void {
    this.map.clear();
  }
}
