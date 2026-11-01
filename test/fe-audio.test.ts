import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  Throttle,
  assetUrl,
  COMBAT_SFX_KEYS,
  MONSTER_SFX_EVENTS,
  MONSTER_SFX_KINDS,
  clamp01,
  footstepKey,
  monsterSfxKey,
  musicKeyForZone,
  parseSettings,
  pickVariant,
  pitchFor,
  resolveSfxKey,
} from "../src/client/audio/audio-logic";

const sfx = {
  ui_click: {}, ui_hover: {}, ui_slot: {}, ui_open: {}, ui_close: {}, ui_tab: {}, ui_confirm: {}, ui_cancel: {},
  hoe: {}, water: {}, pick_hit: {}, sword_swing: {}, zone_change: {}, coins: {}, pickup: {},
  plant: {}, place: {}, error: {}, hurt: {}, chat: {},
};

function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("resolveSfxKey", () => {
  it("maps UI keys", () => {
    expect(resolveSfxKey("click", sfx)).toBe("ui_click");
    expect(resolveSfxKey("hover", sfx)).toBe("ui_hover");
    expect(resolveSfxKey("select", sfx)).toBe("ui_slot");
    expect(resolveSfxKey("cancel", sfx)).toBe("ui_cancel");
  });

  it("maps game keys and passes through manifest keys", () => {
    expect(resolveSfxKey("tool_hoe", sfx)).toBe("hoe");
    expect(resolveSfxKey("tool_water", sfx)).toBe("water");
    expect(resolveSfxKey("tool_pickaxe", sfx)).toBe("pick_hit");
    expect(resolveSfxKey("tool_sword", sfx)).toBe("sword_swing");
    expect(resolveSfxKey("door", sfx)).toBe("zone_change");
    expect(resolveSfxKey("loot", sfx)).toBe("coins");
    for (const k of ["plant", "place", "pickup", "error", "hurt", "chat"]) expect(resolveSfxKey(k, sfx)).toBe(k);
  });

  it("falls back from coins to pickup for loot", () => {
    const { coins: _c, ...noCoins } = sfx;
    expect(resolveSfxKey("loot", noCoins)).toBe("pickup");
  });

  it("ignores unknown keys, including prototype names", () => {
    expect(resolveSfxKey("use", sfx)).toBeNull();
    expect(resolveSfxKey("toString", sfx)).toBeNull();
    expect(resolveSfxKey("__proto__", sfx)).toBeNull();
  });
});

describe("musicKeyForZone", () => {
  const music = { title: {}, home: {}, village: {}, caves: {} };
  it("uses the title track when there is no zone", () => expect(musicKeyForZone(null, music)).toBe("title"));
  it("uses the zone's track", () => expect(musicKeyForZone("caves", music)).toBe("caves"));
  it("returns null for a zone with no track", () => expect(musicKeyForZone("riverside", music)).toBeNull());
});

describe("pickVariant", () => {
  it("returns 0 for a single variant", () => expect(pickVariant(1, 0, Math.random)).toBe(0));
  it("never repeats the last variant", () => {
    for (let last = 0; last < 5; last++) {
      for (const r of [0, 0.2, 0.5, 0.8, 0.9999]) {
        const i = pickVariant(5, last, () => r);
        expect(i).not.toBe(last);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(5);
      }
    }
  });
  it("covers every other variant", () => {
    const got = new Set([0, 0.34, 0.67, 0.99].map((r) => pickVariant(4, 2, () => r)));
    expect([...got].sort()).toEqual([0, 1, 3]);
  });
  it("handles a missing last pick", () => expect(pickVariant(3, undefined, seq(0.999))).toBe(2));
});

describe("pitchFor", () => {
  it("stays within ±4%", () => {
    expect(pitchFor(() => 0)).toBeCloseTo(0.96);
    expect(pitchFor(() => 0.5)).toBeCloseTo(1);
    expect(pitchFor(() => 0.99999)).toBeLessThanOrEqual(1.04);
  });
});

describe("Throttle", () => {
  it("limits hover to one per 60 ms", () => {
    const t = new Throttle();
    expect(t.allow("ui_hover", 1000)).toBe(true);
    expect(t.allow("ui_hover", 1030)).toBe(false);
    expect(t.allow("ui_hover", 1059)).toBe(false);
    expect(t.allow("ui_hover", 1060)).toBe(true);
  });
  it("tracks keys independently and uses the default gap", () => {
    const t = new Throttle({ a: 100 }, 10);
    expect(t.allow("a", 0)).toBe(true);
    expect(t.allow("b", 0)).toBe(true);
    expect(t.allow("b", 5)).toBe(false);
    expect(t.allow("b", 10)).toBe(true);
    expect(t.allow("a", 50)).toBe(false);
  });
});

describe("footstepKey", () => {
  it("picks stone for hard ground and grass otherwise", () => {
    expect(footstepKey("stone")).toBe("step_stone");
    expect(footstepKey("cave_floor")).toBe("step_stone");
    expect(footstepKey("wood")).toBe("step_stone");
    expect(footstepKey("grass")).toBe("step_grass");
    expect(footstepKey("farmland")).toBe("step_grass");
  });
});

