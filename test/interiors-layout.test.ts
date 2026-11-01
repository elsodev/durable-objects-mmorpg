import { afterEach, describe, expect, it, vi } from "vitest";
import catalog from "../src/client/public/assets/lpc/catalog.json";
import { getMap } from "../src/shared/maps";
import { HOUSE_OWNERS } from "../src/shared/maps/interiors";
import { buildHouse, buildHouseWithSeed, HOUSE_SPECS } from "../src/shared/maps/interiors/houses";
import { seedOf } from "../src/shared/maps/interiors/placer";
import { SEAT_FACING, TABLE_PROPS, WALL_DECOR_PROPS } from "../src/shared/maps/interiors/props";
import { facingStep, floorRect, layoutProblems } from "../src/shared/maps/interiors/rules";
import { columnsBehindTallFurniture } from "../src/shared/maps/interiors/room";
import { buildCollision, canStand, facingFor } from "../src/shared/engine";
import { INTERIOR_ZONES, type EntityState, type MapData, type MapProp } from "../src/shared/types";
import { NpcRunner, SIT_MAX_MS, type NpcHost } from "../src/worker/game/npcRunner";
import { isSitting, SeatBook, standSpots as standSpotsFor } from "../src/worker/game/seats";
import type { Env } from "../src/worker/env";

const propAt = (map: MapData, x: number, y: number): MapProp | undefined =>
  map.props.find((p) => !p.walkable && x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);

/** Layout fingerprint: furniture types at floor-relative positions. */
const fingerprint = (map: MapData) =>
  map.props
    .filter((p) => !p.type.startsWith("iwall_"))
    .map((p) => `${p.type}@${p.x},${p.y}`)
    .sort()
    .join(" ");

describe.each(INTERIOR_ZONES)("layout of %s", (zone) => {
  const map = getMap(zone);

  it("keeps every placement rule", () => {
    expect(layoutProblems(map)).toEqual([]);
  });

  it("every chair and stool touches the table it faces", () => {
    const seats = map.props.filter((p) => SEAT_FACING[p.type]);
    expect(map.seats?.map((s) => s.id).sort()).toEqual(seats.map((p) => p.id).sort());
    for (const s of map.seats ?? []) {
      const [dx, dy] = facingStep(s.facing);
      const t = propAt(map, s.x + dx, s.y + dy);
      expect(t && TABLE_PROPS.has(t.type), `${zone} ${s.id} faces ${s.facing}`).toBe(true);
      const prop = map.props.find((p) => p.id === s.id)!;
      // The sprite says the same: chair above a table faces down, below faces up, and so on.
      if (prop.type !== "bar_stool") expect(prop.type).toBe(`chair_${s.facing}`);
      else expect(t!.type).toBe("bar_counter");
    }
  });

  it("has no window behind a fireplace, wardrobe, shelf or cabinet", () => {
    for (const x of columnsBehindTallFurniture(map)) {
      const piece = map.props.find((p) => p.type.startsWith("iwall_") && p.x === x);
      expect(piece?.type.endsWith("_window"), `${zone} column ${x}`).toBe(false);
    }
  });

  it("uses no rainbow rug", () => {
    expect(map.props.some((p) => p.type === "rug_rainbow")).toBe(false);
  });
});

describe("special seats", () => {
  it("the mayor's chair is behind the desk, facing it", () => {
    const hall = getMap("int_townhall");
    const desk = hall.props.find((p) => p.type === "mayor_desk")!;
    const seat = hall.seats!.find((s) => s.y === desk.y - 1 && s.x >= desk.x && s.x < desk.x + desk.w);
    expect(seat?.facing).toBe("down");
  });

  it("bar stools face the bar", () => {
    const inn = getMap("int_inn");
    const stools = inn.seats!.filter((s) => inn.props.find((p) => p.id === s.id)!.type === "bar_stool");
    expect(stools.length).toBeGreaterThan(0);
    for (const s of stools) expect(s.facing).toBe("up");
  });

  it("the catalog has no rainbow rug", () => {
    expect((catalog as { props: Record<string, unknown> }).props.rug_rainbow).toBeUndefined();
  });
});

