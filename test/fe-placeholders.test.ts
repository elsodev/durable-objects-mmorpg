import { describe, expect, it } from "vitest";
import { drawCharacter, FACINGS } from "../src/client/art/draw/characters";
import { drawCrop, drawRock } from "../src/client/art/draw/farm";
import { drawFurniture, rotatedFootprint } from "../src/client/art/draw/furniture";
import { PixelGrid } from "../src/client/art/draw/grid";
import { drawGround } from "../src/client/art/draw/ground";
import { drawIcon, iconCoverage } from "../src/client/art/draw/icons";
import { drawProp } from "../src/client/art/draw/props";
import { hashStr, rng } from "../src/client/art/palette";
import { ITEMS } from "../src/shared/items";
import { PROP_FOOTPRINTS } from "../src/shared/maps/props";
import { Ground } from "../src/shared/types";

function opaqueCount(g: PixelGrid): number {
  let n = 0;
  for (const a of g.alpha) if (a) n++;
  return n;
}

function fingerprint(g: PixelGrid): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < g.color.length; i++) {
    h = Math.imul(h ^ (g.alpha[i] ? g.color[i] : 0xff000000), 0x01000193);
  }
  return `${g.w}x${g.h}:${h >>> 0}`;
}

const NPCS = [
  "villager_old",
  "villager_woman",
  "smith",
  "villager_woman2",
  "kid",
  "fisher",
  "monk",
  "villager_woman3",
  "miner",
  "explorer",
];
const PLAYERS = ["player_1", "player_2", "player_3", "player_4"];

