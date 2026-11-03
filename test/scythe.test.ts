// The scythe: the item and where it is sold, the sweep (aimed tile plus the two beside it), the
// server rules through a real HomeRoom (reach, ripe only, stamina, impact stamps), the standing
// harvest sweep that replaced the kneel, and the scythe's art for every body and catalog character.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectOwner, createRooms, sendMsg, type FakeWs, type Rooms } from "./do-harness";
import { pngSize } from "./png";
import { getItem, ITEMS, starterInventory } from "../src/shared/items";
import { HOTBAR_SIZE, heldItemAt } from "../src/shared/held";
import { NPCS } from "../src/worker/npc/catalog";
import { clampStamina, dayIndex, farmNow, isFarmable, scytheSweep, staminaCost, tillTile, plantTile } from "../src/shared/engine";
import { impactDelayMs, toolTiming } from "../src/shared/engine/toolTiming";
import { planHarvest } from "../src/worker/game/sweep";
import { rollHarvest, type HarvestRoll } from "../src/shared/engine/harvest";
import { getMap } from "../src/shared/maps";
import { actionPlan, heldFiles, parseLookManifest, type LookManifest } from "../src/client/art/look-logic";
import { LOOK_OPTIONS, DEFAULT_LOOK } from "../src/shared/look";
import { actionNameFor, impactFrameOf, swingFrame } from "../src/client/render/tool-actions";
import { effectiveAct, startHarvest, startSwing } from "../src/client/game/tool-swing";
import type { Facing, FarmTile, Inventory } from "../src/shared/types";

const FACINGS: Facing[] = ["up", "left", "down", "right"];
const ASSETS = "src/client/public/assets/lpc";

interface NodeFs {
  readFileSync(path: string, enc: "utf8"): string;
}
async function manifest(): Promise<LookManifest> {
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as NodeFs;
  return parseLookManifest(JSON.parse(fs.readFileSync(`${ASSETS}/custom/custom.json`, "utf8")))!;
}
async function catalog(): Promise<{ icons: Record<string, { file: string; rect: number[] }> }> {
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as NodeFs;
  return JSON.parse(fs.readFileSync(`${ASSETS}/catalog.json`, "utf8"));
}

describe("scythe item", () => {
  it("is a cheap swinging farm tool sold by the smith and in every new player's hotbar", () => {
    const def = getItem("scythe")!;
    expect(def).toMatchObject({ kind: "tool", tool: "scythe", stack: 1, buy: 100, sell: 0 });
    expect(def.desc).toBeTruthy();
    expect(Object.values(ITEMS).filter((i) => i.tool === "scythe").map((i) => i.id)).toEqual(["scythe"]);
    expect(NPCS.fenwick!.shop!.sells.some((o) => o.item === "scythe")).toBe(true);
    const inv = starterInventory();
    const slot = inv.slots.findIndex((s) => s?.item === "scythe");
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(HOTBAR_SIZE);
    expect(heldItemAt(inv, slot)).toBe("scythe");
    // The older kit keeps its slots.
    expect(inv.slots.slice(0, 7).map((s) => s?.item)).toEqual(["hoe", "watering_can", "pickaxe", "axe", "sword_wood", "seed_turnip", "chair_wood"]);
    expect(staminaCost("scythe")).toBe(staminaCost("hoe"));
  });
});

describe("scythe sweep", () => {
  it("covers the aimed tile first, then the two beside it across the facing", () => {
    expect(scytheSweep({ x: 5, y: 7 }, "down")).toEqual([{ x: 5, y: 7 }, { x: 4, y: 7 }, { x: 6, y: 7 }]);
    expect(scytheSweep({ x: 5, y: 7 }, "up")).toEqual([{ x: 5, y: 7 }, { x: 4, y: 7 }, { x: 6, y: 7 }]);
    expect(scytheSweep({ x: 5, y: 7 }, "left")).toEqual([{ x: 5, y: 7 }, { x: 5, y: 6 }, { x: 5, y: 8 }]);
    expect(scytheSweep({ x: 5, y: 7 }, "right")).toEqual([{ x: 5, y: 7 }, { x: 5, y: 6 }, { x: 5, y: 8 }]);
  });
});

