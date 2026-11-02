import { describe, expect, it, vi } from "vitest";
import {
  chatKind,
  createReqIds,
  exitNear,
  inUseRange,
  isFurnitureSlot,
  nearestNpc,
  propTarget,
  sfxForUse,
  usableHere,
  clickUsesTool,
  usableItem,
  useTarget,
} from "../src/client/game/actions";
import { applyAppearance, appearanceOf } from "../src/client/game/appearance";
import { playSfx, setAudioHooks, setMusicZone } from "../src/client/game/audio";
import { clampDt, every, MAX_FRAME_MS, startLoop } from "../src/client/game/loop";
import { getMap } from "../src/shared/maps";
import type { EntityState, Inventory } from "../src/shared/types";

const ent = (id: string, kind: EntityState["kind"], x: number, y: number): EntityState => ({
  id,
  kind,
  name: id,
  sprite: "slime",
  x,
  y,
  facing: "down",
  moving: false,
});

const inv: Inventory = {
  coins: 0,
  slots: [
    { item: "hoe", qty: 1 },
    { item: "seed_turnip", qty: 5 },
    { item: "chair_wood", qty: 1 },
    { item: "turnip", qty: 3 },
  ],
};

describe("useTarget", () => {
  it("uses the clicked tile when within 1.5 tiles", () => {
    expect(useTarget({ x: 5.5, y: 5.9 }, "down", { x: 6.2, y: 5.4 })).toEqual({ x: 6, y: 5 });
  });
  it("falls back to the facing tile when the click is far", () => {
    expect(useTarget({ x: 5.5, y: 5.9 }, "left", { x: 9, y: 9 })).toEqual({ x: 4, y: 5 });
    expect(useTarget({ x: 5.5, y: 5.9 }, "up")).toEqual({ x: 5, y: 4 });
  });
  it("inUseRange measures to the tile centre", () => {
    expect(inUseRange({ x: 5.5, y: 5.5 }, { x: 6.9, y: 5.1 })).toBe(true);
    expect(inUseRange({ x: 5.5, y: 5.5 }, { x: 7.1, y: 5.1 })).toBe(false);
  });
});

describe("nearestNpc", () => {
  it("picks the closest NPC within 3 tiles and ignores other kinds", () => {
    const list = [ent("m:1", "monster", 5, 5.2), ent("n:far", "npc", 9, 5), ent("n:near", "npc", 6, 6), ent("n:mid", "npc", 7, 5)];
    expect(nearestNpc({ x: 5, y: 5 }, list)).toBe("n:near");
    expect(nearestNpc({ x: 50, y: 50 }, list)).toBeNull();
  });
});

describe("items in slots", () => {
  it("classifies usable and furniture slots", () => {
    expect(usableItem(inv, 0)).toBe("hoe");
    expect(usableItem(inv, 1)).toBe("seed_turnip");
    expect(usableItem(inv, 3)).toBeNull();
    expect(usableItem(inv, 9)).toBeNull();
    expect(isFurnitureSlot(inv, 2)).toBe(true);
    expect(isFurnitureSlot(inv, 0)).toBe(false);
  });
  it("only treats farming items as usable at home; pickaxe and sword work anywhere", () => {
    const kit: Inventory = { coins: 0, slots: [{ item: "hoe", qty: 1 }, { item: "seed_turnip", qty: 2 }, { item: "pickaxe", qty: 1 }, { item: "sword_wood", qty: 1 }, { item: "watering_can", qty: 1 }] };
    expect(usableHere(kit, 0, "home")).toBe("hoe");
    expect(usableHere(kit, 0, "village")).toBeNull();
    expect(usableHere(kit, 1, "village")).toBeNull();
    expect(usableHere(kit, 4, "riverside")).toBeNull();
    expect(usableHere(kit, 2, "caves")).toBe("pickaxe");
    expect(usableHere(kit, 3, "village")).toBe("sword_wood");
    expect(usableHere(kit, 2, "home")).toBe("pickaxe");
    expect(usableHere({ coins: 0, slots: [{ item: "axe", qty: 1 }] }, 0, "village")).toBe("axe");
  });
  it("a click uses the tool on targets it affects or bounces off, swords always swing, else it walks", () => {
    expect(clickUsesTool("hoe", { ok: true }, { kind: "grass" })).toBe(true);
    expect(clickUsesTool("hoe", { ok: false, reason: "You can't till here." }, { kind: "none" })).toBe(false);
    expect(clickUsesTool("pickaxe", { ok: false, reason: "bounces" }, { kind: "tree" })).toBe(true);
    // A boulder: the axe rebounds off it (a swing), not "Can't walk there."
    expect(clickUsesTool("axe", { ok: false, reason: "bounces" }, { kind: "boulder" })).toBe(true);
    expect(clickUsesTool("axe", { ok: false, reason: "" }, { kind: "none" })).toBe(false);
    expect(clickUsesTool("hoe", { ok: false, reason: "Already tilled." }, { kind: "soil" })).toBe(true);
    expect(clickUsesTool("sword_wood", { ok: false, reason: "" }, { kind: "none" })).toBe(true);
    expect(clickUsesTool("seed_turnip", { ok: true }, { kind: "soil" })).toBe(true);
  });
  it("targets the selected stack when interacting with the shipping bin", () => {
    const home = getMap("home");
    const bin = home.props.find((p) => p.type === "shipping_bin")!;
    expect(propTarget(home, bin.id, 3)).toBe(`${bin.id}:3`);
    const other = home.props.find((p) => p.type !== "shipping_bin")!;
    expect(propTarget(home, other.id, 3)).toBe(other.id);
    expect(propTarget(null, "x", 0)).toBe("x");
  });
  it("maps items to sound keys", () => {
    expect(sfxForUse(inv, 0)).toBe("tool_hoe");
    expect(sfxForUse(inv, 1)).toBe("plant");
    expect(sfxForUse(inv, 7)).toBe("use");
  });
});

