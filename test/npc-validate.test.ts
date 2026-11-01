import { describe, expect, it } from "vitest";
import { validateActions, giftsFor, SAFE_GIFTS } from "../src/worker/npc/actions";
import { interpretJev, buildJevRequest } from "../src/worker/npc/jev";
import { NPCS } from "../src/worker/npc/catalog";
import type { NpcContext } from "../src/worker/npc/brain";

const ctx = (npcId = "odette"): NpcContext => ({
  npc: NPCS[npcId],
  pos: { x: 10, y: 10 },
  memory: [],
  speaker: { id: "u1", name: "Ada" },
  text: "hi",
  nearby: [{ id: "u2", name: "Bo", kind: "player", dist: 3 }],
});

describe("validateActions", () => {
  it("drops non-arrays and unknown kinds", () => {
    expect(validateActions("nope", ctx())).toEqual([]);
    expect(validateActions([{ kind: "teleport" }, null, 5], ctx())).toEqual([]);
  });
  it("only gifts whitelisted items to the speaker, once, capped", () => {
    const out = validateActions(
      [
        { kind: "give", playerId: "u1", item: "gem_crystal", qty: 1 },
        { kind: "give", playerId: "u2", item: "seed_turnip", qty: 1 },
        { kind: "give", playerId: "u1", item: "seed_turnip", qty: 99 },
        { kind: "give", playerId: "u1", item: "seed_carrot", qty: 1 },
      ],
      ctx(),
    );
    expect(out).toEqual([{ kind: "give", playerId: "u1", item: "seed_turnip", qty: SAFE_GIFTS.seed_turnip }]);
  });
  it("rejects fractional, negative and prototype gifts", () => {
    const c = ctx();
    expect(validateActions([{ kind: "give", playerId: "u1", item: "seed_turnip", qty: 0.5 }], c)).toEqual([]);
    expect(validateActions([{ kind: "give", playerId: "u1", item: "seed_turnip", qty: -1 }], c)).toEqual([]);
    expect(validateActions([{ kind: "give", playerId: "u1", item: "__proto__", qty: 1 }], c)).toEqual([]);
  });
  it("NPCs with no gift list can't give", () => {
    expect(giftsFor("marlo")).toEqual([]);
    expect(giftsFor("nobody")).toEqual([]);
  });
  it("bounds walk, follow and targets", () => {
    const out = validateActions(
      [
        { kind: "walk_to", x: 100, y: 100 },
        { kind: "walk_to", x: 12, y: 11 },
        { kind: "follow", targetId: "u2", ms: 1e9 },
        { kind: "face", targetId: "stranger" },
        { kind: "emote", emote: "dance" },
      ],
      ctx(),
    );
    expect(out).toEqual([
      { kind: "walk_to", x: 12, y: 11 },
      { kind: "follow", targetId: "u2", ms: 10_000 },
    ]);
  });
  it("open_shop only for shopkeepers and the speaker", () => {
    expect(validateActions([{ kind: "open_shop", playerId: "u1" }], ctx("bram"))).toEqual([]);
    expect(validateActions([{ kind: "open_shop", playerId: "u2" }], ctx())).toEqual([]);
    expect(validateActions([{ kind: "open_shop", playerId: "u1" }], ctx())).toHaveLength(1);
  });
  it("caps the number of actions", () => {
    expect(validateActions(Array(20).fill({ kind: "idle" }), ctx()).length).toBeLessThanOrEqual(4);
  });
});

describe("Jev", () => {
  it("only offers whitelisted gifts as choices", () => {
    const req = buildJevRequest(ctx(), giftsFor("odette"));
    expect(Object.keys(req.questions)).toEqual(expect.arrayContaining(["intent", "warmth", "reaction", "gift"]));
    expect(buildJevRequest(ctx("marlo"), giftsFor("marlo")).questions.gift).toBeUndefined();
  });
  it("no gift on low confidence or rude intent", () => {
    const base = { warmth: { score: 4 }, gift: { choice: "seed_turnip", confidence: 0.5 } };
    const d = interpretJev({ ...base, intent: { choice: "smalltalk", confidence: 1 } }, ctx(), giftsFor("odette"));
    expect(d?.actions.some((a) => a.kind === "give")).toBe(false);
    const r = interpretJev(
      { intent: { choice: "rude", confidence: 1 }, warmth: { score: 4 }, gift: { choice: "seed_turnip", confidence: 1 } },
      ctx(),
      giftsFor("odette"),
    );
    expect(r?.mood).toBe("annoyed");
    expect(r?.actions.some((a) => a.kind === "give")).toBe(false);
  });
  it("returns null on unusable answers", () => {
    expect(interpretJev(null, ctx(), [])).toBeNull();
    expect(interpretJev({ intent: { choice: 3 } }, ctx(), [])).toBeNull();
  });
});
