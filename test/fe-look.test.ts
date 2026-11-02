import { describe, expect, it } from "vitest";
import { createLookCompositor, MAX_LOOK_SHEETS, type SheetCanvas } from "../src/client/art/compositor";
import { actionPlan, allLayerFiles, layerFiles, LruCache, parseLookManifest, resolveAction, rowFrames, unknownOptionIds } from "../src/client/art/look-logic";
import { previewFrame, turnFacing, withOption, CREATOR_TABS } from "../src/client/ui/creator-logic";
import { DEFAULT_LOOK, LOOK_OPTIONS, LOOK_PARTS } from "../src/shared/look";
import type { Look } from "../src/shared/types";

interface NodeFs {
  readFileSync(path: string, enc: "utf8"): string;
}
async function customJson(): Promise<unknown> {
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as NodeFs;
  return JSON.parse(fs.readFileSync("src/client/public/assets/lpc/custom/custom.json", "utf8"));
}

const PICKED: Look = {
  body: "male",
  skin: "brown",
  eyes: "blue",
  hairStyle: "long",
  hairColor: "black",
  top: "red_tshirt",
  bottom: "tan_shorts",
  shoes: "black_shoes",
};

describe("look manifest", () => {
  it("parses custom.json with walk/slash rows and every option", async () => {
    const m = parseLookManifest(await customJson())!;
    expect(m).not.toBeNull();
    expect([m.frameW, m.frameH, m.sheetW, m.sheetH]).toEqual([64, 64, 576, 512]);
    expect(m.walk.down).toEqual({ row: 2, frames: 9 });
    expect(m.slash?.right).toEqual({ row: 7, frames: 6 });
    expect(m.anchor).toEqual([32, 60]);
    expect(unknownOptionIds(m)).toEqual([]);
    expect(Object.keys(m.files)).toEqual([...LOOK_OPTIONS.body]);
    for (const body of LOOK_OPTIONS.body) {
      const f = m.files[body]!;
      expect([f.skin, f.eyes, f.hair, f.top, f.bottom, f.shoes].map((x) => Object.keys(x).length), body).toEqual([5, 5, 25, 5, 5, 3]);
    }
    // Pixel-identical layers (all hair and eyes, the slim legs and feet, ...) are stored once in shared/.
    const all = allLayerFiles(m);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(5 + 5 + 25 + 5 + 5 + 3);
    expect(all.length).toBeLessThan(3 * (5 + 5 + 25 + 5 + 5 + 3));
  });

  it("rejects malformed manifests", () => {
    expect(parseLookManifest(null)).toBeNull();
    expect(parseLookManifest({ frameW: 64 })).toBeNull();
    expect(parseLookManifest({ frameW: 0, frameH: 64, sheetW: 1, sheetH: 1, layout: {}, options: {}, order: ["body"] })).toBeNull();
  });

  it("rejects a manifest without per-body files (the pre-body-type format)", async () => {
    const { files: _f, ...old } = (await customJson()) as Record<string, unknown>;
    expect(parseLookManifest(old)).toBeNull();
    expect(parseLookManifest({ ...old, files: {} })).toBeNull();
  });

  it("orders layer files by the manifest order, with hair looked up by style:colour", async () => {
    const m = parseLookManifest(await customJson())!;
    expect(layerFiles(m, PICKED)).toEqual([
      "male/body/skin_brown.png",
      "shared/eyes/eyes_blue.png",
      "male/shoes/black_shoes.png",
      "male/bottom/tan_shorts.png",
      "male/top/red_tshirt.png",
      "shared/hair/long_black.png",
    ]);
  });

  it("takes the layers of the look's body type, sharing identical ones", async () => {
    const m = parseLookManifest(await customJson())!;
    expect(layerFiles(m, { ...PICKED, body: "female" })).toEqual([
      "female/body/skin_brown.png",
      "shared/eyes/eyes_blue.png",
      "shared/shoes/black_shoes.png",
      "shared/bottom/tan_shorts.png",
      "female/top/red_tshirt.png",
      "shared/hair/long_black.png",
    ]);
    const slim = layerFiles(m, { ...PICKED, body: "male_slim" });
    expect(slim).toEqual([
      "male_slim/body/skin_brown.png",
      "shared/eyes/eyes_blue.png",
      "shared/shoes/black_shoes.png",
      "shared/bottom/tan_shorts.png",
      "male_slim/top/red_tshirt.png",
      "shared/hair/long_black.png",
    ]);
    expect(layerFiles(m, { ...PICKED, body: "constructor" })).toEqual([]);
    expect(layerFiles(m, { ...PICKED, body: "giant" })).toEqual([]);
  });

  it("skips layers whose id is unknown instead of throwing", async () => {
    const m = parseLookManifest(await customJson())!;
    const files = layerFiles(m, { ...PICKED, top: "nope", hairStyle: "__proto__" });
    expect(files).not.toContain("male/top/red_tshirt.png");
    expect(files.some((f) => f.includes("/hair/"))).toBe(false);
    expect(files).toHaveLength(4);
  });

  it("slices animation rows into frame rects", async () => {
    const m = parseLookManifest(await customJson())!;
    const r = rowFrames(m, m.walk.left);
    expect(r).toHaveLength(9);
    expect(r[0]).toEqual([0, 64, 64, 64]);
    expect(r[8]).toEqual([512, 64, 64, 64]);
  });
});

