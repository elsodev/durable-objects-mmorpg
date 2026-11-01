import { describe, expect, it } from "vitest";
import { cleanSituation, heartBand, lineKeys, pickLineKey, renderSituation, toneGuide, zonePlace, type Situation } from "../src/worker/npc/dialogue";
import { newMemory } from "../src/worker/npc/think/memory";
import { keyedGreeting, scriptedReply } from "../src/worker/npc/think/scripted";
import { NPC_DIALOGUE, NPC_IDS } from "../src/worker/npc/bible";

const sit = (o: Partial<Situation> = {}): Situation => ({
  hearts: 0,
  zone: "village",
  hour: 10,
  weekday: "Mon",
  season: "spring",
  day: 1,
  birthday: false,
  ...o,
});
const r0 = () => 0;

describe("line key priority", () => {
  it("birthday, then hearts (warmest band first), then weekday, season, default", () => {
    expect(lineKeys(sit({ birthday: true, hearts: 7, weekday: "Fri", season: "fall" }))).toEqual([
      "birthday",
      "hearts6",
      "hearts2",
      "Fri",
      "fall",
      "default",
    ]);
    expect(lineKeys(sit({ hearts: 10 }))).toEqual(["hearts9", "hearts6", "hearts2", "Mon", "spring", "default"]);
    expect(lineKeys(sit({ hearts: 1 }))).toEqual(["Mon", "spring", "default"]);
  });

  it("picks the first key that has lines", () => {
    const lines = { birthday: ["b"], hearts6: ["h6"], Fri: ["f"], fall: ["s"], default: ["d"] };
    expect(pickLineKey(lines, sit({ birthday: true, hearts: 9 }))).toBe("birthday");
    expect(pickLineKey(lines, sit({ hearts: 9, weekday: "Fri" }))).toBe("hearts6");
    expect(pickLineKey(lines, sit({ hearts: 3, weekday: "Fri" }))).toBe("Fri");
    expect(pickLineKey(lines, sit({ hearts: 3, season: "fall" }))).toBe("fall");
    expect(pickLineKey(lines, sit())).toBe("default");
    expect(pickLineKey({ hearts6: [] }, sit({ hearts: 8 }))).toBeNull();
    expect(pickLineKey({ ["constructor" as string]: ["x"] } as never, sit())).toBeNull();
  });

  it("every villager has a birthday line and heart-band lines", () => {
    for (const id of NPC_IDS) {
      expect(NPC_DIALOGUE[id].birthday?.length).toBeGreaterThan(0);
      for (const k of ["hearts2", "hearts6", "hearts9"]) expect(NPC_DIALOGUE[id][k]?.length, `${id} ${k}`).toBeGreaterThan(0);
    }
  });
});

describe("tone and situation", () => {
  it("heart bands", () => {
    expect([0, 1, 2, 5, 6, 8, 9, 10].map(heartBand)).toEqual(["polite", "polite", "friendly", "friendly", "warm", "warm", "close", "close"]);
    expect(toneGuide(10)).toMatch(/closest/);
  });

  it("renders one situation line with the tone guide", () => {
    const text = renderSituation(sit({ hearts: 7, weekday: "Fri", season: "summer", day: 5, hour: 19, zone: "int_inn", birthday: true }));
    expect(text).toContain("Friday, Summer 5, evening");
    expect(text).toContain("the inn");
    expect(text).toContain("7 of 10 hearts");
    expect(text).toContain("Today is your birthday.");
    expect(text).toContain("good friend");
    expect(zonePlace("int_house_bram")).toBe("Bram's house");
  });

  it("validates a situation from an RPC", () => {
    expect(cleanSituation(sit())).toEqual(sit());
    expect(cleanSituation({ ...sit(), hearts: 11 })).toBeNull();
    expect(cleanSituation({ ...sit(), zone: "home" })).toBeNull();
    expect(cleanSituation({ ...sit(), weekday: "Funday" })).toBeNull();
    expect(cleanSituation(null)).toBeNull();
  });
});

describe("scripted fallback by situation", () => {
  it("a birthday greeting always wins (after the first meeting)", () => {
    const m = newMemory("rue", "u1", "Ada", 0);
    expect(scriptedReply("rue", m, "greet", true, r0, sit({ birthday: true }))).not.toContain("birthday"); // first meeting still first
    m.talks = 3;
    expect(scriptedReply("rue", m, "greet", true, r0, sit({ birthday: true }))).toContain("birthday");
  });

  it("hearts lines take turns with memory lines", () => {
    const m = newMemory("odette", "u1", "Ada", 0);
    m.talks = 2;
    expect(scriptedReply("odette", m, "greet", true, r0, sit({ hearts: 9 }))).toBe(NPC_DIALOGUE.odette.hearts9![0]!.replace("{name}", "Ada"));
    expect(keyedGreeting("odette", sit({ hearts: 0, weekday: "Sat" }))?.key).toBe("Sat");
    expect(keyedGreeting("odette", sit({ hearts: 0, weekday: "Tue", season: "fall" }))).toBeNull();
    expect(keyedGreeting("odette", undefined)).toBeNull();
  });
});