describe("exitNear", () => {
  it("finds the home exit to a shared zone", () => {
    const home = getMap("home");
    const exit = home.exits.find((e) => e.to !== "home")!;
    const found = exitNear(home, { x: exit.x + 0.5, y: exit.y + 0.5 });
    expect(found?.to).toBe(exit.to);
    expect(exitNear(home, { x: 0, y: 0 }, exit.to)?.to).toBe(exit.to);
  });
});

describe("misc helpers", () => {
  it("chatKind", () => {
    expect(chatKind("n:smith")).toBe("npc");
    expect(chatKind("p:abc")).toBe("player");
    expect(chatKind("")).toBe("system");
  });
  it("req ids are unique", () => {
    const next = createReqIds();
    expect(new Set([next(), next(), next()]).size).toBe(3);
  });
  it("appearance overrides your sprite only with a sane key", () => {
    const me = ent("p:1", "player", 1, 1);
    expect(applyAppearance(me, appearanceOf({ appearance: { sprite: "player_3" } })).sprite).toBe("player_3");
    expect(applyAppearance(me, appearanceOf({ appearance: { sprite: "<img>" } })).sprite).toBe("slime");
    expect(applyAppearance(me, appearanceOf({})).sprite).toBe("slime");
  });
  it("audio hooks are no-ops by default and swallow errors", () => {
    expect(() => playSfx("x")).not.toThrow();
    const sfx = vi.fn();
    setAudioHooks({ playSfx: sfx, setMusicZone: () => { throw new Error("boom"); } });
    playSfx("loot");
    expect(sfx).toHaveBeenCalledWith("loot");
    expect(() => setMusicZone("village")).not.toThrow();
    setAudioHooks(null);
  });
});

describe("loop", () => {
  it("clamps frame time", () => {
    expect(clampDt(16)).toBe(16);
    expect(clampDt(5000)).toBe(MAX_FRAME_MS);
    expect(clampDt(-1)).toBe(0);
    expect(clampDt(NaN)).toBe(0);
  });
  it("every() fires once per period", () => {
    const fn = vi.fn();
    const tick = every(100, fn);
    for (let i = 0; i < 10; i++) tick(25);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("startLoop survives a throwing frame and can stop", () => {
    const fns: ((t: { deltaMS: number }) => void)[] = [];
    const ticker = { add: (f: (t: { deltaMS: number }) => void) => fns.push(f), remove: () => fns.pop() };
    const onError = vi.fn();
    const frame = vi.fn(() => {
      throw new Error("bad");
    });
    const stop = startLoop(ticker, frame, onError);
    fns[0]!({ deltaMS: 16 });
    fns[0]!({ deltaMS: 16 });
    expect(frame).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    stop();
    expect(fns.length).toBe(0);
  });
});