describe("look actions", () => {
  const TOOL_ITEMS = ["hoe", "watering_can", "pickaxe", "pickaxe_iron", "sword_wood", "sword_copper", "axe", "fishing_rod"];

  it("lists the actions and maps every farming/combat tool item to one", async () => {
    const m = parseLookManifest(await customJson())!;
    expect(Object.keys(m.actions).sort()).toEqual(["eat", "faint", "fishing", "harvest", "hoe", "hold_up", "hurt", "meditate", "sit", "sit_ground", "smash", "sword", "think", "watering", "wave"]);
    expect(Object.keys(m.tools).sort()).toEqual([...TOOL_ITEMS].sort());
    expect(m.tools.hoe!.action).toBe("hoe");
    expect(m.tools.watering_can!.action).toBe("watering");
    expect(m.tools.pickaxe_iron!.action).toBe("smash");
    expect(m.tools.sword_wood!.action).toBe("sword");
    expect(resolveAction(m, "pickaxe")).toEqual(["smash", "pickaxe"]);
    expect(resolveAction(m, "harvest")).toEqual(["harvest", null]);
    expect(resolveAction(m, "toString")).toBeNull();
    expect(resolveAction(m, "dance")).toBeNull();
  });

  it("has an action sheet for every body x option (same keys as the walk sheets)", async () => {
    const m = parseLookManifest(await customJson())!;
    for (const body of LOOK_OPTIONS.body)
      for (const part of ["skin", "eyes", "hair", "top", "bottom", "shoes"] as const)
        expect(Object.keys(m.actionFiles[body]![part]).sort(), `${body} ${part}`).toEqual(Object.keys(m.files[body]![part]).sort());
  });

  it("plans tool bg, then layers frame by frame centred in the action cell, then tool fg", async () => {
    const m = parseLookManifest(await customJson())!;
    const p = actionPlan(m, PICKED, "pickaxe_iron")!;
    expect(p.action).toBe("smash");
    expect([p.spec.frameSize, p.spec.frames.length, p.width, p.height]).toEqual([128, 10, 1280, 512]);
    expect(p.draws[0]!.file).toBe("tools/pickaxe_iron.bg.png");
    expect(p.draws.at(-1)!.file).toBe("tools/pickaxe_iron.fg.png");
    // smash uses slash frames from the walk/slash sheet: first frame, facing up, slash column 5, centred (+32)
    expect(p.draws[1]).toEqual({ file: "male/body/skin_brown.png", sx: 5 * 64, sy: 4 * 64, sw: 64, sh: 64, dx: 32, dy: 32 });
    expect(p.draws.length).toBe(2 + 6 * 4 * 10);
    const water = actionPlan(m, PICKED, "watering_can")!;
    expect(water.draws[1]).toMatchObject({ file: "male/body/skin_brown.act.png", sx: 0, sy: 0, dx: 0, dy: 0 });
    const sit = actionPlan(m, { ...PICKED, body: "male_slim" }, "sit")!;
    expect(sit.files.every((f) => f.endsWith(".act.png"))).toBe(true);
    expect(sit.draws.length).toBe(6 * 4);
    const hurt = actionPlan(m, PICKED, "hurt")!;
    // hurt has one generator row (row 8 of the action sheet) used for every facing
    expect(new Set(hurt.draws.map((d) => d.sy))).toEqual(new Set([8 * 64]));
    expect(hurt.files.every((f) => f.endsWith(".act.png"))).toBe(true);
    const harvest = actionPlan(m, { ...PICKED, body: "female" }, "harvest")!;
    expect(harvest.files.some((f) => f.endsWith(".act.png")) && harvest.files.some((f) => !f.endsWith(".act.png"))).toBe(true);
    expect(actionPlan(m, PICKED, "dance")).toBeNull();
  });

  it("plans catalog characters from their whole-figure sheets, skipping actions they lack", async () => {
    const m = parseLookManifest(await customJson())!;
    expect(Object.keys(m.characters)).toHaveLength(14);
    const p = actionPlan(m, { sprite: "miner" }, "pickaxe")!;
    expect(p.files).toEqual(["tools/pickaxe.bg.png", "../characters/miner.png", "tools/pickaxe.fg.png"]);
    expect(actionPlan(m, { sprite: "fisher" }, "fishing_rod")!.files).toContain("../characters/fisher.act.png");
    expect(m.characters.monk!.missing).toContain("hoe");
    expect(actionPlan(m, { sprite: "monk" }, "hoe")).toBeNull();
    expect(actionPlan(m, { sprite: "monk" }, "sword_wood")).not.toBeNull();
    expect(actionPlan(m, { sprite: "player_1" }, "harvest")).not.toBeNull();
    // every catalog character can sit (chair pose = generator sit frame 2, from the action sheet's sit rows)
    for (const sprite of Object.keys(m.characters)) {
      const sit = actionPlan(m, { sprite }, "sit")!;
      expect(sit.files, sprite).toEqual([`../characters/${sprite}.act.png`]);
      expect(sit.spec.hold).toBe(true);
      expect(sit.draws.map((d) => d.sy)).toEqual([4, 5, 6, 7].map((r) => r * 64));
    }
    expect(actionPlan(m, { sprite: "slime" }, "hurt")).toBeNull();
    expect(actionPlan(m, { sprite: "constructor" }, "hurt")).toBeNull();
  });

  it("every file an action plan names exists", async () => {
    const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { existsSync(p: string): boolean };
    const m = parseLookManifest(await customJson())!;
    const seen = new Set<string>();
    for (const body of LOOK_OPTIONS.body)
      for (const name of [...Object.keys(m.actions), ...TOOL_ITEMS]) for (const f of actionPlan(m, { ...PICKED, body }, name)!.files) seen.add(f);
    for (const sprite of Object.keys(m.characters))
      for (const name of Object.keys(m.actions)) for (const f of actionPlan(m, { sprite }, name)?.files ?? []) seen.add(f);
    for (const f of seen) expect(fs.existsSync("src/client/public/assets/lpc/custom/" + f), f).toBe(true);
    expect([...seen].some((f) => f.startsWith("../characters/") && f.endsWith(".act.png"))).toBe(true);
  });
});

