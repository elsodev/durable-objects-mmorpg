import { afterEach, describe, expect, it, vi } from "vitest";
import { keptStall, STALL_KEEPERS, stallKeeper, stallKeeperSpot } from "../src/shared/stalls";
import { atWork, npcZoneAt, onShift } from "../src/shared/npcSchedule";
import { getMap } from "../src/shared/maps";
import { buildCollision } from "../src/shared/engine";
import { NpcRunner, type NpcHost } from "../src/worker/game/npcRunner";
import { NPCS } from "../src/worker/npc/catalog";
import { STALL_SHOPS } from "../src/worker/game/shop";
import type { Env } from "../src/worker/env";

const host: NpcHost = { players: () => [], others: () => [], chat: () => {}, openShop: () => {}, give: () => false };
const storage = { get: async () => new Map(), list: async () => new Map(), put: async () => {}, delete: async () => 0 };
const at = (h: number) => Date.UTC(2026, 10, 1, h, 15);

afterEach(() => vi.useRealTimers());

describe("market stall keepers", () => {
  it("the furniture and bakery stalls each have a keeper with that stall's goods", () => {
    expect(stallKeeper("stall_goods")).toBe("jory");
    expect(stallKeeper("stall_bakery")).toBe("wren");
    expect(stallKeeper("stall_produce")).toBe("odette");
    expect(stallKeeper("toString")).toBeNull();
    expect(keptStall("jory")).toBe("stall_goods");
    expect(keptStall("rue")).toBeNull();
    expect(NPCS.jory!.shop!.sells).toEqual(STALL_SHOPS.stall_goods!.shop.sells);
    expect(NPCS.wren!.shop!.sells).toEqual(STALL_SHOPS.stall_bakery!.shop.sells);
  });

  it("each keeper stands inside their stall's footprint, on the art's keeper point", () => {
    const map = getMap("village");
    for (const [stallId, keeper] of Object.entries(STALL_KEEPERS)) {
      const stall = map.props.find((p) => p.id === stallId)!;
      const spawn = map.npcs.find((n) => n.npcId === keeper)!;
      const spot = stallKeeperSpot(stall);
      expect(spawn, keeper).toBeDefined();
      // The zone stands an NPC half a tile on from its spawn point.
      const feet = { x: spawn.x + 0.5, y: spawn.y + 0.5 };
      expect(feet).toEqual(spot);
      expect(feet.x).toBe(stall.x + stall.w / 2);
      expect(feet.y).toBeGreaterThanOrEqual(stall.y);
      expect(feet.y).toBeLessThan(stall.y + stall.h);
      // They stay put behind the counter.
      expect(spawn.wander).toBe(0);
    }
  });

  it("keepers work the stalls 08-18 and spend the evening and night indoors", () => {
    for (const id of ["wren", "jory"]) {
      expect(onShift(id, 7)).toBe(false);
      expect(onShift(id, 8)).toBe(true);
      expect(onShift(id, 17)).toBe(true);
      expect(onShift(id, 18)).toBe(false);
      expect(atWork(id, "village", 12)).toBe(true);
      expect(npcZoneAt(id, 12)).toBe("village");
      expect(npcZoneAt(id, 19)).toBe("int_inn");
    }
    expect(npcZoneAt("wren", 23)).toBe("int_inn");
    expect(npcZoneAt("jory", 23)).toBe("int_smithy");
  });

  it("by day the keepers are at their post behind the stall; at night they're gone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(12));
    const map = getMap("village");
    const village = new NpcRunner(map, buildCollision(map), { NPC_AI_MODE: "off" } as Env, storage as never, host, () => 0.5);
    for (const id of ["wren", "jory", "odette"]) {
      const n = village.byEntityId(`n:${id}`)!;
      expect(n, id).toBeDefined();
      expect(village.atPost(n, at(12))).toBe(true);
    }
    village.tick(100, at(21));
    expect(village.byEntityId("n:wren")).toBeUndefined();
    expect(village.byEntityId("n:jory")).toBeUndefined();
  });
});
