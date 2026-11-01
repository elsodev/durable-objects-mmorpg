import { describe, expect, it } from "vitest";
import { classify, ruleDecision } from "../src/worker/npc/rules";
import { decideWith, idleLine, estimateUnits, type NpcContext } from "../src/worker/npc/brain";
import { NPCS, getNpc } from "../src/worker/npc/catalog";
import { getItem } from "../src/shared/items";
import type { JevClient } from "../src/worker/npc/jev";

function ctx(npcId: string, text: string): NpcContext {
  return {
    npc: NPCS[npcId],
    pos: { x: 10, y: 10 },
    memory: [],
    speaker: { id: "u1", name: "Ada" },
    text,
    nearby: [{ id: "u1", name: "Ada", kind: "player", dist: 1 }],
  };
}

describe("catalog", () => {
  const sprites = ["villager_old", "villager_woman", "smith", "villager_woman2", "kid", "fisher", "monk", "villager_woman3", "miner", "explorer"];
  it("has the 10 NPCs with the right sprites and zones", () => {
    expect(Object.keys(NPCS)).toEqual(["bram", "odette", "fenwick", "rue", "pip", "marlo", "sable", "iris", "grumm", "tess"]);
    expect(Object.values(NPCS).map((n) => n.sprite)).toEqual(sprites);
    expect(NPCS.marlo.zone).toBe("riverside");
    expect(NPCS.tess.zone).toBe("caves");
  });
  it("has >=3 lines per intent, idle and thinking_fail", () => {
    const keys = ["greet", "buy", "sell", "quest", "ask_info", "smalltalk", "rude", "goodbye", "idle", "thinking_fail"] as const;
    for (const n of Object.values(NPCS)) for (const k of keys) expect(n.lines[k]?.length ?? 0, `${n.id}.${k}`).toBeGreaterThanOrEqual(3);
  });
  it("shops use only real items", () => {
    for (const n of Object.values(NPCS)) {
      if (!n.shop) continue;
      for (const o of n.shop.sells) expect(getItem(o.item), o.item).toBeDefined();
      for (const id of n.shop.buys) expect(getItem(id), id).toBeDefined();
    }
    expect(NPCS.fenwick.shop?.sells.map((o) => o.item)).toEqual(expect.arrayContaining(["pickaxe_iron", "sword_copper"]));
    expect(NPCS.marlo.shop?.buys).toContain("fish_trout");
    expect(NPCS.iris.shop?.buys).toContain("slime_gel");
  });
  it("getNpc ignores prototype keys", () => {
    expect(getNpc("__proto__")).toBeUndefined();
    expect(getNpc("bram")?.name).toBe("Bram");
  });
});

describe("classify", () => {
  it.each([
    ["hello there", "greet"],
    ["what do you sell?", "buy"],
    ["can I see your shop", "buy"],
    ["buy my fish please", "sell"],
    ["I want to sell turnips", "sell"],
    ["you are an idiot", "rude"],
    ["bye!", "goodbye"],
    ["how do I fix the bridge?", "quest"],
    ["tell me about the lantern", "ask_info"],
    ["nice weather today", "smalltalk"],
  ])("%s -> %s", (text, intent) => {
    expect(classify(text).intent).toBe(intent);
  });
  it("matches whole words only", () => {
    expect(classify("this is a shipment").intent).not.toBe("greet");
  });
});

describe("decide", () => {
  const never: (k: string) => JevClient = () => ({ systemOne: () => new Promise(() => {}) });
  it("shop words open the shop for shopkeepers", async () => {
    const d = await decideWith(ctx("odette", "show me your seeds for sale"), { NPC_MODEL: "m", TYPESAFE_API_KEY: "k" }, never);
    expect(d.source).toBe("rules");
    expect(d.actions).toContainEqual({ kind: "open_shop", playerId: "u1" });
  });
  it("non-shop NPCs never open a shop", () => {
    const d = ruleDecision(ctx("bram", "buy"), "buy", "rules");
    expect(d.actions.some((a) => a.kind === "open_shop")).toBe(false);
  });
  it("uses Jev for unclear text and maps answers", async () => {
    const client = () => ({
      systemOne: async () => ({
        answers: {
          intent: { choice: "smalltalk", confidence: 0.9 },
          warmth: { score: 4 },
          reaction: { choice: "love", confidence: 0.9 },
          gift: { choice: "seed_turnip", confidence: 0.95 },
        },
      }),
    });
    const d = await decideWith(ctx("odette", "your garden is lovely"), { NPC_MODEL: "m", TYPESAFE_API_KEY: "k" }, client);
    expect(d.source).toBe("jev");
    expect(d.mood).toBe("happy");
    expect(d.actions).toContainEqual({ kind: "emote", emote: "love" });
    expect(d.actions).toContainEqual({ kind: "give", playerId: "u1", item: "seed_turnip", qty: 1 });
  });
  it("falls back to rules when Jev errors or answers garbage", async () => {
    const bad = () => ({ systemOne: async () => ({ answers: { intent: { choice: "launch_missiles" } } }) });
    const d = await decideWith(ctx("bram", "your garden is lovely"), { NPC_MODEL: "m", TYPESAFE_API_KEY: "k" }, bad);
    expect(d.source).toBe("fallback");
    const boom = () => ({ systemOne: async () => { throw new Error("x"); } });
    expect((await decideWith(ctx("bram", "lovely day"), { NPC_MODEL: "m", TYPESAFE_API_KEY: "k" }, boom)).source).toBe("fallback");
  });
  it("skips Jev when AI is off or no key", async () => {
    let called = false;
    const spy = () => ({ systemOne: async () => { called = true; return { answers: {} }; } });
    await decideWith(ctx("bram", "lovely day"), { NPC_MODEL: "m", NPC_AI_MODE: "off", TYPESAFE_API_KEY: "k" }, spy);
    await decideWith(ctx("bram", "lovely day"), { NPC_MODEL: "m" }, spy);
    expect(called).toBe(false);
  });
});

describe("idleLine / estimateUnits", () => {
  it("is quiet most of the time and speaks a scripted idle line otherwise", () => {
    expect(idleLine(NPCS.bram, () => 0.99)).toBeNull();
    expect(NPCS.bram.lines.idle).toContain(idleLine(NPCS.bram, () => 0));
  });
  it("estimates positive units", () => {
    expect(estimateUnits("speak")).toBeGreaterThan(0);
    expect(estimateUnits("jev")).toBeGreaterThan(0);
  });
});
