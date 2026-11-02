import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NpcRunner, INTERACT_TEXT, type NpcHost } from "../src/worker/game/npcRunner";
import type { NpcMind } from "../src/worker/game/npcMind";
import type { ConverseRequest } from "../src/worker/npc/think/types";
import { getMap } from "../src/shared/maps";
import { buildCollision } from "../src/shared/engine";
import type { EntityState } from "../src/shared/types";
import type { Env } from "../src/worker/env";

function fakeStorage(): DurableObjectStorage {
  const m = new Map<string, unknown>();
  return {
    get: async (k: string | string[]) => (Array.isArray(k) ? new Map(k.filter((x) => m.has(x)).map((x) => [x, m.get(x)])) : m.get(k)),
    put: async (k: string, v: unknown) => void m.set(k, v),
    delete: async (k: string | string[]) => (Array.isArray(k) ? k.filter((x) => m.delete(x)).length : m.delete(k)),
    list: async () => new Map(),
  } as unknown as DurableObjectStorage;
}

interface Setup {
  aiMode?: "on" | "off";
  budget?: boolean;
}

// NPCs follow daily routines: pin the clock to five o'clock, when Bram strolls the village after work.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 10, 1, 17, 0));
});
afterEach(() => vi.useRealTimers());

function setup(o: Setup = {}) {
  const order: string[] = [];
  const requests: { npcId: string; req: ConverseRequest }[] = [];
  const aiRun = vi.fn(async () => ({ response: "model line" }));
  const tryConsume = vi.fn(async () => {
    order.push("budget");
    return o.budget ?? true;
  });
  const env = {
    NPC_MODEL: "m",
    NPC_AI_MODE: o.aiMode ?? "on",
    AI: { run: aiRun },
    AI_BUDGET: { idFromName: () => "id", get: () => ({ tryConsume }) },
  } as unknown as Env;
  const map = getMap("village");
  const bram = map.npcs.find((n) => n.npcId === "bram")!;
  const players: EntityState[] = ["A", "B"].map((n) => ({
    id: `p:${n}`,
    kind: "player",
    name: n === "A" ? "Alice" : "Bob",
    sprite: "x",
    x: bram.x + 1,
    y: bram.y + 1,
    facing: "down",
    moving: false,
  }));
  const chats: string[] = [];
  const host: NpcHost = {
    players: () => players,
    others: () => [],
    chat: (_from, text) => void chats.push(text),
    openShop: () => {},
    give: () => true,
    worldFacts: () => ["The village is still working on: Rebuild the Bridge."],
  };
  const mind: NpcMind = {
    converse: vi.fn(async (npcId, req) => {
      order.push("mind");
      requests.push({ npcId, req });
      return { reply: `Hello ${req.playerName}`, intents: [], source: req.ai ? ("agent" as const) : ("scripted" as const) };
    }),
    receiveGift: vi.fn(async (_npcId, req) => ({ reply: `Thanks for the ${req.item}, ${req.playerName}!`, taste: "loved" as const })),
  };
  const runner = new NpcRunner(map, buildCollision(map), env, fakeStorage(), host, () => 0.5, mind);
  const npc = runner.byEntityId("bram")!;
  const speakers = {
    A: { userId: "userA", entityId: "p:A", name: "Alice" },
    B: { userId: "userB", entityId: "p:B", name: "Bob" },
  };
  async function talk(who: "A" | "B", text: string) {
    const before = chats.length;
    runner.talk(npc, speakers[who], text, Date.now());
    await vi.waitFor(() => expect(chats.length).toBeGreaterThan(before));
    return chats.at(-1)!;
  }
  return { runner, npc, talk, requests, order, aiRun, tryConsume, mind, chats, speakers };
}

