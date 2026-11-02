import { describe, expect, it } from "vitest";
import { ENGAGED_MS, faceViewer, facingTarget, facingToward, FACE_RANGE } from "../src/client/game/npc-facing-logic";
import type { EntityState } from "../src/shared/types";

const npc = (over: Partial<EntityState> = {}): EntityState => ({
  id: "n:odette",
  kind: "npc",
  name: "Odette",
  sprite: "villager_woman",
  x: 10.5,
  y: 10.5,
  facing: "left",
  moving: false,
  ...over,
});

describe("per-viewer NPC facing", () => {
  it("faces along the larger gap", () => {
    expect(facingToward({ x: 0, y: 0 }, { x: 0, y: 2 })).toBe("down");
    expect(facingToward({ x: 0, y: 0 }, { x: 0, y: -2 })).toBe("up");
    expect(facingToward({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe("right");
    expect(facingToward({ x: 0, y: 0 }, { x: -3, y: -1 })).toBe("left");
    expect(facingToward({ x: 0, y: 0 }, { x: 0, y: 0 }, "up")).toBe("up");
  });

  it("four players around one villager each see it facing themselves", () => {
    const server = [npc({ facing: "left" })];
    const players = { south: { x: 10.5, y: 12 }, north: { x: 10.5, y: 9 }, east: { x: 12.5, y: 10.5 }, west: { x: 8.5, y: 10.6 } };
    const seen = Object.fromEntries(Object.entries(players).map(([k, me]) => [k, faceViewer(server, "n:odette", me)[0]!.facing]));
    expect(seen).toEqual({ south: "down", north: "up", east: "right", west: "left" });
    // The shared state is never changed.
    expect(server[0]!.facing).toBe("left");
  });

  it("someone not talking to the villager sees the server's facing", () => {
    const list = [npc({ facing: "left" })];
    expect(faceViewer(list, null, { x: 10.5, y: 12 })).toBe(list);
    expect(faceViewer(list, "n:bram", { x: 10.5, y: 12 })).toBe(list);
  });

  it("leaves a walking, seated or far-off villager, and other entities, alone", () => {
    const me = { x: 10.5, y: 12 };
    expect(faceViewer([npc({ moving: true })], "n:odette", me)[0]!.facing).toBe("left");
    expect(faceViewer([npc({ act: { k: "sit", at: 0 } })], "n:odette", me)[0]!.facing).toBe("left");
    expect(faceViewer([npc()], "n:odette", { x: 10.5, y: 10.5 + FACE_RANGE + 0.5 })[0]!.facing).toBe("left");
    expect(faceViewer([npc({ kind: "player" })], "n:odette", me)[0]!.facing).toBe("left");
  });

  it("targets the open conversation, else a shop opened a moment ago", () => {
    expect(facingTarget("n:rue", { id: "n:odette", at: 0 }, 10)).toBe("n:rue");
    expect(facingTarget(null, { id: "n:odette", at: 1000 }, 1000 + ENGAGED_MS - 1)).toBe("n:odette");
    expect(facingTarget(null, { id: "n:odette", at: 1000 }, 1000 + ENGAGED_MS)).toBeNull();
    expect(facingTarget(null, null, 0)).toBeNull();
  });
});