describe("planHarvest", () => {
  const ripe = (x: number, y: number): FarmTile => ({ x, y, crop: "turnip", plantedAt: farmNow(1), wateredDays: 9, lastWateredDay: dayIndex(farmNow(1)) });
  const growing = (x: number, y: number): FarmTile => ({ x, y, crop: "turnip", plantedAt: farmNow(1), wateredDays: 0, lastWateredDay: null });
  const one = (t: FarmTile): HarvestRoll | null => (t.wateredDays > 0 ? rollHarvest("turnip", 0, () => 0.99) : null);
  const empty = (): Inventory => ({ coins: 0, slots: Array.from({ length: 24 }, () => null) });

  it("cuts every ripe tile of the sweep, skips unripe ones, and merges the haul", () => {
    const farm = [ripe(5, 7), growing(4, 7), ripe(6, 7)];
    const plan = planHarvest(scytheSweep({ x: 5, y: 7 }, "down"), farm, empty(), one);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.tiles.map((t) => t.x)).toEqual([5, 6]);
    expect(plan.items).toEqual([{ item: "turnip", qty: 2 }]);
    expect(plan.count).toBe(2);
    expect(farm[0]!.crop).toBe("turnip"); // nothing changes until the caller applies it
  });

  it("refuses when the aimed tile isn't ripe, even if a neighbour is", () => {
    const farm = [growing(5, 7), ripe(6, 7)];
    expect(planHarvest(scytheSweep({ x: 5, y: 7 }, "down"), farm, empty(), one)).toEqual({ ok: false, reason: "Nothing to harvest." });
  });

  it("stops the sweep when the bag fills, and refuses when not even the aimed crop fits", () => {
    const full = (): Inventory => ({ coins: 0, slots: Array.from({ length: 24 }, (_, i) => ({ item: i === 0 ? "turnip" : "stone", qty: i === 0 ? 98 : 99 })) });
    const farm = [ripe(5, 7), ripe(4, 7), ripe(6, 7)];
    const plan = planHarvest(scytheSweep({ x: 5, y: 7 }, "down"), farm, full(), one);
    expect(plan.ok && plan.tiles.length).toBe(1);
    const fuller = full();
    fuller.slots[0]!.qty = 99;
    expect(planHarvest([{ x: 5, y: 7 }], farm, fuller, one)).toEqual({ ok: false, reason: "Your bag is full." });
  });
});

describe("harvest timing", () => {
  it("pops crops on the sweep's impact frame: the blade on slash frame 4, the hand on frame 3", () => {
    for (const f of FACINGS) {
      expect(toolTiming("scythe", f)).toEqual({ impactMs: 260, totalMs: 475 });
      expect(toolTiming("harvest", f)).toEqual({ impactMs: 210, totalMs: 450 });
    }
    expect(impactFrameOf("scythe", 6)).toBe(4);
    expect(impactFrameOf("harvest", 6)).toBe(3);
    for (const k of ["scythe", "harvest"]) {
      const t = toolTiming(k, "down")!;
      const impact = impactFrameOf(k, 6);
      expect(swingFrame(t.impactMs - 1, 6, impact, t)).toBe(impact - 1);
      expect(swingFrame(t.impactMs, 6, impact, t)).toBe(impact);
      expect(swingFrame(t.totalMs - 1, 6, impact, t)).toBe(5);
      expect(swingFrame(t.totalMs, 6, impact, t)).toBe(-1);
    }
  });

  it("plays the scythe's own swing, and the standing sweep for a hand harvest", () => {
    expect(actionNameFor({ k: "scythe", at: 0, item: "scythe" })).toBe("scythe");
    expect(actionNameFor({ k: "harvest", at: 0 })).toBe("harvest");
    const me = { x: 5.5, y: 6.5, facing: "up" as Facing };
    const swing = startSwing("scythe", me, { x: 5, y: 7 }, 1000, 50_000)!;
    expect(swing).toMatchObject({ act: { k: "scythe", item: "scythe" }, facing: "down", impactMs: 1260, endMs: 1475 });
    const hand = startHarvest(me, { x: 5, y: 7 }, 1000, 50_000);
    expect(hand).toMatchObject({ act: { k: "harvest", at: 50_000 }, facing: "down", impactMs: 1210, endMs: 1450 });
  });

  it("ignores the server's echo of a hand sweep you already started, but not a later one", () => {
    const local = { k: "harvest", at: 50_000 };
    expect(effectiveAct({ k: "harvest", at: 50_080 }, local)).toBe(local);
    const later = { k: "harvest", at: 60_000 };
    expect(effectiveAct(later, local)).toBe(later);
    expect(effectiveAct({ k: "scythe", at: 50_080, item: "scythe" }, { k: "scythe", at: 50_000, item: "scythe" })).toEqual({ k: "scythe", at: 50_000, item: "scythe" });
  });
});

