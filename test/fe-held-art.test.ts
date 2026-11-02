// Held tool art checked against the rest of the tool's art: the hand it sits in, and its colours
// matching the swing sheets and the inventory icon, so the three views read as one object.
import { describe, expect, it } from "vitest";
import { readPng, type Png } from "./png";

const proc = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process;
const fs = proc.getBuiltinModule("node:fs") as { readFileSync(p: string, enc: "utf8"): string };

const LPC = "src/client/public/assets/lpc/";
const CUSTOM = `${LPC}custom/`;
const F = 64;
const ROW = { up: 0, left: 1, down: 2, right: 3 } as const;

interface HeldEntry {
  bg?: string;
  fg?: string;
  bodies?: Record<string, { bg?: string; fg?: string }>;
}
interface ToolEntry {
  bg: string;
  fg: string;
  held: HeldEntry;
}
const custom = JSON.parse(fs.readFileSync(`${CUSTOM}custom.json`, "utf8")) as { tools: Record<string, ToolEntry> };
const catalog = JSON.parse(fs.readFileSync(`${LPC}catalog.json`, "utf8")) as {
  icons: Record<string, { file: string; rect: [number, number, number, number] }>;
};

const pngs = new Map<string, Png>();
const png = (path: string): Png => {
  let p = pngs.get(path);
  if (!p) pngs.set(path, (p = readPng(path)));
  return p;
};

/** The bg/fg sheets each body type draws for `item` (the slim builds may swap in their own). */
function heldSets(item: string): { body: string; files: string[] }[] {
  const h = custom.tools[item]!.held;
  return ["male", "male_slim", "female"].map((body) => {
    const o = h.bodies?.[body] ?? {};
    const files = [o.bg ?? h.bg, o.fg ?? h.fg].filter((f): f is string => !!f);
    return { body, files: files.map((f) => CUSTOM + f) };
  });
}

/** Mean x of the opaque pixels of one cell over all layers, relative to the cell's centre line. */
function centroidX(files: string[], row: number, col: number): number | null {
  let sum = 0;
  let n = 0;
  for (const f of files) {
    const p = png(f);
    for (let y = 0; y < F; y++)
      for (let x = 0; x < F; x++)
        if (p.alpha(col * F + x, row * F + y) >= 128) {
          sum += x;
          n++;
        }
  }
  return n ? sum / n - (F - 1) / 2 : null;
}

type Rgb = [number, number, number];
const luma = ([r, g, b]: Rgb) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Opaque colours of a region, minus the near-black outline every LPC sprite shares. */
function colours(path: string, rect?: [number, number, number, number]): Rgb[] {
  const p = png(path);
  const [x0, y0, w, h] = rect ?? [0, 0, p.w, p.h];
  const out: Rgb[] = [];
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const [r, g, b, a] = p.rgba(x, y);
      if (a >= 128 && luma([r, g, b]) >= 40) out.push([r, g, b]);
    }
  return out;
}

/** Share of `pixels` within `tol` (RGB distance) of some colour in `palette`. */
function closeShare(pixels: Rgb[], palette: Rgb[], tol = 40): number {
  const pal = [...new Map(palette.map((c) => [c.join(","), c])).values()];
  const memo = new Map<string, boolean>();
  let hit = 0;
  for (const c of pixels) {
    const k = c.join(",");
    let ok = memo.get(k);
    if (ok === undefined) {
      ok = pal.some((q) => Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]) <= tol);
      memo.set(k, ok);
    }
    if (ok) hit++;
  }
  return pixels.length ? hit / pixels.length : 0;
}

const tools = Object.keys(custom.tools);

describe("held tool art", () => {
  it.each(tools)("%s: facing up, it is in the right hand (the viewer's right, seen from behind)", (item) => {
    for (const { body, files } of heldSets(item)) {
      for (let col = 0; col < 9; col++) {
        const cx = centroidX(files, ROW.up, col);
        expect(cx, `${item} ${body} up frame ${col} has no pixels`).not.toBeNull();
        expect(cx!, `${item} ${body} up frame ${col}`).toBeGreaterThan(2);
      }
    }
  });

  it.each(tools)("%s: the sideways rows are mirror images, tool out in front", (item) => {
    for (const { body, files } of heldSets(item)) {
      const left = centroidX(files, ROW.left, 0)!;
      const right = centroidX(files, ROW.right, 0)!;
      expect(Math.abs(left + right), `${item} ${body}`).toBeLessThan(2);
    }
  });

  it.each(tools)("%s: held colours all come from the swing sheets", (item) => {
    const t = custom.tools[item]!;
    const swing = new Set([...colours(CUSTOM + t.bg), ...colours(CUSTOM + t.fg)].map((c) => c.join(",")));
    for (const { files } of heldSets(item))
      for (const f of files) {
        const stray = [...new Set(colours(f).map((c) => c.join(",")))].filter((c) => !swing.has(c));
        expect(stray, f).toEqual([]);
      }
  });

  it.each(tools.filter((t) => catalog.icons[t]))("%s: the inventory icon has the held tool's colours, both ways", (item) => {
    const icon = catalog.icons[item]!;
    const ic = colours(LPC + icon.file, icon.rect);
    const held = heldSets(item)[0]!.files.flatMap((f) => colours(f));
    // Before this check the pickaxe was gold in the hand and grey in the bag (about 0.3 both ways).
    expect(closeShare(held, ic), `${item}: held pixels near an icon colour`).toBeGreaterThanOrEqual(0.85);
    expect(closeShare(ic, held), `${item}: icon pixels near a held colour`).toBeGreaterThanOrEqual(0.85);
  });
});