describe("LruCache", () => {
  it("evicts the least recently used entry past the cap", () => {
    const c = new LruCache<number>(2);
    expect(c.set("a", 1)).toEqual([]);
    c.set("b", 2);
    c.get("a"); // a is now newest
    expect(c.set("c", 3)).toEqual([2]);
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(false);
    expect(c.size).toBe(2);
  });

  it("replacing a key does not grow the cache", () => {
    const c = new LruCache<number>(2);
    c.set("a", 1);
    c.set("a", 2);
    expect(c.size).toBe(1);
    expect(c.get("a")).toBe(2);
  });
});

/** Fake canvas that records draw calls (vitest runs in node, without a DOM canvas). */
class FakeCanvas implements SheetCanvas {
  draws: string[] = [];
  constructor(public width: number, public height: number) {}
  getContext() {
    const draws = this.draws;
    return {
      imageSmoothingEnabled: true,
      clearRect() {},
      drawImage(img: unknown) {
        draws.push(String(img));
      },
    } as unknown as ReturnType<SheetCanvas["getContext"]>;
  }
}

async function fakeCompositor(failing: string[] = []) {
  const json = await customJson();
  let made = 0;
  const comp = createLookCompositor<string, FakeCanvas>("/c/", {
    fetchJson: async () => json,
    loadImage: async (url) => {
      if (failing.some((f) => url.endsWith(f))) throw new Error("404");
      return url;
    },
    makeCanvas: (w, h) => {
      made++;
      return new FakeCanvas(w, h);
    },
  });
  return { comp, made: () => made };
}