describe("harvest and scythe art", () => {
  it("harvests standing: slash frames 0-5 from the walk/slash sheet, never the kneel", async () => {
    const m = await manifest();
    expect(m.actions.harvest!.frames).toEqual([0, 1, 2, 3, 3, 4].map((col) => ({ anim: "slash", col })));
    expect(m.anims.slash).toMatchObject({ sheet: "base", row: 4, rows: 4, frames: 6 });
    // Planting still kneels to press the seed in.
    expect(m.actions.plant!.frames.some((f) => f.anim === "sit")).toBe(true);
  });

  it("every body type and every catalog character harvests with the standing sweep in all 4 facings", async () => {
    const m = await manifest();
    const actors = [
      ...LOOK_OPTIONS.body.map((body) => ({ ...DEFAULT_LOOK, body })),
      ...Object.keys(m.characters).map((sprite) => ({ sprite })),
    ];
    expect(actors.length).toBe(3 + 17);
    for (const who of actors) {
      const name = "sprite" in who ? who.sprite : who.body;
      for (const action of ["harvest", "scythe"]) {
        const p = actionPlan(m, who, action)!;
        expect(p, `${name} ${action}`).not.toBeNull();
        expect(p.files.every((f) => !f.endsWith(".act.png")), `${name} ${action}`).toBe(true);
        const body = p.draws.filter((d) => !d.file.startsWith("tools/"));
        // Rows 4..7 are the slash rows (up, left, down, right).
        expect(new Set(body.map((d) => d.sy / 64)), name).toEqual(new Set([4, 5, 6, 7]));
        expect(new Set(body.map((d) => d.sx / 64)), name).toEqual(new Set(action === "scythe" ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4]));
      }
      const s = actionPlan(m, who, "scythe")!;
      expect(s.action).toBe("scythe");
      expect([s.spec.frameSize, s.spec.frames.length, s.width, s.height]).toEqual([192, 6, 1152, 768]);
      // Behind the body first, in front of the hair last.
      expect(s.draws[0]!.file).toBe("tools/scythe.bg.png");
      expect(s.draws.at(-1)!.file).toBe("tools/scythe.fg.png");
      expect(heldFiles(m, who, "scythe"), name).toEqual({ bg: "tools/scythe.held.bg.png", fg: "tools/scythe.held.fg.png" });
    }
  });

  it("ships tool sheets on the action's grid and an icon in the tool icon sheet", async () => {
    expect(pngSize(`${ASSETS}/custom/tools/scythe.bg.png`)).toEqual({ w: 6 * 192, h: 4 * 192 });
    expect(pngSize(`${ASSETS}/custom/tools/scythe.fg.png`)).toEqual({ w: 6 * 192, h: 4 * 192 });
    expect(pngSize(`${ASSETS}/custom/tools/scythe.held.bg.png`)).toEqual({ w: 576, h: 256 });
    expect(pngSize(`${ASSETS}/custom/tools/scythe.held.fg.png`)).toEqual({ w: 576, h: 256 });
    const icon = (await catalog()).icons.scythe!;
    expect(icon.file).toBe("icons/tool_icons.png");
    const sheet = pngSize(`${ASSETS}/${icon.file}`);
    expect(icon.rect[0]! + icon.rect[2]!).toBeLessThanOrEqual(sheet.w);
  });
});

// ------------------------------------------------------------------ through a real HomeRoom

const T0 = 1_700_000_000_000;
const HOME = getMap("home");
let r: Rooms;

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  vi.spyOn(Math, "random").mockReturnValue(0.99);
  r = createRooms();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Three farmable tiles in a row with free ground above the middle one. */
function row3(room: any): { x: number; y: number } {
  for (let y = 2; y < HOME.height; y++)
    for (let x = 1; x < HOME.width - 1; x++) {
      const ok = [x - 1, x, x + 1].every((tx) => isFarmable(HOME, tx, y, room.objects.home) && !HOME.rocks?.some((k) => k.x === tx && k.y === y));
      if (ok) return { x, y };
    }
  throw new Error("no farm row");
}

async function setup(): Promise<{ ws: FakeWs; room: any; spot: { x: number; y: number } }> {
  const ws = await connectOwner(r, "alice", "Alice");
  const room = r.room("alice") as any;
  await r.ctx("alice").ready;
  room.clock = { day: 5, startAt: Date.now() };
  const spot = row3(room);
  room.player.entity.x = spot.x + 0.5;
  room.player.entity.y = spot.y - 0.5;
  return { ws, room, spot };
}
function crop(room: any, x: number, y: number, ripe = true): FarmTile {
  const t = tillTile(x, y);
  plantTile(t, "seed_turnip", farmNow(1));
  if (ripe) {
    t.wateredDays = 9;
    t.lastWateredDay = dayIndex(farmNow(1));
  }
  room.farm.push(t);
  return t;
}
const slotOf = (room: any, item: string) => room.save.inventory.slots.findIndex((s: any) => s?.item === item);
const turnips = (room: any) =>
  room.save.inventory.slots.filter((s: any) => s && /^turnip(_silver|_gold)?$/.test(s.item)).reduce((n: number, s: any) => n + s.qty, 0);
