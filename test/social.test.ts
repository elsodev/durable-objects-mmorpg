import { describe, expect, it } from "vitest";
import { coerceName, guestName, isValidName, nameKey, nameProblem, NAME_RE } from "../src/shared/names";
import {
  decodeSocialClient,
  defaultChannel,
  emoteFrom,
  emoteVerb,
  EMOTES,
  parseChatInput,
  truncateWords,
} from "../src/shared/social";
import { decodeClient } from "../src/shared/protocol";

describe("name rules", () => {
  it("allows only 3-16 letters, digits and _", () => {
    for (const ok of ["Ann", "bob_42", "A_B_C", "x".repeat(16), "123"]) expect(isValidName(ok)).toBe(true);
    for (const bad of ["ab", "x".repeat(17), "Old Tom", "zoë", "a-b", "a.b", "<b>", " Ann", "Ann​", ""]) {
      expect(isValidName(bad)).toBe(false);
      expect(nameProblem(bad)).not.toBeNull();
    }
    expect(nameProblem("Fern_2")).toBeNull();
    expect(nameProblem("ab")).toMatch(/at least 3/);
    expect(nameProblem("x".repeat(20))).toMatch(/at most 16/);
    expect(nameProblem("Fern Moss")).toMatch(/letters, numbers or _/);
    expect(NAME_RE.source).toBe("^[A-Za-z0-9_]{3,16}$");
  });

  it("compares names case-insensitively", () => {
    expect(nameKey("Ann")).toBe(nameKey("aNN"));
  });

  it("coerces legacy names into the alphabet", () => {
    expect(coerceName("Old  Tom")).toBe("Old_Tom");
    expect(coerceName("  Zoë!! ")).toBe("Zoe");
    expect(coerceName("a")).toBe("a__");
    expect(coerceName("💀💀")).toBe("Farmer");
    expect(coerceName(42)).toBe("Farmer");
    expect(coerceName("x".repeat(40))).toHaveLength(16);
    for (const n of ["Old  Tom", "a", "x".repeat(40), "‮Evil"]) expect(isValidName(coerceName(n))).toBe(true);
  });

  it("makes valid guest placeholder names", () => {
    let i = 0;
    const seq = [0.1, 0.5, 0.99, 0, 0.3, 0.7];
    const n = guestName(() => seq[i++ % seq.length]!);
    expect(n).toMatch(/^Guest_[0-9a-f]{6}$/);
    expect(isValidName(n)).toBe(true);
  });
});

describe("bubble truncation", () => {
  it("keeps at most 5 words and adds an ellipsis", () => {
    expect(truncateWords("one two three four five")).toBe("one two three four five");
    expect(truncateWords("one two three four five six")).toBe("one two three four five…");
    expect(truncateWords("  hi   there ")).toBe("hi there");
    expect(truncateWords("a b c", 2)).toBe("a b…");
    expect(truncateWords("")).toBe("");
  });
});

