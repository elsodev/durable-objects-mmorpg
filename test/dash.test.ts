// Dashing (Shift + a direction) and being worn out: the shared pace rules, the server Motion and
// energy helpers, and a real HomeRoom draining stamina, slowing the owner, locking farm work and
// resetting it all at the next morning. Client side: fe-dash.test.ts and prediction-sim.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DASH_DRAIN_MS,
  DASH_SPEED,
  EXHAUSTED_NOTICE,
  FARM_LOCKED_NOTICE,
  PLAYER_SPEED,
  RESTED_EATING_NOTICE,
  TIRED_SPEED,
  buildCollision,
  canStand,
  drainDash,
  farmLocked,
  isExhausted,
  paceSpeed,
  pathSpeed,
  pickPace,
} from "../src/shared/engine";
import { Motion } from "../src/worker/game/motion";
import { chargeDash, spendEnergy, type EnergyState } from "../src/worker/game/energy";
import { snapshotEntity } from "../src/worker/game/diff";
import { validateClientMsg } from "../src/shared/validate";
import type { EntityState } from "../src/shared/types";
import { openMap } from "./engine-fixtures";
import { connectOwner, createRooms, sendMsg, type FakeWs, type Rooms } from "./do-harness";

const ent = (x = 3.5, y = 3.5): EntityState => ({ id: "p:me", kind: "player", name: "me", sprite: "player_1", x, y, facing: "down", moving: false });

describe("pace rules", () => {
  it("dash runs 1.8x walk, worn out walks at half speed", () => {
    expect(DASH_SPEED).toBeCloseTo(PLAYER_SPEED * 1.8);
    expect(TIRED_SPEED).toBeCloseTo(PLAYER_SPEED / 2);
    expect(paceSpeed(pickPace({ dash: true, tired: false }))).toBe(DASH_SPEED);
    expect(paceSpeed(pickPace({ dash: false, tired: false }))).toBe(PLAYER_SPEED);
  });

  it("worn out can't dash, and dashing must be allowed", () => {
    expect(pickPace({ dash: true, tired: true })).toBe("tired");
    expect(pickPace({ dash: true, tired: false, canDash: false })).toBe("walk");
    expect(pathSpeed(true)).toBe(TIRED_SPEED);
    expect(pathSpeed(false)).toBe(PLAYER_SPEED);
  });

  it("drains one point per DASH_DRAIN_MS of running, carrying the remainder", () => {
    expect(drainDash(100, 0, DASH_DRAIN_MS * 2.5)).toEqual({ stamina: 98, carryMs: DASH_DRAIN_MS / 2, spent: 2 });
    expect(drainDash(98, DASH_DRAIN_MS / 2, DASH_DRAIN_MS / 2)).toEqual({ stamina: 97, carryMs: 0, spent: 1 });
    expect(drainDash(1, 0, DASH_DRAIN_MS * 10).stamina).toBe(0);
    // Faster than tool work: a second of running costs more than one swing (2).
    expect(1000 / DASH_DRAIN_MS).toBeGreaterThan(2);
  });

  it("worn out means the flag or an empty bar, and it locks farm work only", () => {
    expect(isExhausted(0, undefined)).toBe(true);
    expect(isExhausted(40, true)).toBe(true);
    expect(isExhausted(40, false)).toBe(false);
    for (const e of ["till", "water", "plant", "harvest", "clear"] as const) expect(farmLocked(true, e)).toBe(true);
    for (const e of ["refill", "ship", "hitRock", "hitTree", "hitStump", "hitMonster"] as const) expect(farmLocked(true, e)).toBe(false);
    expect(farmLocked(false, "till")).toBe(false);
  });
});

describe("energy (server)", () => {
  it("dashing to 0 wears the player out once", () => {
    const e: EnergyState = { stamina: 2, exhausted: false, dashCarry: 0 };
    expect(chargeDash(e, DASH_DRAIN_MS - 1)).toBe("none");
    expect(chargeDash(e, 1)).toBe("changed");
    expect(e.stamina).toBe(1);
    expect(chargeDash(e, DASH_DRAIN_MS)).toBe("exhausted");
    expect(e).toMatchObject({ stamina: 0, exhausted: true });
    expect(chargeDash(e, DASH_DRAIN_MS)).toBe("none");
  });

  it("a tool swing that empties the bar wears the player out too", () => {
    const e: EnergyState = { stamina: 3, exhausted: false, dashCarry: 0 };
    expect(spendEnergy(e, 2)).toBe("changed");
    expect(spendEnergy(e, 2)).toBe("exhausted");
    expect(e.stamina).toBe(0);
  });
});

