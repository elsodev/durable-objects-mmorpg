import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCollision, canStand, isBlocked, isWaterSource } from "../src/shared/engine";
import { getMap } from "../src/shared/maps";
import { isPondTile, POND_DOCK, pondTiles } from "../src/shared/maps/pond";
import { BUILDING_DOORS } from "../src/shared/maps/interiors";
import { NPC_HANGOUTS, pickStop, roamsOutdoors } from "../src/shared/npcHangouts";
import { NPC_SCHEDULE, npcZoneAt } from "../src/shared/npcSchedule";
import { Ground, OUTDOOR_ZONES, type Hangout, type Seat } from "../src/shared/types";
import { NpcRunner, type NpcHost } from "../src/worker/game/npcRunner";
import { standSpots } from "../src/worker/game/seats";
import type { Env } from "../src/worker/env";

const village = getMap("village");
const grid = buildCollision(village);

describe("village pond", () => {
  it("is water, blocks movement, and only the dock reaches into it", () => {
    const tiles = pondTiles();
    expect(tiles.length).toBeGreaterThan(30);
    for (const t of tiles) {
      expect(village.ground[t.y * village.width + t.x], `${t.x},${t.y}`).toBe(Ground.Water);
      expect(isBlocked(grid, t.x, t.y), `${t.x},${t.y}`).toBe(true);
    }
    for (let x = POND_DOCK.x; x < POND_DOCK.x + POND_DOCK.w; x++) {
      expect(isPondTile(x, POND_DOCK.y)).toBe(true);
      expect(isBlocked(grid, x, POND_DOCK.y), `dock ${x}`).toBe(false);
    }
  });

  it("refills a watering can", () => {
    const [t] = pondTiles();
    expect(isWaterSource(village, t!.x + 0.5, t!.y + 0.5)).toBe(true);
  });

  it("keeps lily pads and reeds in the water flat (they never block the bank)", () => {
    const inWater = village.props.filter((p) => isPondTile(p.x, p.y) && !(p.y === POND_DOCK.y && p.x >= POND_DOCK.x));
    expect(inWater.length).toBeGreaterThan(4);
    for (const p of inWater) expect(p.walkable, p.id).toBe(true);
  });
});

describe("village houses", () => {
  it("each house is its own building type with a door", () => {
    const houses = village.props.filter((p) => p.type.startsWith("house_"));
    expect(new Set(houses.map((h) => h.type)).size).toBe(houses.length);
    expect(houses.length).toBe(8);
    for (const h of houses) {
      const door = village.exits.find((e) => e.to === `int_${h.type}` && e.x >= h.x && e.x < h.x + h.w && e.y === h.y + h.h - 1);
      expect(door, h.id).toBeDefined();
      expect(BUILDING_DOORS.some((d) => d.door.x === door!.x && d.door.y === door!.y), h.id).toBe(true);
    }
  });
});

describe("village seats and hangouts", () => {
  it("has benches round the square and the pond, all on open tiles", () => {
    const seats = village.seats ?? [];
    expect(seats.filter((s) => s.id.startsWith("bench_square")).length).toBe(4);
    expect(seats.filter((s) => s.id.startsWith("bench_pond")).length).toBe(2);
    for (const s of seats) expect(standSpots(grid, s).length, s.id).toBeGreaterThan(0);
  });

  it("puts every hangout on a walkable tile, with each kind a villager likes present", () => {
    const hangouts = village.hangouts ?? [];
    for (const h of hangouts) expect(canStand(grid, h.x + 0.5, h.y + 0.5), h.id).toBe(true);
    const kinds = new Set(hangouts.map((h) => h.kind));
    for (const likes of Object.values(NPC_HANGOUTS))
      for (const k of Object.keys(likes)) if (k !== "seat" && k !== "post") expect(kinds.has(k as Hangout["kind"]), k).toBe(true);
  });
});

describe("pickStop", () => {
  const hangouts: Hangout[] = [
    { id: "fountain_1", kind: "fountain", x: 1, y: 1, face: "up" },
    { id: "garden_1", kind: "garden", x: 2, y: 2, face: "left", owner: "iris" },
    { id: "pond_1", kind: "pond", x: 3, y: 3, face: "up" },
  ];
  const seat: Seat = { id: "bench_1", x: 4, y: 4, facing: "down" };

  it("only sends a villager to its own garden", () => {
    for (let i = 0; i < 20; i++) {
      const r = (i + 0.5) / 20;
      const s = pickStop("bram", hangouts, [seat], () => r);
      if (s?.kind === "hangout") expect(s.hangout.owner).toBeUndefined();
    }
    const iris = Array.from({ length: 20 }, (_, i) => pickStop("iris", hangouts, [], () => (i + 0.5) / 20));
    expect(iris.some((s) => s?.kind === "hangout" && s.hangout.id === "garden_1")).toBe(true);
  });

  it("skips busy spots and benches when none are free", () => {
    const picks = Array.from({ length: 20 }, (_, i) =>
      pickStop("marlo", hangouts, [], () => (i + 0.5) / 20, new Set(["pond_1"])),
    );
    expect(picks.every((s) => s === null)).toBe(true);
    expect(pickStop("odette", hangouts, [seat], () => 0.3)).toBeNull();
    expect(roamsOutdoors("odette")).toBe(false);
  });
});

describe("daytime schedule", () => {
  it("keeps villagers outdoors through the day and indoors at night", () => {
    // Indoor exceptions: the mayor's paperwork after lunch, and the innkeeper's lunch rush.
    const indoorsOk = (id: string, h: number) => (id === "bram" && h >= 13 && h < 16) || (id === "rue" && (h < 15 || h >= 17) && h >= 12);
    for (let h = 9; h < 17; h++) {
      for (const id of Object.keys(NPC_SCHEDULE)) {
        const z = npcZoneAt(id, h)!;
        if (!indoorsOk(id, h)) expect((OUTDOOR_ZONES as readonly string[]).includes(z), `${id}@${h} in ${z}`).toBe(true);
      }
    }
    for (const id of Object.keys(NPC_SCHEDULE)) expect(npcZoneAt(id, 23)!.startsWith("int_"), `${id}@23`).toBe(true);
  });
});

describe("village NPC runner", () => {
  afterEach(() => vi.useRealTimers());
  const host: NpcHost = { players: () => [], others: () => [], chat: () => {}, openShop: () => {}, give: () => false };
  const storage = { get: async () => new Map(), list: async () => new Map(), put: async () => {}, delete: async () => 0 };

  it("walks roaming villagers away from their spawn to benches and hangouts", () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 10, 1, 10, 0);
    vi.setSystemTime(start);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const r = new NpcRunner(village, grid, { NPC_AI_MODE: "off" } as Env, storage as never, host, rand);
    const spots = [...(village.hangouts ?? []), ...(village.seats ?? [])];
    const visited = new Set<string>();
    let sat = false;
    for (let t = 0; t < 20 * 60 * 10; t++) {
      const now = start + t * 100;
      r.tick(100, now);
      for (const n of r.present()) {
        if (!roamsOutdoors(n.id)) continue;
        if (r.seatOf(n)) sat = true;
        for (const s of spots) if (Math.hypot(n.entity.x - (s.x + 0.5), n.entity.y - (s.y + 0.5)) < 1.2) visited.add(s.id);
      }
    }
    expect(sat).toBe(true);
    expect(visited.size).toBeGreaterThan(4);
    for (const n of r.present()) if (roamsOutdoors(n.id) && !r.seatOf(n)) expect(canStand(grid, n.entity.x, n.entity.y), `${n.id} at ${n.entity.x},${n.entity.y}`).toBe(true);
  });
});
