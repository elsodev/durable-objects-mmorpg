import { describe, expect, it } from "vitest";
import { diffKeyed, farmSig, findObjectAt, objectSig } from "../src/client/render/farm";
import { DAY_MS, type FarmTile, type PlacedObject } from "../src/shared/types";

describe("diffKeyed", () => {
  const key = (t: { id: string }) => t.id;
  const sig = (t: { v: number }) => String(t.v);

  it("reports added, changed and removed, and updates prev", () => {
    const prev = new Map<string, string>();
    let d = diffKeyed(prev, [{ id: "a", v: 1 }, { id: "b", v: 1 }], key, sig);
    expect(d.added.map(key)).toEqual(["a", "b"]);
    expect(d.changed).toEqual([]);

    d = diffKeyed(prev, [{ id: "a", v: 1 }, { id: "b", v: 2 }, { id: "c", v: 0 }], key, sig);
    expect(d.added.map(key)).toEqual(["c"]);
    expect(d.changed.map(key)).toEqual(["b"]);
    expect(d.removed).toEqual([]);

    d = diffKeyed(prev, [{ id: "c", v: 0 }], key, sig);
    expect(d.removed.sort()).toEqual(["a", "b"]);
    expect(d.added).toEqual([]);
    expect([...prev.keys()]).toEqual(["c"]);
  });

  it("ignores duplicate keys after the first", () => {
    const prev = new Map<string, string>();
    const d = diffKeyed(prev, [{ id: "a", v: 1 }, { id: "a", v: 2 }], key, sig);
    expect(d.added).toHaveLength(1);
    expect(prev.get("a")).toBe("1");
  });
});

describe("farmSig", () => {
  const now = 10 * DAY_MS + 1000;
  const base: FarmTile = { x: 1, y: 2, crop: null, plantedAt: null, wateredDays: 0, lastWateredDay: null };

  it("changes when watered today, stays when nothing visible changes", () => {
    const wet = { ...base, lastWateredDay: 10, wateredDays: 1 };
    expect(farmSig(base, now)).not.toBe(farmSig(wet, now));
    expect(farmSig(base, now)).toBe(farmSig({ ...base }, now + 1000));
  });

  it("turns dry on the next day", () => {
    const wet = { ...base, lastWateredDay: 10, wateredDays: 1 };
    expect(farmSig(wet, now + DAY_MS)).not.toBe(farmSig(wet, now));
  });

  it("changes with crop stage", () => {
    const seed = { ...base, crop: "turnip", plantedAt: now, wateredDays: 0 };
    const grown = { ...seed, wateredDays: 50 };
    expect(farmSig(seed, now)).not.toBe(farmSig(grown, now));
  });
});

describe("findObjectAt", () => {
  const objs: PlacedObject[] = [
    { id: "o1", item: "chair_wood", x: 3, y: 3, rotation: 0 },
    { id: "o2", item: "chair_wood", x: 5, y: 3, rotation: 0 },
  ];
  it("hits objects by floored tile", () => {
    expect(findObjectAt(objs, { x: 3.7, y: 3.2 })).toBe("o1");
    expect(findObjectAt(objs, { x: 5.0, y: 3.99 })).toBe("o2");
    expect(findObjectAt(objs, { x: 4.5, y: 3.5 })).toBeNull();
  });
  it("objectSig covers position and rotation", () => {
    expect(objectSig(objs[0]!)).not.toBe(objectSig({ ...objs[0]!, rotation: 1 }));
    expect(objectSig(objs[0]!)).not.toBe(objectSig({ ...objs[0]!, x: 4 }));
  });
});

describe("findObjectAt with rotation", () => {
  it("uses the rotated footprint", () => {
    const table: PlacedObject = { id: "t", item: "table_wood", x: 2, y: 2, rotation: 1 };
    expect(findObjectAt([table], { x: 2.5, y: 3.5 })).toBe("t");
    expect(findObjectAt([table], { x: 3.5, y: 2.5 })).toBeNull();
  });
});
