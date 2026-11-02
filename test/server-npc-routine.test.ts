import { afterEach, describe, expect, it, vi } from "vitest";
import { NpcRunner, type NpcHost } from "../src/worker/game/npcRunner";
import { buildCollision } from "../src/shared/engine";
import { getMap } from "../src/shared/maps";
import type { SharedZoneId } from "../src/shared/types";
import type { Env } from "../src/worker/env";

const host: NpcHost = { players: () => [], others: () => [], chat: () => {}, openShop: () => {}, give: () => false };
const storage = { get: async () => new Map(), list: async () => new Map(), put: async () => {}, delete: async () => 0 };

function runner(zone: SharedZoneId): NpcRunner {
  const map = getMap(zone);
  return new NpcRunner(map, buildCollision(map), { NPC_AI_MODE: "off" } as Env, storage as never, host, () => 0.5);
}
const at = (h: number) => Date.UTC(2026, 10, 1, h, 15);
const ids = (r: NpcRunner) => r.entities().map((e) => e.id).sort();

afterEach(() => vi.useRealTimers());

describe("NPC routines in zone rooms", () => {
  it("each room shows only the NPCs whose routine puts them there", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(19));
    const village = runner("village");
    const inn = runner("int_inn");
    const smithy = runner("int_smithy");
    expect(ids(village)).toEqual([]);
    // Odette goes home early to her window boxes.
    expect(ids(inn)).toEqual(["n:bram", "n:grumm", "n:iris", "n:jory", "n:marlo", "n:pip", "n:rue", "n:wren"]);
    expect(ids(smithy)).toEqual(["n:fenwick"]);
    expect(village.byEntityId("n:odette")).toBeUndefined();
    expect(village.present()).toHaveLength(0);
  });

  it("moves NPCs between rooms as the hour changes, without messages between rooms", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(17));
    const village = runner("village");
    const inn = runner("int_inn");
    expect(ids(village)).toContain("n:odette");
    expect(ids(inn)).toEqual(["n:rue"]);
    village.tick(100, at(18));
    inn.tick(100, at(18));
    expect(ids(village)).not.toContain("n:odette");
    expect(ids(inn)).toContain("n:odette");
    // Arriving NPCs appear at their spot in this room's map.
    const spot = getMap("int_inn").npcs.find((n) => n.npcId === "odette")!;
    const odette = inn.byEntityId("n:odette")!;
    expect([odette.entity.x, odette.entity.y]).toEqual([spot.x + 0.5, spot.y + 0.5]);
  });

  it("an hour offset (dev /hour) shifts the routine", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(12));
    const house = runner("int_house_bram");
    expect(ids(house)).toEqual([]);
    house.setHourOffset(12, at(12)); // midnight
    expect(house.hour(at(12))).toBe(0);
    expect(ids(house)).toEqual(["n:bram"]);
  });
});