describe("NpcRunner + NpcAgent mind", () => {
  it("judges conversation-window replies before answering, and addresses the answer", async () => {
    const s = setup({ aiMode: "off" });
    const host = (s.runner as unknown as { host: NpcHost }).host;
    const judged: string[] = [];
    const said: { text: string; to?: string }[] = [];
    host.judged = (entityId, npcId, verdict) => void judged.push(`${entityId}:${npcId}:${verdict}`);
    host.chat = (_from, text, to) => void said.push({ text, to });
    s.runner.talk(s.npc, s.speakers.A, "thank you, mayor, the oak looks wonderful", Date.now(), { judge: true });
    await vi.waitFor(() => expect(said).toHaveLength(1));
    expect(judged).toEqual(["p:A:bram:good"]);
    expect(said[0]!.to).toBe("p:A");
    // Plain talk (walking up, overheard chat) is never judged.
    await new Promise((r) => setTimeout(r, 0));
    s.runner.talk(s.npc, s.speakers.B, INTERACT_TEXT, Date.now());
    await vi.waitFor(() => expect(said).toHaveLength(2));
    expect(judged).toHaveLength(1);
  });

  it("reserves AiBudget before the agent's model turn", async () => {
    const s = setup({ budget: true });
    expect(await s.talk("A", "tell me about the old days")).toBe("Hello Alice");
    expect(s.order).toEqual(["budget", "mind"]);
    expect(s.requests[0]!.req.ai).toBe(true);
    expect(s.aiRun).not.toHaveBeenCalled(); // the agent owns the model call
  });

  it("never asks for a model turn when the budget says no", async () => {
    const s = setup({ budget: false });
    await s.talk("A", "tell me about the old days");
    expect(s.tryConsume).toHaveBeenCalledTimes(1);
    expect(s.requests[0]!.req.ai).toBe(false);
    expect(s.aiRun).not.toHaveBeenCalled();
  });

  it("skips the budget entirely with NPC_AI_MODE off, but still records memory via the agent", async () => {
    const s = setup({ aiMode: "off" });
    await s.talk("A", INTERACT_TEXT);
    expect(s.tryConsume).not.toHaveBeenCalled();
    expect(s.requests[0]!.req).toMatchObject({ ai: false, playerId: "userA", playerName: "Alice", context: { interact: true } });
    expect(s.requests[0]!.req.context.world).toEqual(["The village is still working on: Rebuild the Bridge."]);
  });

  it("never replays a cached reply for walking up to talk", async () => {
    const s = setup({ budget: true });
    await s.talk("A", INTERACT_TEXT);
    await s.talk("A", INTERACT_TEXT);
    // The greeting text is always the same; a cached line would repeat the first greeting word for word.
    expect(s.requests).toHaveLength(2);
  });

  it("never lets player A's conversation reach player B's context", async () => {
    const s = setup({ budget: true });
    await s.talk("A", "my secret plan is moonberries");
    await s.talk("B", "my secret plan is moonberries"); // same text: the reply cache must not cross players
    const b = s.requests.find((r) => r.req.playerId === "userB")!;
    expect(b).toBeDefined();
    const json = JSON.stringify(b.req);
    expect(json).not.toContain("Alice");
    expect(json).not.toContain("userA");
    expect(s.chats.at(-1)).toBe("Hello Bob");
    // B's turn must not reuse A's personalised cached reply, and B's Jev/legacy memory starts empty.
    expect(s.requests).toHaveLength(2);
  });

  it("validates agent intents before applying them", async () => {
    const s = setup({ budget: true });
    const give = vi.fn(() => true);
    (s.runner as unknown as { host: NpcHost }).host.give = give;
    (s.mind.converse as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      reply: "Take this!",
      intents: [
        { kind: "give_gift", item: "gem_crystal", qty: 5 }, // not Bram's to give
        { kind: "give_gift", item: "wood", qty: 3 },
      ],
      source: "agent",
    });
    await s.talk("A", "what a lovely oak tree");
    expect(give).toHaveBeenCalledTimes(1);
    expect(give).toHaveBeenCalledWith("p:A", "wood", 3);
  });

  it("falls back to a scripted line when the agent fails", async () => {
    const s = setup({ budget: true });
    (s.mind.converse as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("down"));
    const line = await s.talk("A", "tell me about the old days");
    expect(line.length).toBeGreaterThan(0);
    expect(s.aiRun).not.toHaveBeenCalled(); // no second model call on the fallback path
  });

  it("hands player gifts to that player's agent", async () => {
    const s = setup();
    await s.runner.receiveGift(s.npc, s.speakers.A, "pumpkin", Date.now());
    expect(s.mind.receiveGift).toHaveBeenCalledWith("bram", { playerId: "userA", playerName: "Alice", item: "pumpkin" });
    expect(s.chats.at(-1)).toBe("Thanks for the pumpkin, Alice!");
    expect(s.runner.giftedRecently("bram", "userA", Date.now(), 5000)).toBe(true);
    expect(s.runner.giftedRecently("bram", "userB", Date.now(), 5000)).toBe(false);
  });
});