async function use(ws: FakeWs, room: any, item: string | number, x: number, y: number): Promise<void> {
  vi.advanceTimersByTime(300);
  await sendMsg(r, "alice", ws, { t: "use", slot: typeof item === "number" ? item : slotOf(room, item), x, y });
}

describe("scythe on the home farm", () => {
  it("one swing cuts the aimed ripe crop and the ripe crops beside it, for tool stamina, landing at the blade's impact", async () => {
    const { ws, room, spot } = await setup();
    const tiles = [crop(room, spot.x - 1, spot.y), crop(room, spot.x, spot.y), crop(room, spot.x + 1, spot.y)];
    const stamina = clampStamina(room.save.stamina);
    ws.sent = [];
    await use(ws, room, "scythe", spot.x, spot.y);
    expect(ws.of("reject")).toEqual([]);
    expect(tiles.map((t) => t.crop)).toEqual([null, null, null]);
    expect(turnips(room)).toBeGreaterThanOrEqual(3); // seeded extra-crop rolls may add some
    expect(clampStamina(room.save.stamina)).toBe(stamina - staminaCost("scythe"));
    expect(room.save.stats.cropsHarvested).toBe(3);
    const farm = ws.last("farm");
    expect(farm.tiles).toHaveLength(3);
    expect(farm.by).toBe("p:alice");
    expect(farm.impactAt - Date.now()).toBe(impactDelayMs("scythe", "down"));
    // The scythe keeps its own swing (not the hand sweep).
    expect(room.player.entity.act).toMatchObject({ k: "scythe", item: "scythe" });
    expect(room.player.entity.facing).toBe("down");
  });

  it("cuts only ripe crops, and only beside tiles in reach", async () => {
    const { ws, room, spot } = await setup();
    const left = crop(room, spot.x - 1, spot.y, false);
    const mid = crop(room, spot.x, spot.y);
    const right = crop(room, spot.x + 1, spot.y);
    // Standing back so the aimed tile is in reach but the right one isn't.
    room.player.entity.y = spot.y - 1.4;
    await use(ws, room, "scythe", spot.x, spot.y);
    expect([left.crop, mid.crop, right.crop]).toEqual(["turnip", null, "turnip"]);
    expect(room.save.stats.cropsHarvested).toBe(1);
  });

  it("does nothing to unripe crops (no stamina) and refuses out of reach", async () => {
    const { ws, room, spot } = await setup();
    const t = crop(room, spot.x, spot.y, false);
    const stamina = clampStamina(room.save.stamina);
    await use(ws, room, "scythe", spot.x, spot.y);
    expect(t.crop).toBe("turnip");
    expect(clampStamina(room.save.stamina)).toBe(stamina);
    expect(room.player.entity.act).toMatchObject({ k: "scythe" }); // it still swings
    crop(room, spot.x + 6, spot.y);
    ws.sent = [];
    await use(ws, room, "scythe", spot.x + 6, spot.y);
    expect(ws.last("reject").reason).toBe("Too far away.");
  });

  it("refuses a scythe sweep when too tired, while a hand harvest still works", async () => {
    const { ws, room, spot } = await setup();
    const t = crop(room, spot.x, spot.y);
    room.save.stamina = 1;
    ws.sent = [];
    await use(ws, room, "scythe", spot.x, spot.y);
    expect(ws.last("reject").reason).toMatch(/too tired/);
    expect(t.crop).toBe("turnip");
    await use(ws, room, "seed_turnip", spot.x, spot.y);
    expect(t.crop).toBeNull();
    expect(room.save.stamina).toBe(1);
  });

  it("a hand harvest picks one tile with the standing sweep, stamped at the hand's impact", async () => {
    const { ws, room, spot } = await setup();
    const tiles = [crop(room, spot.x - 1, spot.y), crop(room, spot.x, spot.y), crop(room, spot.x + 1, spot.y)];
    ws.sent = [];
    await use(ws, room, "seed_turnip", spot.x, spot.y);
    expect(tiles.map((t) => t.crop)).toEqual(["turnip", null, "turnip"]);
    expect(room.player.entity.act).toMatchObject({ k: "harvest" });
    expect(ws.last("farm").impactAt - Date.now()).toBe(impactDelayMs("harvest", "down"));
  });
});