describe("furniture placer", () => {
  it("is deterministic: the same seed gives the same room", () => {
    for (const owner of HOUSE_OWNERS) {
      expect(fingerprint(buildHouseWithSeed(owner, 1234))).toBe(fingerprint(buildHouseWithSeed(owner, 1234)));
      expect(fingerprint(buildHouse(owner))).toBe(fingerprint(buildHouseWithSeed(owner, seedOf(`house_${owner}`))));
    }
  });

  it("different seeds give different rooms", () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 10; s++) seen.add(fingerprint(buildHouseWithSeed("odette", s)));
    expect(seen.size).toBeGreaterThan(5);
  });

  it("keeps every rule for 200 random seeds", () => {
    let seed = 0x9e3779b9;
    for (let i = 0; i < 200; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const owner = HOUSE_OWNERS[i % HOUSE_OWNERS.length]!;
      const map = buildHouseWithSeed(owner, seed);
      expect(layoutProblems(map), `${owner} seed ${seed}`).toEqual([]);
      for (const x of columnsBehindTallFurniture(map))
        expect(map.props.some((p) => p.x === x && /^iwall_.*_window$/.test(p.type)), `${owner} seed ${seed} window at ${x}`).toBe(false);
      expect(map.seats!.length).toBeGreaterThan(0);
    }
  });
});

describe("cottages", () => {
  const houses = HOUSE_OWNERS.map((o) => ({ owner: o, map: getMap(`int_house_${o}`) }));

  it("are not copies of each other", () => {
    expect(new Set(houses.map((h) => fingerprint(h.map))).size).toBe(houses.length);
    expect(new Set(houses.map((h) => `${h.map.width}x${h.map.height}`)).size).toBeGreaterThan(4);
    expect(new Set(houses.map((h) => h.map.exits[0]!.x)).size).toBeGreaterThan(4);
  });

  it("hang something on the wall and use the room's own floor and wall art", () => {
    for (const { owner, map } of houses) {
      expect(map.props.some((p) => WALL_DECOR_PROPS.has(p.type)), owner).toBe(true);
      expect(map.interior?.floor, owner).toMatch(/^floor_/);
    }
    expect(new Set(houses.map((h) => h.map.interior!.floor)).size).toBeGreaterThan(2);
  });

  it("put their owners in different spots", () => {
    const spots = houses.map(({ owner, map }) => {
      const n = map.npcs.find((s) => s.npcId === owner)!;
      const f = floorRect(map);
      return `${n.x - f.x},${n.y - f.y}`;
    });
    expect(new Set(spots).size).toBe(houses.length);
  });

  it("hold their owners' things", () => {
    const signature: Record<string, string[]> = {
      marlo: ["fish_crate"],
      iris: ["cauldron", "herb_box"],
      grumm: ["ore_crate", "coal_pile"],
      tess: ["writing_desk", "bookshelf"],
      pip: ["toy_chest"],
      bram: ["writing_desk", "clock"],
      odette: ["produce_basket", "veg_crate"],
      fenwick: ["tool_rack", "chest"],
    };
    for (const { owner, map } of houses)
      for (const t of signature[owner]!) expect(map.props.some((p) => p.type === t), `${owner} has ${t}`).toBe(true);
    expect(Object.keys(signature).sort()).toEqual(Object.keys(HOUSE_SPECS).sort());
  });
});

describe("seats", () => {
  it("one sitter per seat; released when the sitter leaves", () => {
    const book = new SeatBook([
      { id: "a", x: 1, y: 1, facing: "down" },
      { id: "b", x: 2, y: 1, facing: "down" },
    ]);
    expect(book.take("a", "p1")).toBe(true);
    expect(book.take("a", "p2")).toBe(false);
    expect(book.take("b", "p1")).toBe(true); // moving seats frees the old one
    expect(book.isFree("a")).toBe(true);
    book.retain(new Set(["p2"]));
    expect(book.isFree("b")).toBe(true);
  });
});

