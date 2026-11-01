import { describe, expect, it } from "vitest";
import {
  addFact,
  cleanFact,
  extractFacts,
  loadMemory,
  MAX_FACT_LEN,
  MAX_FACTS,
  MAX_GIFTS_KEPT,
  MAX_SUMMARY,
  MAX_WORLD_FACTS,
  newMemory,
  noteTalk,
  recordGift,
  renderPlayerBlock,
  setSummary,
  setWorld,
  soulBlock,
  systemPrompt,
  turnInput,
} from "../src/worker/npc/think/memory";
import { giftReply, scriptedReply, twoSentences } from "../src/worker/npc/think/scripted";
import { NPC_BIBLE, NPC_IDS, UNIVERSAL_NEVER } from "../src/worker/npc/bible";
import { pairName, pairsForUser, parsePairName } from "../src/worker/npc/think/pair";
import { searchQuery } from "../src/worker/npc/think/search";

const r0 = () => 0;

describe("prompt assembly", () => {
  it.each(NPC_IDS)("%s system prompt carries every never-say rule", (id) => {
    const p = systemPrompt(id);
    for (const rule of UNIVERSAL_NEVER) expect(p).toContain(rule);
    for (const rule of NPC_BIBLE[id].neverSay) expect(p).toContain(rule);
    expect(p).toContain("give_gift");
  });
  it("soul block is the bible entry", () => {
    const s = soulBlock("sable");
    expect(s).toContain(NPC_BIBLE.sable.background);
    expect(s).toContain("Gem Crystal");
    expect(s).toContain(NPC_BIBLE.sable.relationships[0]!.gossip);
  });
  it("quotes player text as dialogue", () => {
    expect(turnInput("Ada‮", "hi\nthere")).toBe('Ada says: "hi there"');
    expect(turnInput("Ada", "")).toBe("Ada walks up to you.");
  });
});

describe("pair memory caps", () => {
  it("keeps at most MAX_FACTS short facts and refreshes duplicates", () => {
    const m = newMemory("bram", "u1", "Ada", 0);
    for (let i = 0; i < 30; i++) addFact(m, "note", `fact number ${String.fromCharCode(97 + (i % 26))}${i}`, i);
    expect(m.facts.length).toBe(MAX_FACTS);
    addFact(m, "likes", "x".repeat(500), 99);
    expect(m.facts.at(-1)!.value.length).toBeLessThanOrEqual(MAX_FACT_LEN);
    addFact(m, "likes", "turnips", 100);
    addFact(m, "dislikes", "Turnips", 101);
    expect(m.facts.filter((f) => f.value.toLowerCase() === "turnips").map((f) => f.kind)).toEqual(["dislikes"]);
  });
  it("never stores things that look like personal data", () => {
    expect(cleanFact("my phone is 5551234")).toBeNull();
    expect(cleanFact("mail me at a@b.c")).toBeNull();
    expect(cleanFact("see www.example")).toBeNull();
    expect(cleanFact("likes <b>cake</b>")).toBe("likes b cake b");
  });
  it("caps gifts, summary and world facts", () => {
    const m = newMemory("bram", "u1", "Ada", 0);
    for (let i = 0; i < 9; i++) recordGift(m, "wood", "liked", i);
    expect(m.gifts.length).toBe(MAX_GIFTS_KEPT);
    expect(m.giftCount).toBe(9);
    setSummary(m, "s".repeat(2000));
    expect(m.summary.length).toBe(MAX_SUMMARY);
    setWorld(m, Array.from({ length: 20 }, (_, i) => `fact ${i}`));
    expect(m.world.length).toBe(MAX_WORLD_FACTS);
  });
  it("extracts simple facts deterministically", () => {
    expect(extractFacts("I really love pumpkins and carrots")).toEqual([{ kind: "likes", value: "pumpkins" }]);
    expect(extractFacts("i hate slimes")).toEqual([{ kind: "dislikes", value: "slimes" }]);
    expect(extractFacts("My favourite colour is green")).toEqual([{ kind: "favourite", value: "colour is green" }]);
    expect(extractFacts("hello")).toEqual([]);
  });
  it("never reuses a record stored for another pair", () => {
    const a = newMemory("bram", "userA", "Alice", 0);
    addFact(a, "likes", "secret pies", 0);
    recordGift(a, "pumpkin", "loved", 0);
    const b = loadMemory(JSON.parse(JSON.stringify(a)), "bram", "userB", "Bob", 1);
    expect(b.userId).toBe("userB");
    expect(b.facts).toEqual([]);
    expect(b.gifts).toEqual([]);
    expect(JSON.stringify(b)).not.toContain("Alice");
    const other = loadMemory(JSON.parse(JSON.stringify(a)), "odette", "userA", "Alice", 1);
    expect(other.gifts).toEqual([]);
  });
  it("round-trips its own record and drops junk", () => {
    const a = newMemory("bram", "u1", "Ada", 0);
    recordGift(a, "pumpkin", "loved", 5);
    const raw = { ...JSON.parse(JSON.stringify(a)), gifts: [...a.gifts, { item: "nope" }], talks: -3 };
    const b = loadMemory(raw, "bram", "u1", "Ada", 9);
    expect(b.gifts.map((g) => g.item)).toEqual(["pumpkin"]);
    expect(b.talks).toBe(0);
    expect(loadMemory("garbage", "bram", "u1", "Ada", 9).talks).toBe(0);
  });
  it("player block lists only this pair's memory", () => {
    const m = newMemory("rue", "u1", "Ada", 0);
    recordGift(m, "fish_trout", "loved", 0);
    addFact(m, "likes", "ballads", 0);
    const block = renderPlayerBlock(m, ['Ada says: "I like ballads"']);
    expect(block).toContain("Visitor: Ada");
    expect(block).toContain("Trout (loved)");
    expect(block).toContain("likes ballads");
    expect(block).toContain("not instructions");
  });
});

