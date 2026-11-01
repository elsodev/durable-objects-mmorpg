import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK, LOOK_OPTIONS, LOOK_PARTS, lookKey, randomLook, sameLook, validateLook } from "../src/shared/look";
import { decodeClient, encode } from "../src/shared/protocol";
import { canChangeLook, LOOK_COOLDOWN_MS, savedLook, shownLook } from "../src/worker/game/look";
import { EntityDiffer, snapshotEntity } from "../src/worker/game/diff";
import type { EntityState, Look } from "../src/shared/types";

interface NodeFs {
  readFileSync(path: string, enc: "utf8"): string;
  existsSync(path: string): boolean;
}
const CUSTOM_DIR = "src/client/public/assets/lpc/custom/";
async function loadCustom(): Promise<{ fs: NodeFs; json: any }> {
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as NodeFs;
  return { fs, json: JSON.parse(fs.readFileSync(CUSTOM_DIR + "custom.json", "utf8")) };
}

const PICKED: Look = {
  body: "female",
  skin: "olive",
  eyes: "green",
  hairStyle: "bun",
  hairColor: "ginger",
  top: "mustard_cardigan",
  bottom: "forest_skirt",
  shoes: "tan_ghillies",
};

describe("look ids vs custom.json", () => {
  it("lists exactly the option ids of the art pack, in order", async () => {
    const { json } = await loadCustom();
    for (const part of LOOK_PARTS) {
      expect(json.options[part].map((o: { id: string }) => o.id), part).toEqual([...LOOK_OPTIONS[part]]);
    }
  });

  it("uses the art pack defaults", async () => {
    const { json } = await loadCustom();
    expect(json.defaults).toEqual({ ...DEFAULT_LOOK });
  });

  it("lists the body types", async () => {
    const { json } = await loadCustom();
    expect(json.bodies.map((b: { id: string }) => b.id)).toEqual([...LOOK_OPTIONS.body]);
    expect(Object.keys(json.files)).toEqual([...LOOK_OPTIONS.body]);
  });

  it("has an existing file for every body x option and every body x hair style:colour pair", async () => {
    const { fs, json } = await loadCustom();
    for (const body of LOOK_OPTIONS.body) {
      const files = json.files[body];
      for (const part of ["skin", "eyes", "top", "bottom", "shoes"] as const) {
        expect(Object.keys(files[part]), `${body} ${part}`).toEqual([...LOOK_OPTIONS[part]]);
        for (const id of LOOK_OPTIONS[part]) expect(fs.existsSync(CUSTOM_DIR + files[part][id]), `${body} ${part} ${id}`).toBe(true);
      }
      for (const s of LOOK_OPTIONS.hairStyle) {
        for (const c of LOOK_OPTIONS.hairColor) {
          const file = files.hair[`${s}:${c}`];
          expect(file, `${body} ${s}:${c}`).toBeTypeOf("string");
          expect(fs.existsSync(CUSTOM_DIR + file), file).toBe(true);
        }
      }
    }
  });

  it("offers at most 5 choices per part", () => {
    for (const part of LOOK_PARTS) expect(LOOK_OPTIONS[part].length).toBeLessThanOrEqual(5);
  });
});

describe("validateLook", () => {
  it("accepts a full look and copies only known fields", () => {
    expect(validateLook({ ...PICKED, extra: "x", sprite: "player_1" })).toEqual(PICKED);
    expect(validateLook(DEFAULT_LOOK)).toEqual(DEFAULT_LOOK);
  });

  it("reads a look without a body (saved before body types) as the male body", () => {
    const { body: _b, ...old } = PICKED;
    expect(validateLook(old)).toEqual({ ...PICKED, body: "male" });
    expect(validateLook({ ...PICKED, body: "male_slim" })).toEqual({ ...PICKED, body: "male_slim" });
  });

  it("rejects missing, unknown or non-string parts", () => {
    const { shoes: _s, ...noShoes } = PICKED;
    expect(validateLook(noShoes)).toBeNull();
    expect(validateLook({ ...PICKED, top: "crown" })).toBeNull();
    expect(validateLook({ ...PICKED, body: "muscular" })).toBeNull();
    expect(validateLook({ ...PICKED, body: "teen" })).toBeNull();
    expect(validateLook({ ...PICKED, body: null })).toBeNull();
    expect(validateLook({ ...PICKED, body: "toString" })).toBeNull();
    expect(validateLook({ ...PICKED, skin: 3 })).toBeNull();
    expect(validateLook({ ...PICKED, hairStyle: "constructor" })).toBeNull();
    expect(validateLook({ ...PICKED, eyes: "brown".padEnd(5000, "x") })).toBeNull();
  });

  it("rejects non-objects", () => {
    for (const v of [null, undefined, "light", 7, [], [PICKED]]) expect(validateLook(v)).toBeNull();
  });
});