describe("NPCs indoors", () => {
  afterEach(() => vi.useRealTimers());

  const host: NpcHost = { players: () => [], others: () => [], chat: () => {}, openShop: () => {}, give: () => false };
  const storage = { get: async () => new Map(), list: async () => new Map(), put: async () => {}, delete: async () => 0 };

  function simulate(zone: "int_inn" | "int_house_iris", hour: number) {
    vi.useFakeTimers();
    let now = Date.UTC(2026, 10, 1, hour, 5);
    vi.setSystemTime(now);
    const map = getMap(zone);
    const grid = buildCollision(map);
    let s = 7;
    const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const r = new NpcRunner(map, grid, { NPC_AI_MODE: "off" } as Env, storage as never, host, rand);
    const seatsSeen = new Set<string>();
    let maxSeated = 0;
    // 20 minutes of game time, 200 ms ticks.
    for (let i = 0; i < 6_000; i++) {
      now += 200;
      r.tick(200, now);
      const holders = new Map<string, string>();
      let seated = 0;
      for (const n of r.present()) {
        const e = n.entity;
        if (isSitting(e)) {
          seated++;
          const id = r.seatOf(n)!;
          const seat = map.seats!.find((q) => q.id === id)!;
          expect(e.x).toBe(seat.x + 0.5);
          expect(e.y).toBe(seat.y + 0.5);
          expect(e.facing).toBe(seat.facing);
          expect(holders.has(id)).toBe(false);
          holders.set(id, n.id);
          seatsSeen.add(id);
        } else {
          expect(canStand(grid, e.x, e.y), `${n.id} at ${e.x},${e.y}`).toBe(true);
        }
      }
      maxSeated = Math.max(maxSeated, seated);
    }
    return { seatsSeen, maxSeated };
  }

  it("evening at the inn: villagers sit at the tables, one to a seat, never inside furniture", () => {
    const { seatsSeen, maxSeated } = simulate("int_inn", 19);
    expect(maxSeated).toBeGreaterThanOrEqual(3);
    expect(seatsSeen.size).toBeGreaterThan(3);
  }, 30_000);

  it("at home a villager walks about and sits down now and then", () => {
    const { seatsSeen } = simulate("int_house_iris", 22);
    expect(seatsSeen.size).toBeGreaterThan(0);
  }, 30_000);

  it("a seated NPC stands up beside the chair to talk, faces the speaker, and later carries on", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let now = Date.UTC(2026, 10, 1, 19, 5);
    vi.setSystemTime(now);
    const map = getMap("int_inn");
    const grid = buildCollision(map);
    let s = 7;
    const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const player = { id: "p:A", kind: "player", name: "Alice", sprite: "player_1", x: 0, y: 0, facing: "down", moving: false } as EntityState;
    const talkHost: NpcHost = { ...host, players: () => [player] };
    const r = new NpcRunner(map, grid, { NPC_AI_MODE: "off" } as Env, storage as never, talkHost, rand);
    const tick = (ms: number) => {
      for (let t = 0; t < ms; t += 200) {
        now += 200;
        vi.setSystemTime(now);
        r.tick(200, now);
      }
    };
    let sitter;
    for (let i = 0; i < 600 && !sitter; i++) {
      tick(200);
      sitter = r.present().find((n) => isSitting(n.entity));
    }
    expect(sitter).toBeDefined();
    const seat = map.seats!.find((q) => q.id === r.seatOf(sitter!))!;
    // The player walks up to the side of the table set.
    const spot = standSpotsFor(grid, seat)[0]!;
    Object.assign(player, { x: spot.x + 0.4, y: spot.y + 0.4 });

    r.talk(sitter!, { userId: "uA", entityId: "p:A", name: "Alice" }, "hello", now);
    const e = sitter!.entity;
    expect(isSitting(e)).toBe(false);
    expect(e.act).toBeUndefined();
    expect(r.seats.isFree(seat.id)).toBe(true);
    expect(canStand(grid, e.x, e.y)).toBe(true);
    expect(Math.abs(e.x - (seat.x + 0.5)) + Math.abs(e.y - (seat.y + 0.5))).toBeCloseTo(1, 5);
    await vi.waitFor(() => expect(e.status).not.toBe("..."));
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    expect(e.facing).toBe(facingFor(dx, dy, e.facing));
    expect(Math.hypot(dx, dy)).toBeLessThan(1.5);

    // Holds still facing them for the talk pause...
    const at = { x: e.x, y: e.y };
    tick(4000);
    expect({ x: e.x, y: e.y }).toEqual(at);
    // ...then resumes its routine (walks off or sits down again).
    let resumed = false;
    for (let i = 0; i < 600 && !resumed; i++) {
      tick(200);
      resumed = e.moving || isSitting(e) || e.x !== at.x || e.y !== at.y;
    }
    expect(resumed).toBe(true);
  });

  it("sits for 30 to 90 seconds", () => {
    expect(SIT_MAX_MS).toBe(90_000);
  });
});
