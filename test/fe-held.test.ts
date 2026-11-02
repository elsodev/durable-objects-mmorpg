// Client side of held tools: the art manifest, the compositor's lazy held sheets and the renderer rules.
import { describe, expect, it, vi } from "vitest";
import { heldFiles, parseLookManifest } from "../src/client/art/look-logic";
import { heldFrameIndex, heldToShow } from "../src/client/render/held-logic";
import { createLookCompositor, type SheetCanvas } from "../src/client/art/compositor";
import type { EntityState, Look } from "../src/shared/types";
import { DEFAULT_LOOK } from "../src/shared/look";

interface NodeFs {
  readFileSync(path: string, enc: "utf8"): string;
  existsSync(path: string): boolean;
}
const nodeFs = async () => (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as NodeFs;
async function customJson(): Promise<unknown> {
  return JSON.parse((await nodeFs()).readFileSync("src/client/public/assets/lpc/custom/custom.json", "utf8"));
}

const player = (over: Partial<EntityState> = {}): EntityState => ({
  id: "p:a",
  kind: "player",
  name: "A",
  sprite: "player_1",
  x: 1,
  y: 1,
  facing: "down",
  moving: false,
  ...over,
});

describe("held art manifest", () => {
  const PICKED: Look = { ...DEFAULT_LOOK };

  it("has held layers for every tool, and the files exist", async () => {
    const fs = await nodeFs();
    const m = parseLookManifest(await customJson())!;
    for (const [item, tool] of Object.entries(m.tools)) {
      expect(tool.held, item).toBeDefined();
      for (const body of ["male", "male_slim", "female"]) {
        const f = heldFiles(m, { ...PICKED, body }, item)!;
        expect(f.bg || f.fg, `${item} ${body}`).toBeTruthy();
        for (const file of [f.bg, f.fg]) if (file) expect(fs.existsSync(`src/client/public/assets/lpc/custom/${file}`), file).toBe(true);
      }
    }
  });

  it("uses the slim build's own sheets where the art differs", async () => {
    const m = parseLookManifest(await customJson())!;
    expect(heldFiles(m, { ...PICKED, body: "male" }, "axe")).toEqual({ fg: "tools/axe.held.fg.png" });
    expect(heldFiles(m, { ...PICKED, body: "female" }, "axe")).toEqual({ fg: "tools/axe.held.thin.fg.png" });
    expect(heldFiles(m, { ...PICKED, body: "male_slim" }, "pickaxe_iron")).toEqual({ fg: "tools/pickaxe_iron.held.thin.fg.png" });
    // The hoe passes behind the body and in front of it, the same for every build.
    expect(heldFiles(m, { ...PICKED, body: "female" }, "hoe")).toEqual({ bg: "tools/hoe.held.bg.png", fg: "tools/hoe.held.fg.png" });
    expect(heldFiles(m, { sprite: "player_1" }, "hoe")).toEqual({ bg: "tools/hoe.held.bg.png", fg: "tools/hoe.held.fg.png" });
    expect(heldFiles(m, PICKED, "seed_turnip")).toBeNull();
    expect(heldFiles(m, PICKED, "constructor")).toBeNull();
  });

  it("ignores malformed held entries", () => {
    const base = {
      frameW: 64, frameH: 64, sheetW: 576, sheetH: 512,
      layout: { walk: { up: { row: 0, frames: 9 }, left: { row: 1, frames: 9 }, down: { row: 2, frames: 9 }, right: { row: 3, frames: 9 } } },
      order: ["body"], options: {}, files: { male: { skin: { light: "s.png" } } },
      anims: { thrust: { sheet: "act", row: 0, rows: 4, frames: 8 } },
      actions: { hoe: { frameSize: 64, frames: ["thrust,0"], ms: 70 } },
    };
    const m = parseLookManifest({ ...base, tools: { hoe: { action: "hoe", held: { bg: 3, bodies: "x" } }, axe: { action: "hoe", held: { fg: "a.png", bodies: { female: {} } } } } });
    expect(m?.tools.hoe!.held).toBeUndefined();
    expect(m?.tools.axe!.held).toEqual({ fg: "a.png" });
  });

  it("the compositor loads held sheets lazily onto walk-sized canvases", async () => {
    class FakeCanvas implements SheetCanvas {
      draws: string[] = [];
      constructor(public width: number, public height: number) {}
      getContext() {
        const self = this;
        return { imageSmoothingEnabled: true, clearRect() {}, drawImage(img: unknown) { self.draws.push(String(img)); } };
      }
    }
    const json = await customJson();
    const comp = createLookCompositor<string, FakeCanvas>("/c/", {
      fetchJson: async () => json,
      loadImage: async (u) => u,
      makeCanvas: (w, h) => new FakeCanvas(w, h),
    });
    await comp.load();
    expect(comp.held(PICKED, "hoe")).toBeNull(); // starts loading
    await vi.waitFor(() => expect(comp.held(PICKED, "hoe")).not.toBeNull());
    const h = comp.held(PICKED, "hoe")!;
    expect([h.bg!.width, h.bg!.height]).toEqual([9 * 64, 4 * 64]);
    expect(h.bg!.draws).toEqual(["/c/tools/hoe.held.bg.png"]);
    expect(h.fg!.draws).toEqual(["/c/tools/hoe.held.fg.png"]);
    expect(comp.held(PICKED, "seed_turnip")).toBeNull();
  });
});

describe("held layer on the renderer", () => {
  const idle = { acting: false, seated: false, dying: false };

  it("draws the held tool on players standing or walking", () => {
    expect(heldToShow(player({ held: "hoe" }), idle)).toBe("hoe");
    expect(heldToShow(player({ held: "hoe", moving: true }), idle)).toBe("hoe");
    expect(heldToShow(player(), idle)).toBeNull();
  });

  it("hides it while an action, sitting or dying owns the body", () => {
    const s = player({ held: "axe" });
    expect(heldToShow(s, { ...idle, acting: true })).toBeNull(); // the swing draws its own tool
    expect(heldToShow(s, { ...idle, seated: true })).toBeNull();
    expect(heldToShow(s, { ...idle, dying: true })).toBeNull();
  });

  it("never draws on NPCs or monsters", () => {
    expect(heldToShow(player({ kind: "npc", held: "hoe" }), idle)).toBeNull();
    expect(heldToShow(player({ kind: "monster", held: "hoe" }), idle)).toBeNull();
  });

  it("rides the body's walk frame, standing on frame 0", () => {
    expect(heldFrameIndex(0, 9)).toBe(0);
    expect(heldFrameIndex(5, 9)).toBe(5);
    expect(heldFrameIndex(8, 9)).toBe(8);
    expect(heldFrameIndex(9, 9)).toBe(0); // a body with more frames than the sheet
    expect(heldFrameIndex(3, 0)).toBe(-1);
  });
});