describe("chat input parsing", () => {
  it("routes plain text by tab", () => {
    expect(parseChatInput("hello", "all", null)).toEqual({ kind: "zone", text: "hello" });
    expect(parseChatInput("hello", "zone", null)).toEqual({ kind: "zone", text: "hello" });
    expect(parseChatInput("hello", "world", null)).toEqual({ kind: "world", text: "hello" });
    expect(parseChatInput("hello", "pm", "Bob")).toEqual({ kind: "pm", to: "Bob", text: "hello" });
    expect(parseChatInput("hello", "pm", null)).toMatchObject({ kind: "error" });
    expect(parseChatInput("   ", "all", null)).toBeNull();
    expect(defaultChannel("all")).toBe("zone");
  });

  it("parses /w and its aliases", () => {
    expect(parseChatInput("/w Bob hi there", "all", null)).toEqual({ kind: "pm", to: "Bob", text: "hi there" });
    expect(parseChatInput("/whisper bob_2 yo", "world", null)).toEqual({ kind: "pm", to: "bob_2", text: "yo" });
    expect(parseChatInput("/msg Bob x", "all", null)).toMatchObject({ kind: "pm", to: "Bob" });
    expect(parseChatInput("/W Bob x", "all", null)).toMatchObject({ kind: "pm", to: "Bob" });
    expect(parseChatInput("/w Bob", "all", null)).toMatchObject({ kind: "error" });
    expect(parseChatInput("/w", "all", null)).toMatchObject({ kind: "error" });
    expect(parseChatInput("/w <script> hi", "all", null)).toMatchObject({ kind: "error" });
  });

  it("parses /r against the last whisperer", () => {
    expect(parseChatInput("/r thanks!", "all", "Ann")).toEqual({ kind: "pm", to: "Ann", text: "thanks!" });
    expect(parseChatInput("/reply ok", "zone", "Ann")).toEqual({ kind: "pm", to: "Ann", text: "ok" });
    expect(parseChatInput("/r hi", "all", null)).toMatchObject({ kind: "error" });
    expect(parseChatInput("/r", "all", "Ann")).toMatchObject({ kind: "error" });
  });

  it("parses channel prefixes", () => {
    expect(parseChatInput("/world hey all", "zone", null)).toEqual({ kind: "world", text: "hey all" });
    expect(parseChatInput("/g hey", "zone", null)).toEqual({ kind: "world", text: "hey" });
    expect(parseChatInput("/zone nearby", "world", null)).toEqual({ kind: "zone", text: "nearby" });
    expect(parseChatInput("/s nearby", "world", null)).toEqual({ kind: "zone", text: "nearby" });
  });

  it("parses /emote with codes and aliases", () => {
    expect(parseChatInput("/emote wave", "all", null)).toEqual({ kind: "emote", code: "wave" });
    expect(parseChatInput("/e HEART", "all", null)).toEqual({ kind: "emote", code: "heart" });
    expect(parseChatInput("/emote lol", "all", null)).toEqual({ kind: "emote", code: "laugh" });
    expect(parseChatInput("/emote dance", "all", null)).toMatchObject({ kind: "error" });
    expect(parseChatInput("/emote", "all", null)).toMatchObject({ kind: "error" });
  });

  it("passes unknown commands to zone chat (e.g. the /day dev tool)", () => {
    expect(parseChatInput("/day", "world", null)).toEqual({ kind: "zone", text: "/day" });
    expect(parseChatInput("/wave", "all", null)).toEqual({ kind: "zone", text: "/wave" });
  });
});

describe("emotes", () => {
  it("has ~12 codes, each with a verb", () => {
    expect(EMOTES.length).toBe(12);
    for (const e of EMOTES) {
      expect(emoteFrom(e)).toBe(e);
      expect(emoteVerb(e).length).toBeGreaterThan(0);
    }
    expect(emoteFrom("constructor")).toBeNull();
    expect(emoteFrom("__proto__")).toBeNull();
  });

  it("validates the emote ClientMsg", () => {
    expect(decodeClient(JSON.stringify({ t: "emote", code: "wave" }))).toEqual({ t: "emote", code: "wave" });
    expect(decodeClient(JSON.stringify({ t: "emote", code: "dance" }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "emote", code: "wave", extra: 1 }))).toEqual({ t: "emote", code: "wave" });
  });
});

describe("social socket frames", () => {
  const d = (m: unknown) => decodeSocialClient(JSON.stringify(m));
  it("accepts known frames and copies only known fields", () => {
    expect(d({ t: "world", text: " hi ", x: 1 })).toEqual({ t: "world", text: "hi" });
    expect(d({ t: "pm", to: "Bob", text: "yo" })).toEqual({ t: "pm", to: "Bob", text: "yo" });
    expect(d({ t: "here", zone: "village" })).toEqual({ t: "here", zone: "village" });
    expect(d({ t: "stats" })).toEqual({ t: "stats" });
    expect(d({ t: "ping", at: 5 })).toEqual({ t: "ping", at: 5 });
  });

  it("rejects bad frames", () => {
    expect(d({ t: "world", text: "   " })).toBeNull();
    expect(d({ t: "world", text: 5 })).toBeNull();
    expect(d({ t: "pm", to: "bad name", text: "x" })).toBeNull();
    expect(d({ t: "here", zone: "moon" })).toBeNull();
    expect(d({ t: "nope" })).toBeNull();
    expect(d([1])).toBeNull();
    expect(decodeSocialClient("{bad json")).toBeNull();
    expect(decodeSocialClient("x".repeat(5000))).toBeNull();
  });

  it("caps chat text at 200 chars and strips controls", () => {
    const m = d({ t: "world", text: "a\u0000b" + "x".repeat(400) });
    expect(m && m.t === "world" && m.text.length).toBe(200);
    expect(m && m.t === "world" && m.text.startsWith("a b")).toBe(true);
  });
});
