import { describe, expect, it } from "vitest";
import { generateText, stepCountIs } from "ai";
import { intentsToActions, npcTools, validateIntents } from "../src/worker/npc/think/tools";
import { sanitizeActions } from "../src/worker/game/npcActions";
import { placeTarget } from "../src/worker/game/npcPlaces";
import { getMap } from "../src/shared/maps";
import { fakeNpcModel } from "./npc-fake-model";

const scope = { npcId: "odette" as const, playerId: "u1" };

describe("validateIntents", () => {
  it("keeps only intents within the NPC's powers and the pair's player", () => {
    const out = validateIntents(
      [
        { kind: "give_gift", item: "gem_crystal", qty: 1 }, // not Odette's to give
        { kind: "give_gift", item: "seed_turnip", qty: 50 },
        { kind: "give_gift", item: "seed_carrot", qty: 1 }, // second gift: dropped
        { kind: "remember", playerId: "someone_else", fact: "likes cake" },
        { kind: "remember", playerId: "u1", fact: "wants to grow a giant pumpkin" },
        { kind: "walk_to", placeId: "moon" },
        { kind: "set_mood", mood: "furious" },
        { kind: "teleport" },
        { kind: "suggest_quest", goal: "fair" },
        { kind: "open_shop" },
      ],
      scope,
    );
    expect(out).toEqual([
      { kind: "give_gift", item: "seed_turnip", qty: 2 },
      { kind: "remember", playerId: "u1", fact: "wants to grow a giant pumpkin" },
      { kind: "suggest_quest", goal: "fair" },
      { kind: "open_shop" },
    ]);
  });
  it("drops open_shop for NPCs without a shop and junk input", () => {
    expect(validateIntents([{ kind: "open_shop" }], { npcId: "bram", playerId: "u1" })).toEqual([]);
    expect(validateIntents("nope", scope)).toEqual([]);
    expect(validateIntents([null, 3, { kind: "set_mood", mood: "happy" }], scope)).toEqual([{ kind: "set_mood", mood: "happy" }]);
  });
});

describe("intentsToActions", () => {
  it("maps intents to NpcActions that ZoneRoom then sanitizes as usual", () => {
    const map = getMap("village");
    const { actions, quests } = intentsToActions(
      [
        { kind: "give_gift", item: "seed_turnip", qty: 2 },
        { kind: "set_mood", mood: "fond" },
        { kind: "walk_to", placeId: "fountain" },
        { kind: "walk_to", placeId: "dock" }, // not on the village map
        { kind: "suggest_quest", goal: "bridge" },
      ],
      { speakerEntityId: "p:u1", place: (id) => placeTarget(map, id) },
    );
    expect(quests).toEqual(["bridge"]);
    expect(actions.map((a) => a.kind)).toEqual(["give", "emote", "walk_to"]);
    const safe = sanitizeActions(actions, { speakerId: "p:u1", home: { x: 47, y: 19 }, leash: 3, hasShop: true, giftAllowed: false });
    expect(safe.map((a) => a.kind)).toEqual(["emote", "walk_to"]); // gift refused: already gifted today
    const walk = safe[1] as { x: number; y: number };
    expect(Math.hypot(walk.x - 47, walk.y - 19)).toBeLessThanOrEqual(3 + 1e-9);
  });
});

describe("agent tools with a fake model", () => {
  it("records intents only, through the real AI SDK tool loop", async () => {
    const sink: unknown[] = [];
    const model = fakeNpcModel([
      {
        text: "Here, take some turnip seeds, love!",
        toolCalls: [
          { name: "give_gift", input: { item: "seed_turnip", qty: 1 } },
          { name: "set_mood", input: { mood: "happy" } },
          { name: "remember", input: { playerId: "u1", fact: "is new to farming" } },
        ],
      },
    ]);
    const out = await generateText({ model, tools: npcTools((r) => sink.push(r)), prompt: "hi", stopWhen: stepCountIs(1) });
    expect(model.calls).toHaveLength(1);
    expect(out.text).toContain("turnip seeds");
    expect(validateIntents(sink, scope)).toEqual([
      { kind: "give_gift", item: "seed_turnip", qty: 1 },
      { kind: "set_mood", mood: "happy" },
      { kind: "remember", playerId: "u1", fact: "is new to farming" },
    ]);
  });
  it("rejects tool input that fails the schema", async () => {
    const sink: unknown[] = [];
    const model = fakeNpcModel([{ text: "Hm.", toolCalls: [{ name: "set_mood", input: { mood: "evil" } }] }]);
    await generateText({ model, tools: npcTools((r) => sink.push(r)), prompt: "hi", stopWhen: stepCountIs(1) });
    expect(sink).toEqual([]);
  });
});

describe("fake model streaming (the path Think uses)", () => {
  it("streams text and tool calls", async () => {
    const { streamText } = await import("ai");
    const sink: unknown[] = [];
    const model = fakeNpcModel([{ text: "Mm. Good iron.", toolCalls: [{ name: "set_mood", input: { mood: "thoughtful" } }] }]);
    const res = streamText({ model, tools: npcTools((r) => sink.push(r)), prompt: "hi", stopWhen: stepCountIs(1) });
    expect(await res.text).toBe("Mm. Good iron.");
    expect(sink).toEqual([{ kind: "set_mood", mood: "thoughtful" }]);
  });
});
