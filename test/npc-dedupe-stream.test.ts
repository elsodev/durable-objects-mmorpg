import { describe, expect, it } from "vitest";
import { createDoubledTextFilter } from "../src/worker/npc/think/dedupe-stream";
import { twoSentences } from "../src/worker/npc/think/scripted";

type P = { type: string; id?: string; delta?: string };
const run = (parts: P[]): string => {
  const f = createDoubledTextFilter<P>();
  const out = [...parts.flatMap((p) => f.push(p)), ...f.flush()];
  return out.filter((p) => p.type === "text-delta").map((p) => p.delta).join("");
};
const d = (delta: string, id = "t"): P => ({ type: "text-delta", id, delta });
const deltas = (words: string[], twice: boolean): P[] => [
  { type: "text-start", id: "t" },
  ...words.flatMap((w) => (twice ? [d(w), d(w)] : [d(w)])),
  { type: "text-end", id: "t" },
];

describe("doubled stream text", () => {
  const words = ["Good", " evening", ",", " I", " wasn't", " expecting", " company", "."];
  it("keeps one copy of every doubled delta", () => {
    expect(run(deltas(words, true))).toBe("Good evening, I wasn't expecting company.");
  });
  it("leaves a normal stream alone", () => {
    expect(run(deltas(words, false))).toBe("Good evening, I wasn't expecting company.");
  });
  it("lets a single held delta through at the end", () => {
    expect(run([d("Hi")])).toBe("Hi");
    expect(run([d("Hi"), { type: "text-end", id: "t" }])).toBe("Hi");
  });
  it("falls back to plain text when pairs stop matching", () => {
    expect(run([d("a"), d("a"), d("b"), d("c")])).toBe("abc");
  });
  it("passes other parts straight through", () => {
    const f = createDoubledTextFilter<P>();
    expect(f.push({ type: "finish" })).toEqual([{ type: "finish" }]);
  });
});

describe("two-sentence trim", () => {
  it("drops a lone closing quote left after trimming", () => {
    expect(twoSentences(`Good evening, so late. The river's calm tonight, isn't it?"`)).toBe(`Good evening, so late. The river's calm tonight, isn't it?`);
  });
  it("keeps balanced quotes", () => {
    expect(twoSentences(`He said "hello" to me. Nice.`)).toBe(`He said "hello" to me. Nice.`);
  });
});