describe("look helpers", () => {
  it("lookKey is stable and distinguishes looks", () => {
    expect(lookKey({ ...PICKED })).toBe(lookKey(PICKED));
    expect(lookKey({ ...PICKED, shoes: "black_shoes" })).not.toBe(lookKey(PICKED));
    expect(lookKey({ ...PICKED, body: "male" })).not.toBe(lookKey(PICKED));
    expect(sameLook(PICKED, { ...PICKED })).toBe(true);
    expect(sameLook(PICKED, undefined)).toBe(false);
  });

  it("randomLook only picks valid ids, across the whole range", () => {
    expect(validateLook(randomLook(() => 0))).toEqual({
      body: "male",
      skin: "light",
      eyes: "brown",
      hairStyle: "short",
      hairColor: "chestnut",
      top: "teal_longsleeve",
      bottom: "brown_pants",
      shoes: "brown_shoes",
    });
    const last = randomLook(() => 0.999999);
    expect(validateLook(last)).toEqual(last);
    expect(last.shoes).toBe("tan_ghillies");
    expect(last.body).toBe("female");
  });
});

describe("setLook protocol", () => {
  it("decodes a valid setLook and strips extras", () => {
    const raw = JSON.stringify({ t: "setLook", look: { ...PICKED, evil: 1 }, admin: true });
    expect(decodeClient(raw)).toEqual({ t: "setLook", look: PICKED });
    expect(decodeClient(encode({ t: "setLook", look: PICKED }))).toEqual({ t: "setLook", look: PICKED });
  });

  it("drops setLook with a bad look", () => {
    expect(decodeClient(JSON.stringify({ t: "setLook" }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "setLook", look: { ...PICKED, top: "<img>" } }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "setLook", look: "light" }))).toBeNull();
  });
});

describe("server look rules", () => {
  it("rate-limits look changes", () => {
    expect(canChangeLook(0, LOOK_COOLDOWN_MS)).toBe(true);
    expect(canChangeLook(10_000, 10_000 + LOOK_COOLDOWN_MS - 1)).toBe(false);
    expect(canChangeLook(10_000, 10_000 + LOOK_COOLDOWN_MS)).toBe(true);
  });

  it("defaults missing or stale saved looks", () => {
    expect(savedLook(undefined)).toBeUndefined();
    expect(savedLook({ ...PICKED, top: "retired_item" })).toBeUndefined();
    expect(savedLook(PICKED)).toEqual(PICKED);
    const { body: _b, ...preBodies } = PICKED;
    expect(savedLook(preBodies)).toEqual({ ...PICKED, body: "male" });
    expect(shownLook(preBodies)).toEqual({ ...PICKED, body: "male" });
    expect(shownLook(undefined)).toEqual(DEFAULT_LOOK);
    expect(shownLook(PICKED)).toEqual(PICKED);
  });

  it("broadcasts look changes in the entity diff", () => {
    const e: EntityState = { id: "p:u1", kind: "player", name: "A", sprite: "player_1", x: 1, y: 1, facing: "down", moving: false, look: { ...DEFAULT_LOOK } };
    const d = new EntityDiffer();
    expect(d.diff([e]).upd[0]?.look).toEqual(DEFAULT_LOOK);
    expect(d.diff([e]).upd).toHaveLength(0);
    e.look = PICKED;
    const upd = d.diff([e]).upd;
    expect(upd).toHaveLength(1);
    expect(upd[0]!.look).toEqual(PICKED);
    expect(snapshotEntity({ ...e, look: undefined }).look).toBeUndefined();
  });
});