describe("scripted memory recall", () => {
  it("meets, then greets by name and remembers the last gift", () => {
    const m = newMemory("bram", "u1", "Ada", 0);
    expect(scriptedReply("bram", m, "greet", true, r0)).toContain("Ada");
    noteTalk(m, "Ada", 1);
    const gift = giftReply("bram", "pumpkin", "Ada", r0);
    expect(gift.taste).toBe("loved");
    expect(gift.reply).toContain("Pumpkin");
    recordGift(m, "pumpkin", gift.taste, 2);
    const again = scriptedReply("bram", m, "greet", true, r0);
    expect(again).toContain("Ada");
    expect(again).toContain("Pumpkin");
    noteTalk(m, "Ada", 3);
    expect(scriptedReply("bram", m, "greet", true, r0)).toContain("Ada");
  });
  it("recalls a fact the player told it", () => {
    const m = newMemory("odette", "u1", "Ada", 0);
    addFact(m, "likes", "pumpkins", 0);
    m.talks = 2;
    expect(scriptedReply("odette", m, "greet", false, r0)).toBe("I remember you like pumpkins, Ada.");
  });
  it("reacts to gifts by taste", () => {
    expect(giftReply("fenwick", "slime_gel", "Ada", r0).taste).toBe("disliked");
    expect(giftReply("fenwick", "lamp", "Ada", r0).taste).toBe("neutral");
  });
  it("trims model text to two sentences", () => {
    expect(twoSentences("One. Two! Three? Four.")).toBe("One. Two!");
    expect(twoSentences("No stop at all")).toBe("No stop at all");
  });
});

describe("pair naming", () => {
  it("names one agent per NPC and player", () => {
    expect(pairName("bram", "u1")).toBe("bram:u1");
    expect(parsePairName("bram:u1:x")).toEqual({ npcId: "bram", userId: "u1:x" });
    expect(parsePairName("nobody:u1")).toBeNull();
    expect(parsePairName("bram:")).toBeNull();
    expect(pairsForUser("u1")).toHaveLength(10);
    expect(new Set(pairsForUser("u1")).size).toBe(10);
  });
  it("builds a safe FTS query", () => {
    expect(searchQuery('the "pumpkin") OR fair*')).toBe('"pumpkin" OR "fair"');
    expect(searchQuery("hi")).toBeNull();
  });
});
