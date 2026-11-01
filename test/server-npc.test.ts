import { describe, expect, it } from "vitest";
import { AI_REPLY_INTERVAL_MS, NpcGate, normalizeText, REPLY_CACHE_MS, utcDay } from "../src/worker/game/npcGate";
import { MAX_FOLLOW_MS, sanitizeActions, type ActionScope } from "../src/worker/game/npcActions";
import { CoalescingSaver } from "../src/worker/game/saver";
import { Motion } from "../src/worker/game/motion";
import { RockField } from "../src/worker/game/rockField";
import { buildCollision, isBlocked } from "../src/shared/engine";
import { getMap } from "../src/shared/maps";
import type { EntityState } from "../src/shared/types";
import { openMap } from "./engine-fixtures";

describe("NpcGate", () => {
  it("allows one conversation in flight per NPC", () => {
    const g = new NpcGate();
    expect(g.begin("bram")).toBe(true);
    expect(g.begin("bram")).toBe(false);
    expect(g.begin("odette")).toBe(true);
    g.end("bram");
    expect(g.begin("bram")).toBe(true);
  });
  it("limits AI replies per player per NPC to one per 10 s", () => {
    const g = new NpcGate();
    expect(g.allowAi("u1", "bram", 0)).toBe(true);
    expect(g.allowAi("u1", "bram", AI_REPLY_INTERVAL_MS - 1)).toBe(false);
    expect(g.allowAi("u1", "odette", 1)).toBe(true);
    expect(g.allowAi("u2", "bram", 1)).toBe(true);
    expect(g.allowAi("u1", "bram", AI_REPLY_INTERVAL_MS)).toBe(true);
  });
  it("caches replies by NPC and normalized text for 10 minutes", () => {
    const g = new NpcGate();
    g.remember("bram", "Hello there!", { line: "Hi!", intent: "greet", at: 0 });
    expect(g.cached("bram", "hello there", 1000)?.line).toBe("Hi!");
    expect(g.cached("odette", "hello there", 1000)).toBeNull();
    expect(g.cached("bram", "hello there", REPLY_CACHE_MS + 1)).toBeNull();
  });
  it("normalizes text and formats days", () => {
    expect(normalizeText("  Hi,   THERE!! ")).toBe("hi there");
    expect(utcDay(0)).toBe("1970-01-01");
  });
});

describe("sanitizeActions", () => {
  const scope: ActionScope = { speakerId: "p:u1", home: { x: 10, y: 10 }, leash: 5, hasShop: true, giftAllowed: true };
  it("only targets the speaker and clamps walking and following", () => {
    const out = sanitizeActions(
      [
        { kind: "face", targetId: "p:other" },
        { kind: "open_shop", playerId: "p:other" },
        { kind: "walk_to", x: 100, y: 10 },
        { kind: "follow", targetId: "p:u1", ms: 1e9 },
        { kind: "teleport", x: 1 },
      ],
      scope,
    );
    expect(out).toEqual([
      { kind: "walk_to", x: 15, y: 10 },
      { kind: "follow", targetId: "p:u1", ms: MAX_FOLLOW_MS },
    ]);
  });
  it("allows at most one small, cheap gift", () => {
    const out = sanitizeActions(
      [
        { kind: "give", playerId: "p:u1", item: "pickaxe_iron", qty: 1 },
        { kind: "give", playerId: "p:u1", item: "gem_crystal", qty: 1 },
        { kind: "give", playerId: "p:u1", item: "turnip", qty: 50 },
        { kind: "give", playerId: "p:u1", item: "turnip", qty: 1 },
      ],
      scope,
    );
    expect(out).toEqual([{ kind: "give", playerId: "p:u1", item: "turnip", qty: 3 }]);
    expect(sanitizeActions([{ kind: "give", playerId: "p:u1", item: "turnip", qty: 1 }], { ...scope, giftAllowed: false })).toEqual([]);
  });
  it("drops open_shop for NPCs without a shop and caps the action count", () => {
    expect(sanitizeActions([{ kind: "open_shop", playerId: "p:u1" }], { ...scope, hasShop: false })).toEqual([]);
    expect(sanitizeActions(Array(10).fill({ kind: "idle" }), scope)).toHaveLength(4);
    expect(sanitizeActions("nope", scope)).toEqual([]);
  });
});

describe("CoalescingSaver", () => {
  it("keeps one write in flight and sends the latest snapshot", async () => {
    const written: number[] = [];
    let release: (() => void) | null = null;
    const s = new CoalescingSaver<number>(
      (v) =>
        new Promise((resolve) => {
          written.push(v);
          release = () => resolve(true);
        }),
    );
    let state = 1;
    const a = s.request(() => state);
    state = 2;
    const b = s.request(() => state);
    state = 3;
    const c = s.request(() => state);
    release!();
    expect(await a).toBe("saved");
    await Promise.resolve();
    release!();
    expect(await b).toBe("saved");
    expect(await c).toBe("saved");
    expect(written).toEqual([1, 3]);
    expect(s.busy).toBe(false);
  });
  it("reports stale leases and errors", async () => {
    expect(await new CoalescingSaver<number>(async () => false).request(() => 1)).toBe("stale");
    expect(
      await new CoalescingSaver<number>(async () => {
        throw new Error("down");
      }).request(() => 1),
    ).toBe("error");
  });
});

describe("Motion", () => {
  const ent = (): EntityState => ({ id: "p:1", kind: "player", name: "A", sprite: "player_1", x: 2.5, y: 2.5, facing: "down", moving: false });
  it("moves by held direction and acks the seq", () => {
    const grid = buildCollision(openMap(10, 10));
    const m = new Motion();
    const e = ent();
    m.onMove(1, 0, 7);
    expect(m.step(e, grid, 100)).toBe(7);
    expect(e.x).toBeGreaterThan(2.5);
    expect(e.moving).toBe(true);
  });
  it("follows a path to the clicked point and throttles moveTo", () => {
    const grid = buildCollision(openMap(10, 10));
    const m = new Motion();
    const e = ent();
    expect(m.onMoveTo(grid, e, 5.2, 2.5, 1, 0)).toBe(true);
    expect(m.onMoveTo(grid, e, 6, 2.5, 2, 50)).toBe(false);
    for (let i = 0; i < 20; i++) m.step(e, grid, 100);
    expect(e.x).toBeCloseTo(5.2, 1);
    expect(m.path).toBeNull();
  });
});

describe("RockField", () => {
  it("breaks, unblocks and respawns rocks unless occupied", () => {
    const map = getMap("home");
    const field = new RockField(map);
    const grid = buildCollision(map, { rocks: field.load(undefined) });
    const rock = field.rocks[0];
    expect(isBlocked(grid, rock.x, rock.y)).toBe(true);
    field.breakRock(rock, grid, 0);
    expect(field.at(rock.x, rock.y)).toBeNull();
    expect(isBlocked(grid, rock.x, rock.y)).toBe(false);
    const due = field.broken.get(rock.id)!;
    expect(field.respawnDue(grid, due - 1, [])).toEqual([]);
    expect(field.respawnDue(grid, due, [{ x: rock.x + 0.5, y: rock.y + 0.5 }])).toEqual([]);
    expect(field.respawnDue(grid, due, [])).toEqual([rock.id]);
    expect(isBlocked(grid, rock.x, rock.y)).toBe(true);
    expect(field.load({ [rock.id]: 5, bogus: 1 }).length).toBe(field.rocks.length - 1);
  });
});
