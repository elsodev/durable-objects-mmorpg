// Character compositor: draws the LPC layer sheets of a look's body type (skin, eyes, shoes,
// bottom, top, hair; order from custom.json) onto one sheet-sized canvas. Sheets are cached by look key
// (LRU, MAX_LOOK_SHEETS), so a crowd of players with the same outfit costs one canvas.
import type { Look } from "../../shared/types";
import { actionPlan, actorKey, allLayerFiles, layerFiles, lookKey, LruCache, parseLookManifest, unknownOptionIds, type ActionPlan, type Actor, type LookManifest } from "./look-logic";

export const LOOK_BASE = "/assets/lpc/custom/";
export const MAX_LOOK_SHEETS = 32;
/** Composited action sheets kept (look x action x tool); they are built on first use. */
export const MAX_ACTION_SHEETS = 48;

/** The 2D-canvas surface the compositor needs; tests pass a fake. */
export interface SheetCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): Pick<CanvasRenderingContext2D, "drawImage" | "clearRect"> & { imageSmoothingEnabled: boolean } | null;
}

export interface CompositorDeps<I, C extends SheetCanvas> {
  fetchJson(url: string): Promise<unknown>;
  loadImage(url: string): Promise<I>;
  makeCanvas(w: number, h: number): C;
}

export interface LookCompositor<C extends SheetCanvas = HTMLCanvasElement> {
  /** Fetches custom.json and every layer image. Never rejects: false means "use catalog sprites". */
  load(): Promise<boolean>;
  manifest(): LookManifest | null;
  /** Composited sheet for `look`, or null if the art is not loaded. Same canvas for the same look key. */
  sheet(look: Look): C | null;
  /**
   * Action sheet for `who` (a look, or { sprite } for a catalog character) doing `nameOrItem` (an
   * action such as "harvest", or a tool item id such as "pickaxe_iron"): 4 rows (up, left, down,
   * right) of the action's frames. Null until its images are loaded; the first call starts loading
   * them, so ask again next frame. Also null when there is no such action for `who`.
   */
  action(who: Actor, nameOrItem: string): { canvas: C; plan: ActionPlan } | null;
  /** Loads what `action` needs and resolves with it (null if there is no such action for `who`). */
  loadAction(who: Actor, nameOrItem: string): Promise<{ canvas: C; plan: ActionPlan } | null>;
}

const browserDeps: CompositorDeps<HTMLImageElement, HTMLCanvasElement> = {
  async fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  },
  loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load ${url}`));
      img.src = url;
    });
  },
  makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  },
};

export function createLookCompositor(): LookCompositor<HTMLCanvasElement>;
export function createLookCompositor<I, C extends SheetCanvas>(base: string, deps: CompositorDeps<I, C>): LookCompositor<C>;
export function createLookCompositor<I, C extends SheetCanvas>(
  base: string = LOOK_BASE,
  deps: CompositorDeps<I, C> = browserDeps as unknown as CompositorDeps<I, C>,
): LookCompositor<C> {
  let manifest: LookManifest | null = null;
  const images = new Map<string, I>();
  const sheets = new LruCache<C>(MAX_LOOK_SHEETS);
  const actionSheets = new LruCache<{ canvas: C; plan: ActionPlan }>(MAX_ACTION_SHEETS);
  /** Lazy action-sheet images: file -> its load; `settled` once it loaded or failed (failures are not retried). */
  const pending = new Map<string, Promise<void>>();
  const settled = new Set<string>();
  let loading: Promise<boolean> | null = null;

  function loadFiles(files: string[]): Promise<void> {
    return Promise.all(
      files.map((f) => {
        if (images.has(f)) return Promise.resolve();
        let p = pending.get(f);
        if (!p) {
          p = deps
            .loadImage(base + f)
            .then(
              (img) => void images.set(f, img),
              () => console.warn(`[look] ${f} failed to load`),
            )
            .finally(() => settled.add(f));
          pending.set(f, p);
        }
        return p;
      }),
    ).then(() => undefined);
  }

  function composeAction(plan: ActionPlan): C | null {
    const canvas = deps.makeCanvas(plan.width, plan.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, plan.width, plan.height);
    for (const d of plan.draws) {
      const img = images.get(d.file);
      if (img) ctx.drawImage(img as unknown as CanvasImageSource, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.sw, d.sh);
    }
    return canvas;
  }

  function action(who: Actor, name: string): { canvas: C; plan: ActionPlan } | null {
    if (!manifest) return null;
    const key = `${actorKey(who)}#${name}`;
    const hit = actionSheets.get(key);
    if (hit) return hit;
    const plan = actionPlan(manifest, who, name);
    if (!plan) return null;
    if (!plan.files.every((f) => images.has(f) || settled.has(f))) {
      void loadFiles(plan.files);
      return null;
    }
    const canvas = composeAction(plan);
    if (!canvas) return null;
    const made = { canvas, plan };
    actionSheets.set(key, made);
    return made;
  }

  async function doLoad(): Promise<boolean> {
    try {
      manifest = parseLookManifest(await deps.fetchJson(`${base}custom.json`));
      if (!manifest) throw new Error("custom.json is malformed");
      const bad = unknownOptionIds(manifest);
      if (bad.length) console.warn("[look] options the server won't accept:", bad.join(", "));
      const files = allLayerFiles(manifest);
      const loaded = await Promise.allSettled(files.map((f) => deps.loadImage(base + f)));
      loaded.forEach((r, i) => {
        if (r.status === "fulfilled") images.set(files[i]!, r.value);
        else console.warn(`[look] ${files[i]} failed to load`);
      });
      return images.size > 0;
    } catch (err) {
      console.warn("[look] character layers unavailable, using catalog sprites", err);
      manifest = null;
      return false;
    }
  }

  function compose(m: LookManifest, look: Look): C | null {
    const canvas = deps.makeCanvas(m.sheetW, m.sheetH);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, m.sheetW, m.sheetH);
    for (const file of layerFiles(m, look)) {
      const img = images.get(file);
      if (img) ctx.drawImage(img as unknown as CanvasImageSource, 0, 0);
    }
    return canvas;
  }

  return {
    load() {
      loading ??= doLoad();
      return loading;
    },
    manifest: () => manifest,
    action,
    async loadAction(who, name) {
      if (!(await (loading ??= doLoad())) || !manifest) return null;
      const plan = actionPlan(manifest, who, name);
      if (!plan) return null;
      await loadFiles(plan.files);
      return action(who, name);
    },
    sheet(look) {
      if (!manifest || images.size === 0) return null;
      const key = lookKey(look);
      const hit = sheets.get(key);
      if (hit) return hit;
      const made = compose(manifest, look);
      // Evicted canvases are just dropped: a sprite still showing one keeps working, and it is GC'd after.
      if (made) sheets.set(key, made);
      return made;
    },
  };
}