describe("pixel grid", () => {
  it("runs() reconstructs the grid exactly", () => {
    const g = new PixelGrid(20, 12);
    g.ellipse(10, 6, 8, 5, 0x336699);
    g.rect(2, 2, 4, 4, 0xff0000, 128);
    g.outline("self");
    const back = new PixelGrid(20, 12);
    for (const r of g.runs()) back.rect(r.x, r.y, r.w, r.h, r.color, Math.round(r.alpha * 255));
    expect(fingerprint(back)).toBe(fingerprint(g));
    expect(g.runs().length).toBeLessThan(opaqueCount(g));
  });

  it("outline only adds pixels around the silhouette", () => {
    const g = new PixelGrid(5, 5);
    g.px(2, 2, 0xffffff);
    g.outline(0x000000);
    expect(opaqueCount(g)).toBe(5);
    expect(g.get(2, 1)).toBe(0x000000);
  });

  it("hash and rng are deterministic", () => {
    expect(hashStr("slime")).toBe(hashStr("slime"));
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("ground", () => {
  const kinds = [Ground.Void, Ground.Grass, Ground.Dirt, Ground.Sand, Ground.Water, Ground.Stone, Ground.Wood, Ground.Tilled, Ground.CaveWall, Ground.Wall];
  it("every kind has 4 opaque, distinct, deterministic 32x32 variants", () => {
    for (const k of kinds) {
      const prints = new Set<string>();
      for (let v = 0; v < 4; v++) {
        const g = drawGround(k, v);
        expect([g.w, g.h]).toEqual([32, 32]);
        expect(opaqueCount(g)).toBe(32 * 32);
        expect(fingerprint(drawGround(k, v))).toBe(fingerprint(g));
        prints.add(fingerprint(g));
      }
      expect(prints.size, `kind ${k}`).toBe(4);
    }
  });

  it("watered tilled soil is darker than dry soil", () => {
    const lum = (g: PixelGrid) => {
      let s = 0;
      for (const c of g.color) s += ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
      return s;
    };
    expect(lum(drawGround(Ground.Tilled, 4))).toBeLessThan(lum(drawGround(Ground.Tilled, 0)));
  });
});

describe("props", () => {
  it("every PROP_FOOTPRINTS type covers at least its footprint and draws something", () => {
    for (const [type, fp] of Object.entries(PROP_FOOTPRINTS)) {
      const { grid, anchor } = drawProp(type);
      expect(grid.w, type).toBeGreaterThanOrEqual(fp.w * 32);
      expect(grid.h, type).toBeGreaterThanOrEqual(fp.h * 32);
      expect(opaqueCount(grid), type).toBeGreaterThan(40);
      expect(anchor).toEqual({ x: 0.5, y: 1 });
    }
  });

  it("buildings and trees are drawn taller than their footprint", () => {
    for (const type of ["tree", "house_small", "house_large", "town_hall", "inn", "blacksmith", "well", "lantern_post"] as const) {
      expect(drawProp(type).grid.h, type).toBeGreaterThan(PROP_FOOTPRINTS[type].h * 32);
    }
  });

  it("unknown prop types still render", () => {
    expect(opaqueCount(drawProp("mystery_thing").grid)).toBeGreaterThan(0);
  });
});

describe("characters", () => {
  it("players, NPCs and monsters have 4 facings x 4 walk frames of 64x64 that animate", () => {
    for (const key of [...PLAYERS, ...NPCS, "slime", "bat", "rock_crab", "someone_else"]) {
      const c = drawCharacter(key);
      for (const f of FACINGS) {
        expect(c.walk[f].length).toBe(4);
        const prints = new Set(c.walk[f].map(fingerprint));
        expect(prints.size, `${key} ${f}`).toBeGreaterThan(1);
        for (const fr of [...c.walk[f], c.idle[f]]) {
          expect([fr.w, fr.h]).toEqual([64, 64]);
          expect(opaqueCount(fr)).toBeGreaterThan(80);
        }
      }
      expect(c.feet).toEqual({ x: 32, y: 60 });
    }
  });

  it("every NPC and player looks different", () => {
    const prints = [...PLAYERS, ...NPCS].map((k) => fingerprint(drawCharacter(k).idle.down));
    expect(new Set(prints).size).toBe(prints.length);
  });

  it("humanoid left frames mirror right frames", () => {
    const c = drawCharacter("player_2");
    const r = c.walk.right[0];
    const l = c.walk.left[0];
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) expect(l.get(63 - x, y)).toBe(r.get(x, y));
    }
  });

  it("feet rest on the anchor row", () => {
    const g = drawCharacter("player_1").idle.down;
    let lowest = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (g.opaque(x, y)) lowest = y;
    expect(lowest).toBeGreaterThanOrEqual(58);
    expect(lowest).toBeLessThanOrEqual(61);
  });
});

describe("farm, furniture, icons", () => {
  it("crops have 4 distinct stages", () => {
    for (const crop of ["turnip", "carrot", "strawberry", "pumpkin"]) {
      const prints = new Set([0, 1, 2, 3].map((s) => fingerprint(drawCrop(crop, s as 0 | 1 | 2 | 3))));
      expect(prints.size, crop).toBe(4);
    }
  });

  it("rocks differ per ore", () => {
    const prints = new Set((["stone", "copper", "iron", "gem"] as const).map((o) => fingerprint(drawRock(o))));
    expect(prints.size).toBe(4);
  });

  it("furniture matches its rotated footprint width", () => {
    for (const item of Object.values(ITEMS).filter((d) => d.kind === "furniture")) {
      for (const r of [0, 1, 2, 3] as const) {
        const fp = rotatedFootprint(item.id, r);
        const g = drawFurniture(item.id, r);
        expect(g.w, `${item.id} r${r}`).toBe(fp.w * 32);
        expect(g.h, `${item.id} r${r}`).toBeGreaterThanOrEqual(fp.h * 32);
        expect(opaqueCount(g)).toBeGreaterThan(40);
      }
    }
    expect(rotatedFootprint("table_wood", 1)).toEqual({ w: 1, h: 2 });
  });

  it("every item id has a hand-drawn 32x32 icon", () => {
    for (const { item, custom } of iconCoverage()) {
      expect(custom, item).toBe(true);
      const g = drawIcon(item);
      expect([g.w, g.h]).toEqual([32, 32]);
      expect(opaqueCount(g), item).toBeGreaterThan(30);
    }
    const prints = Object.keys(ITEMS).map((i) => fingerprint(drawIcon(i)));
    expect(new Set(prints).size).toBe(prints.length);
  });
});
