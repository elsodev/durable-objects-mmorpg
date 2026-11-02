import { describe, expect, it } from "vitest";
import {
  BUILDING_IDS,
  giftTaste,
  isPlaceId,
  NPC_BIBLE,
  NPC_IDS,
  NPC_ROUTINES,
  PLACE_IDS,
  PLACE_ZONE,
  routineSlotAt,
  UNIVERSAL_NEVER,
} from "../src/worker/npc/bible";
import { NPCS } from "../src/worker/npc/catalog";
import { getItem } from "../src/shared/items";

const PLACEHOLDERS = /\{(\w+)\}/g;
const KNOWN = new Set(["name", "item", "lastGift", "fact"]);

describe("NPC bible", () => {
  it("covers exactly the catalog NPCs", () => {
    expect([...NPC_IDS].sort()).toEqual(Object.keys(NPCS).sort());
    for (const id of NPC_IDS) expect(NPC_BIBLE[id].id).toBe(id);
  });

  it.each(NPC_IDS)("%s has every field filled in", (id) => {
    const b = NPC_BIBLE[id];
    for (const s of [b.background, b.personality, b.speechStyle, b.secret, b.wants]) expect(s.length).toBeGreaterThan(30);
    // A fuller story: past, neighbours and quirks, not a one-liner.
    expect(b.background.length).toBeGreaterThan(300);
    expect(b.quirks.length).toBeGreaterThanOrEqual(2);
    expect(b.sampleLines.length).toBeGreaterThanOrEqual(6);
    expect(b.sampleLines.length).toBeLessThanOrEqual(10);
    expect(new Set(b.sampleLines).size).toBe(b.sampleLines.length);
    for (const l of b.sampleLines) expect(l.length).toBeLessThanOrEqual(200);
    expect(b.likes.length).toBeGreaterThan(0);
    expect(b.dislikes.length).toBeGreaterThan(0);
    expect(b.lovesToTalkAbout.length).toBeGreaterThan(0);
    expect(b.neverSay.length).toBeGreaterThan(0);
    expect(b.relationships.length).toBeGreaterThanOrEqual(2);
    for (const list of Object.values(b.memoryLines)) {
      expect(list.length).toBeGreaterThan(0);
      for (const line of list) for (const m of line.matchAll(PLACEHOLDERS)) expect(KNOWN.has(m[1]!)).toBe(true);
    }
  });

  it.each(NPC_IDS)("%s gift preferences use real, distinct item ids", (id) => {
    const { loved, liked, disliked } = NPC_BIBLE[id].gifts;
    expect(loved.length).toBeGreaterThan(0);
    const all = [...loved, ...liked, ...disliked];
    for (const item of all) expect(getItem(item), item).toBeDefined();
    expect(new Set(all).size).toBe(all.length);
    expect(giftTaste(id, loved[0]!)).toBe("loved");
  });

  it.each(NPC_IDS)("%s relationships point at other real NPCs", (id) => {
    for (const r of NPC_BIBLE[id].relationships) {
      expect(NPC_IDS).toContain(r.npc);
      expect(r.npc).not.toBe(id);
      expect(r.gossip.length).toBeGreaterThan(10);
    }
  });

  it.each(NPC_IDS)("%s routine uses fixed building ids and covers the whole day", (id) => {
    const r = NPC_ROUTINES[id];
    // Matches the interiors: Rue sleeps at the inn, Sable at the shrine, everyone else in a cottage.
    expect(r.home).toBe(({ rue: "inn", sable: "shrine", sheriff: "police" } as Record<string, string>)[id] ?? `house_${id}`);
    if (r.home.startsWith("house_")) expect(BUILDING_IDS).toContain(r.home);
    expect(isPlaceId(r.work)).toBe(true);
    expect(r.workHours.from).toBeLessThan(r.workHours.to);
    let hour = 0;
    for (const slot of r.schedule) {
      expect(slot.from).toBe(hour);
      expect(slot.to).toBeGreaterThan(slot.from);
      expect(isPlaceId(slot.place)).toBe(true);
      hour = slot.to;
    }
    expect(hour).toBe(24);
    expect(r.schedule.some((s) => s.place === r.work)).toBe(true);
    expect(r.schedule.some((s) => s.place === r.home)).toBe(true);
    expect(routineSlotAt(id, 25)).toEqual(routineSlotAt(id, 1));
  });

  it("uses exactly the interiors' building ids", () => {
    expect([...BUILDING_IDS].sort()).toEqual(
      ["townhall", "inn", "smithy", "market", "house_bram", "house_odette", "house_fenwick", "house_pip", "house_marlo", "house_iris", "house_grumm", "house_tess", "police"].sort(),
    );
    for (const id of NPC_IDS) {
      const r = NPC_ROUTINES[id];
      // Same coarse bands as the interiors schedule: at the post (or nearby outdoors) at noon,
      // indoors at home at 3 am.
      expect(routineSlotAt(id, 3).place).toBe(r.home);
      expect(PLACE_ZONE[routineSlotAt(id, 12).place]).toBe(NPCS[id]!.zone);
    }
  });

  it("puts every place in a zone", () => {
    for (const p of PLACE_IDS) expect(["village", "riverside", "caves", "int_police"]).toContain(PLACE_ZONE[p]);
  });

  it("has the hard rules the owner asked for", () => {
    const all = UNIVERSAL_NEVER.join(" ").toLowerCase();
    for (const word of ["ai", "real world", "politics", "brands", "promise", "other visitors", "ignore your rules", "two short sentences", "family friendly"])
      expect(all).toContain(word);
  });
});