describe("Motion pace", () => {
  const grid = buildCollision(openMap(80, 12), { objects: [], rocks: [] });

  it("a dash moves at DASH_SPEED and counts the time it ran", () => {
    const e = ent();
    const m = new Motion(0);
    m.onMove(e, grid, 1, 0, 1, 0, true);
    m.step(e, grid, 200);
    expect(e.x).toBeCloseTo(3.5 + (DASH_SPEED * 200) / 1000, 6);
    expect(e.pace).toBe("dash");
    expect(m.takeDashMs()).toBe(200);
    expect(m.takeDashMs()).toBe(0);
    // Letting go of Shift walks again.
    m.onMove(e, grid, 1, 0, 2, 200, false);
    m.step(e, grid, 400);
    expect(e.x).toBeCloseTo(3.5 + (DASH_SPEED * 200 + PLAYER_SPEED * 200) / 1000, 6);
    expect(e.pace).toBeUndefined();
    expect(m.takeDashMs()).toBe(0);
  });

  it("worn out: half speed, dash ignored, click-to-move slow too", () => {
    const e = ent();
    const m = Motion.tired();
    m.onMove(e, grid, 1, 0, 1, 0, true);
    m.step(e, grid, 200);
    m.step(e, grid, 400);
    expect(e.x).toBeCloseTo(3.5 + (TIRED_SPEED * 400) / 1000, 6);
    expect(e.pace).toBe("tired");
    expect(m.takeDashMs()).toBe(0);
    m.stop();
    const before = e.x;
    m.onMoveTo(grid, e, 40.5, 3.5, 2, 1000);
    m.step(e, grid, 1200);
    m.step(e, grid, 1400);
    expect(e.x - before).toBeCloseTo((TIRED_SPEED * 400) / 1000, 3);
  });

  it("switching to worn out mid-run keeps the speed of the time already run", () => {
    const e = ent();
    const m = new Motion(0);
    m.onMove(e, grid, 1, 0, 1, 0, true);
    m.setTired(e, grid, true, 100);
    m.step(e, grid, 300);
    expect(e.x).toBeCloseTo(3.5 + (DASH_SPEED * 100 + TIRED_SPEED * 200) / 1000, 6);
    m.setTired(e, grid, false, 300);
    expect(m.isTired).toBe(false);
  });

  it("visitors can't dash", () => {
    const e = ent();
    const m = Object.assign(new Motion(0), { canDash: false });
    m.onMove(e, grid, 1, 0, 1, 0, true);
    m.step(e, grid, 100);
    expect(e.x).toBeCloseTo(3.5 + (PLAYER_SPEED * 100) / 1000, 6);
    expect(m.takeDashMs()).toBe(0);
  });

  it("standing still with Shift held is no dash", () => {
    const e = ent();
    const m = new Motion(0);
    m.onMove(e, grid, 0, 0, 1, 0, true);
    m.step(e, grid, 200);
    expect(e.pace).toBeUndefined();
    expect(m.takeDashMs()).toBe(0);
  });

  it("others see the pace in the entity snapshot", () => {
    expect(snapshotEntity({ ...ent(), pace: "dash" }).pace).toBe("dash");
    expect("pace" in snapshotEntity(ent())).toBe(false);
  });
});

describe("dash intent", () => {
  it("validates the dash flag on held moves only", () => {
    expect(validateClientMsg({ t: "move", dx: 1, dy: 0, seq: 3, dash: true })).toEqual({ t: "move", dx: 1, dy: 0, seq: 3, dash: true });
    expect(validateClientMsg({ t: "move", dx: 0, dy: 0, dash: true })).toEqual({ t: "move", dx: 0, dy: 0 });
    expect(validateClientMsg({ t: "move", dx: 1, dy: 0, dash: false })).toEqual({ t: "move", dx: 1, dy: 0 });
    expect(validateClientMsg({ t: "move", dx: 1, dy: 0, dash: "yes" })).toBeNull();
  });

});