describe("look compositor", () => {
  it("returns null before load, then composes layers bottom-up onto a sheet-sized canvas", async () => {
    const { comp } = await fakeCompositor();
    expect(comp.sheet(PICKED)).toBeNull();
    expect(await comp.load()).toBe(true);
    const c = comp.sheet(PICKED)!;
    expect([c.width, c.height]).toEqual([576, 512]);
    expect(c.draws).toEqual([
      "/c/male/body/skin_brown.png",
      "/c/shared/eyes/eyes_blue.png",
      "/c/male/shoes/black_shoes.png",
      "/c/male/bottom/tan_shorts.png",
      "/c/male/top/red_tshirt.png",
      "/c/shared/hair/long_black.png",
    ]);
    const f = comp.sheet({ ...PICKED, body: "female" })!;
    expect(f).not.toBe(c);
    expect(f.draws[0]).toBe("/c/female/body/skin_brown.png");
  });

  it("caches by look key, not object identity", async () => {
    const { comp, made } = await fakeCompositor();
    await comp.load();
    const a = comp.sheet(PICKED);
    expect(comp.sheet({ ...PICKED })).toBe(a);
    expect(made()).toBe(1);
    expect(comp.sheet({ ...PICKED, eyes: "gray" })).not.toBe(a);
    expect(made()).toBe(2);
  });

  it(`keeps at most ${MAX_LOOK_SHEETS} sheets`, async () => {
    const { comp, made } = await fakeCompositor();
    await comp.load();
    const looks: Look[] = [];
    for (const skin of LOOK_OPTIONS.skin) for (const top of LOOK_OPTIONS.top) for (const bottom of LOOK_OPTIONS.bottom.slice(0, 2)) looks.push({ ...DEFAULT_LOOK, skin, top, bottom });
    expect(looks.length).toBeGreaterThan(MAX_LOOK_SHEETS);
    for (const l of looks) comp.sheet(l);
    expect(made()).toBe(looks.length);
    comp.sheet(looks[looks.length - 1]!); // most recent: cached
    expect(made()).toBe(looks.length);
    comp.sheet(looks[0]!); // evicted long ago: rebuilt
    expect(made()).toBe(looks.length + 1);
  });

  it("survives missing layer images and a missing manifest", async () => {
    const { comp } = await fakeCompositor(["/c/male/top/red_tshirt.png"]);
    expect(await comp.load()).toBe(true);
    expect(comp.sheet(PICKED)!.draws).not.toContain("/c/male/top/red_tshirt.png");

    const broken = createLookCompositor<string, FakeCanvas>("/c/", {
      fetchJson: async () => {
        throw new Error("offline");
      },
      loadImage: async (u) => u,
      makeCanvas: (w, h) => new FakeCanvas(w, h),
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(await broken.load()).toBe(false);
    } finally {
      console.warn = warn;
    }
    expect(broken.sheet(PICKED)).toBeNull();
    expect(broken.manifest()).toBeNull();
  });
});

describe("look compositor actions", () => {
  it("loads action images lazily, then builds and caches the action sheet", async () => {
    const json = await customJson();
    const loaded: string[] = [];
    const comp = createLookCompositor<string, FakeCanvas>("/c/", {
      fetchJson: async () => json,
      loadImage: async (url) => {
        loaded.push(url);
        return url;
      },
      makeCanvas: (w, h) => new FakeCanvas(w, h),
    });
    await comp.load();
    expect(loaded.some((u) => u.includes(".act.") || u.includes("/tools/"))).toBe(false);
    expect(comp.action(PICKED, "hoe")).toBeNull(); // starts loading
    const a = (await comp.loadAction(PICKED, "hoe"))!;
    expect([a.canvas.width, a.canvas.height]).toEqual([8 * 64, 4 * 64]);
    expect(a.canvas.draws[0]).toBe("/c/tools/hoe.bg.png");
    expect(a.canvas.draws.at(-1)).toBe("/c/tools/hoe.fg.png");
    expect(comp.action(PICKED, "hoe")).toBe(a);
    expect(loaded.filter((u) => u.endsWith("tools/hoe.bg.png"))).toHaveLength(1);
    expect(await comp.loadAction(PICKED, "dance")).toBeNull();
  });
});

describe("creator logic", () => {
  it("has one tab per look part, Body first", () => {
    expect(CREATOR_TABS.map((t) => t.part)).toEqual([...LOOK_PARTS]);
    expect(CREATOR_TABS[0]).toEqual({ part: "body", label: "Body" });
    // Pills stay on one row: every pill text is short.
    for (const t of CREATOR_TABS) expect((t.short ?? t.label).length, t.label).toBeLessThanOrEqual(6);
  });

  it("turns through all four facings and back", () => {
    let f = "down" as const as "down" | "left" | "up" | "right";
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      f = turnFacing(f, 1);
      seen.push(f);
    }
    expect(seen).toEqual(["left", "up", "right", "down"]);
    expect(turnFacing("down", -1)).toBe("right");
  });

  it("loops the walk preview over frames 1..n-1", () => {
    expect(previewFrame(0, 9)).toBe(1);
    expect(previewFrame(100, 9)).toBe(2);
    expect(previewFrame(700, 9)).toBe(8);
    expect(previewFrame(800, 9)).toBe(1);
    expect(previewFrame(500, 1)).toBe(0);
    expect(previewFrame(-50, 9)).toBe(1);
  });

  it("withOption changes one part and ignores unknown ids", () => {
    const l = withOption(DEFAULT_LOOK, "hairColor", "blonde");
    expect(l).toEqual({ ...DEFAULT_LOOK, hairColor: "blonde" });
    expect(withOption(l, "hairColor", "purple")).toBe(l);
    expect(withOption(l, "body", "male_slim")).toEqual({ ...l, body: "male_slim" });
    expect(withOption(l, "body", "giant")).toBe(l);
  });
});