describe("settings", () => {
  it("defaults on missing or broken input", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("42")).toEqual(DEFAULT_SETTINGS);
  });
  it("clamps and keeps valid fields", () => {
    expect(parseSettings('{"muted":true,"music":2,"sfx":-1}')).toEqual({ muted: true, music: 1, sfx: 0 });
    expect(parseSettings('{"music":0.3,"sfx":"x"}')).toEqual({ ...DEFAULT_SETTINGS, music: 0.3 });
  });
  it("clamp01 handles NaN", () => expect(clamp01(Number.NaN)).toBe(0));
});

describe("assetUrl", () => {
  it("joins without double slashes", () => {
    expect(assetUrl("/assets/audio/", "sfx/a.ogg")).toBe("/assets/audio/sfx/a.ogg");
    expect(assetUrl("/assets/audio", "/music/b.ogg")).toBe("/assets/audio/music/b.ogg");
  });
});

// The manifest is read from disk; node:fs is loaded by a computed specifier so the worker
// tsconfig (no Node types) still typechecks this file.
interface NodeFs {
  readFileSync(path: string, enc: "utf8"): string;
  existsSync(path: string): boolean;
}
const AUDIO_DIR = "src/client/public/assets/audio/";
async function loadManifest(): Promise<{ fs: NodeFs; sfx: Record<string, { files: string[]; volume: number }> }> {
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as NodeFs;
  return { fs, sfx: JSON.parse(fs.readFileSync(AUDIO_DIR + "audio.json", "utf8")).sfx };
}

describe("combat and monster sfx in audio.json", () => {
  const keys = [
    ...COMBAT_SFX_KEYS,
    ...MONSTER_SFX_KINDS.flatMap((k) => MONSTER_SFX_EVENTS.map((e) => monsterSfxKey(k, e))),
  ];

  it("has every new key with at least one existing file and a sane volume", async () => {
    const { fs, sfx } = await loadManifest();
    for (const key of keys) {
      const entry = sfx[key];
      expect(entry, key).toBeDefined();
      expect(entry!.files.length, key).toBeGreaterThan(0);
      expect(entry!.volume, key).toBeGreaterThan(0);
      expect(entry!.volume, key).toBeLessThanOrEqual(1);
      for (const f of entry!.files) expect(fs.existsSync(AUDIO_DIR + f), f).toBe(true);
    }
  });

  it("resolves every new key and the spider aliases against the real manifest", async () => {
    const { sfx } = await loadManifest();
    for (const key of keys) expect(resolveSfxKey(key, sfx)).toBe(key);
    for (const e of MONSTER_SFX_EVENTS) expect(resolveSfxKey(`spider_${e}`, sfx)).toBe(`rock_crab_${e}`);
    expect(resolveSfxKey("attack_hit", sfx)).toBe("sword_hit");
    expect(resolveSfxKey("attack_miss", sfx)).toBe("sword_miss");
    expect(resolveSfxKey("faint", sfx)).toBe("player_faint");
    expect(resolveSfxKey("spawn", sfx)).toBe("monster_spawn");
  });

  it("falls back to generic sounds when a manifest lacks the new keys", () => {
    const old = { hurt: {}, monster_hit: {}, monster_die: {} };
    expect(resolveSfxKey("player_hurt", old)).toBe("hurt");
    expect(resolveSfxKey("slime_hurt", old)).toBe("monster_hit");
    expect(resolveSfxKey("ghost_die", old)).toBe("monster_die");
    expect(resolveSfxKey("slime_idle", old)).toBeNull();
  });
});

describe("shipped audio manifest", () => {
  it("points at files that exist and are credited, with soft drawer sounds for panels", async () => {
    // Client tsconfig has no Node types; same dynamic import as fe-ui-credits.test.ts.
    const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as {
      readFileSync(p: string, enc: "utf8"): string;
      existsSync(p: string): boolean;
    };
    const dir = "src/client/public/assets/audio/";
    const manifest = JSON.parse(fs.readFileSync(`${dir}audio.json`, "utf8")) as {
      sfx: Record<string, { files: string[]; volume: number }>;
    };
    const credits = fs.readFileSync(`${dir}CREDITS.md`, "utf8");
    for (const [key, entry] of Object.entries(manifest.sfx)) {
      for (const f of entry.files) {
        expect(fs.existsSync(`${dir}${f}`), `${key}: ${f}`).toBe(true);
        expect(credits, `${key}: ${f} credited`).toContain(`| \`${f}\``);
      }
    }
    expect(manifest.sfx.ui_open!.files).toEqual(["sfx/ui_drawer_open_0.ogg"]);
    expect(manifest.sfx.ui_close!.files).toEqual(["sfx/ui_drawer_close_0.ogg"]);
    expect(manifest.sfx.ui_open!.volume).toBeLessThanOrEqual(0.3);
  });
});
