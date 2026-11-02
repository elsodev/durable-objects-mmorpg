import { describe, expect, it } from "vitest";
import { FAR_EVERY_TICKS, NEAR_TILES, PlayerInterest } from "../src/worker/game/interest";
import { copyName, copyOrder, copyTitle, hasRoom, MAX_COPIES, parseCopy, ZONE_CAP } from "../src/shared/zoneCopies";
import { wsUrl } from "../src/client/net/url";
import type { EntityState } from "../src/shared/types";

const ent = (id: string, x: number, y: number): EntityState => ({ id, kind: "player", name: id, sprite: "player_1", x, y, facing: "down", moving: true });
const loc = { protocol: "https:", host: "game.test" };

describe("zone copies", () => {
  it("keeps the original object's name and numbers the rest", () => {
    expect(copyName("village", 1)).toBe("village");
    expect(copyName("village", 3)).toBe("village~3");
    expect(copyTitle("Mossbrook Village", undefined)).toBe("Mossbrook Village");
    expect(copyTitle("Mossbrook Village", 2)).toBe("Mossbrook Village · 2");
  });

  it("takes 60 players per copy, counting joins still loading", () => {
    expect(ZONE_CAP).toBe(60);
    expect(hasRoom(59, 0)).toBe(true);
    expect(hasRoom(60, 0)).toBe(false);
    expect(hasRoom(58, 2)).toBe(false);
  });

  it("tries the asked-for copy first, then lowest first", () => {
    expect(copyOrder(null)).toEqual(Array.from({ length: MAX_COPIES }, (_, i) => i + 1));
    expect(copyOrder(3).slice(0, 3)).toEqual([3, 1, 2]);
    expect(parseCopy("2")).toBe(2);
    for (const bad of ["0", "-1", "99", "x", "", null]) expect(parseCopy(bad)).toBeNull();
  });

  it("asks to rejoin the same copy only for shared zones", () => {
    expect(wsUrl(loc, "village", undefined, undefined, 2)).toBe("wss://game.test/ws/village?copy=2");
    expect(wsUrl(loc, "village", "from_home", undefined, 2)).toBe("wss://game.test/ws/village?spawn=from_home&copy=2");
    expect(wsUrl(loc, "village", undefined, undefined, 1)).toBe("wss://game.test/ws/village");
    expect(wsUrl(loc, "home", undefined, "owner1", 2)).toBe("wss://game.test/ws/visit/owner1");
  });
});

describe("interest", () => {
  const me = { x: 10, y: 10 };

  it("sends near changes every tick and holds far ones", () => {
    const i = new PlayerInterest(1);
    const out = i.filter([ent("near", 12, 12), ent("far", 10 + NEAR_TILES + 5, 10)], [], me, 0);
    expect(out.upd.map((e) => e.id)).toEqual(["near"]);
    expect(i.waiting()).toBe(1);
  });

  it("flushes far changes on this player's beat, newest only", () => {
    const i = new PlayerInterest(0);
    i.filter([ent("far", 60, 10)], [], me, 1);
    i.filter([ent("far", 61, 10)], [], me, 2);
    expect(i.waiting()).toBe(1);
    const out = i.filter([], [], me, FAR_EVERY_TICKS);
    expect(out.upd).toEqual([ent("far", 61, 10)]);
    expect(i.waiting()).toBe(0);
  });

  it("sends a held change as soon as its entity is near, and removals at once", () => {
    const i = new PlayerInterest(0);
    i.filter([ent("far", 60, 10)], [], me, 1);
    expect(i.filter([], [], { x: 55, y: 10 }, 2).upd.map((e) => e.id)).toEqual(["far"]);
    i.filter([ent("gone", 80, 10)], [], me, 3);
    const out = i.filter([], ["gone"], me, 4);
    expect(out.del).toEqual(["gone"]);
    expect(i.waiting()).toBe(0);
  });

  it("cuts what a crowded zone sends each player", () => {
    // 60 players spread over a big map: each one gets far fewer entities per tick.
    const crowd = Array.from({ length: 60 }, (_, k) => ent(`p${k}`, (k % 10) * 12, Math.floor(k / 10) * 12));
    let sent = 0;
    for (const p of crowd) sent += new PlayerInterest(0).filter(crowd, [], p, 1).upd.length;
    expect(sent).toBeLessThan(60 * 60 * 0.6);
  });
});