describe("HomeRoom: dash, worn out and the next morning", () => {
  const T0 = 1_700_000_000_000;
  let r: Rooms;
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    vi.spyOn(Math, "random").mockReturnValue(0);
    r = createRooms({ DEV_TOOLS: "on", NPC_AI_MODE: "off" });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** The owner in the yard on a row with 12 free tiles to the right. */
  async function owner(): Promise<{ ws: FakeWs; room: any; p: any }> {
    const ws = await connectOwner(r, "alice", "Alice");
    const room = r.room("alice") as any;
    await r.ctx("alice").ready;
    const p = room.player;
    const grid = room.maps.grids.home;
    for (let y = 4; y < grid.height - 4; y++) {
      for (let x = 4; x < grid.width - 16; x++) {
        let ok = true;
        for (let i = 0; i <= 12 && ok; i++) ok = canStand(grid, x + 0.5 + i, y + 0.5);
        if (ok) {
          p.entity.x = x + 0.5;
          p.entity.y = y + 0.5;
          return { ws, room, p };
        }
      }
    }
    throw new Error("no open row in the yard");
  }

  async function run(ws: FakeWs, ms: number, dash: boolean): Promise<void> {
    await sendMsg(r, "alice", ws, { t: "move", dx: 1, dy: 0, seq: 1, dash });
    vi.advanceTimersByTime(ms);
    await sendMsg(r, "alice", ws, { t: "move", dx: 0, dy: 0, seq: 2 });
  }

  it("dashing drains stamina, and running dry wears the owner out", async () => {
    const { ws, room, p } = await owner();
    const x0 = p.entity.x;
    await run(ws, 1000, true);
    expect(p.entity.x - x0).toBeGreaterThan((PLAYER_SPEED * 1000) / 1000 + 1);
    expect(room.save.stamina).toBeLessThanOrEqual(100 - Math.floor(1000 / DASH_DRAIN_MS) + 1);
    expect(ws.last("homeState").stamina).toBe(room.save.stamina);

    room.save.stamina = 1;
    p.entity.x = x0;
    await run(ws, 1000, true);
    expect(room.save.stamina).toBe(0);
    expect(room.save.exhausted).toBe(true);
    expect(ws.of("notice").map((n) => n.text)).toContain(EXHAUSTED_NOTICE);
    expect(ws.last("homeState")).toMatchObject({ stamina: 0, exhausted: true });

    // Worn out: half walk speed even with Shift held.
    p.entity.x = x0;
    const x1 = p.entity.x;
    await run(ws, 1000, true);
    expect(p.entity.x - x1).toBeCloseTo(TIRED_SPEED, 1);
    expect(p.entity.pace).toBe("tired");
  });

  it("worn out: no farm work, eating doesn't cure it, a new day does", async () => {
    const { ws, room, p } = await owner();
    room.save.stamina = 0;
    room.save.exhausted = true;
    const hoe = room.save.inventory.slots.findIndex((s: any) => s?.item === "hoe");
    expect(hoe).toBeGreaterThanOrEqual(0);
    const tx = Math.floor(p.entity.x) + 1;
    const ty = Math.floor(p.entity.y);
    vi.advanceTimersByTime(300);
    await sendMsg(r, "alice", ws, { t: "use", slot: hoe, x: tx, y: ty });
    expect(ws.last("reject").reason).toBe(FARM_LOCKED_NOTICE);
    expect(room.farm.some((t: any) => t.x === tx && t.y === ty)).toBe(false);

    // Food restores stamina points but not the will to farm.
    room.save.inventory.slots[7] = { item: "carrot", qty: 1 };
    vi.advanceTimersByTime(300);
    await sendMsg(r, "alice", ws, { t: "eat", slot: 7 });
    expect(room.save.stamina).toBeGreaterThan(0);
    expect(room.save.exhausted).toBe(true);
    expect(ws.of("notice").map((n) => n.text)).toContain(RESTED_EATING_NOTICE);
    vi.advanceTimersByTime(300);
    await sendMsg(r, "alice", ws, { t: "use", slot: hoe, x: tx, y: ty });
    expect(ws.last("reject").reason).toBe(FARM_LOCKED_NOTICE);

    // The day resets: rested, full speed, farming again.
    await sendMsg(r, "alice", ws, { t: "chat", text: "/day" });
    expect(room.save.exhausted).toBeUndefined();
    expect(room.save.stamina).toBe(100);
    expect(ws.last("homeState").exhausted).toBeUndefined();
    expect(p.motion.isTired).toBe(false);
  });

  it("a zone can wear the owner out, but never rest them", async () => {
    const room = r.room("alice") as any;
    const save = await room.loadPlayer("alice", "Alice");
    expect(await room.savePlayer({ ...save, stamina: 0, exhausted: true })).toBe(true);
    expect((r.room("alice") as any).save.exhausted).toBe(true);
    expect(await room.savePlayer({ ...save, stamina: 30, exhausted: false })).toBe(true);
    expect((r.room("alice") as any).save.exhausted).toBe(true);
  });
});
