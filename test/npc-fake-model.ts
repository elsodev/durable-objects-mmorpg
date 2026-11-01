// A scripted AI SDK LanguageModelV4 for tests: answers with fixed text and tool calls, and counts calls.
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4Content, LanguageModelV4StreamPart } from "@ai-sdk/provider";

export interface FakeTurn {
  text: string;
  toolCalls?: { name: string; input: unknown }[];
}

export interface FakeModel extends LanguageModelV4 {
  calls: LanguageModelV4CallOptions[];
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

export function fakeNpcModel(turns: FakeTurn[]): FakeModel {
  let n = 0;
  const calls: LanguageModelV4CallOptions[] = [];
  const next = (opts: LanguageModelV4CallOptions) => {
    calls.push(opts);
    return turns[Math.min(n++, turns.length - 1)]!;
  };
  const content = (t: FakeTurn): LanguageModelV4Content[] => [
    ...(t.toolCalls ?? []).map((c, i) => ({ type: "tool-call" as const, toolCallId: `c${i}`, toolName: c.name, input: JSON.stringify(c.input) })),
    { type: "text" as const, text: t.text },
  ];
  const finish = (t: FakeTurn) => ({ unified: t.toolCalls?.length ? ("tool-calls" as const) : ("stop" as const), raw: undefined });
  return {
    specificationVersion: "v4",
    provider: "fake",
    modelId: "fake-npc",
    supportedUrls: {},
    calls,
    async doGenerate(opts) {
      const t = next(opts);
      return { content: content(t), finishReason: finish(t), usage, warnings: [] };
    },
    async doStream(opts) {
      const t = next(opts);
      const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
      for (const c of content(t)) {
        if (c.type === "text") parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: c.text }, { type: "text-end", id: "t" });
        else if (c.type === "tool-call") parts.push(c);
      }
      parts.push({ type: "finish", usage, finishReason: finish(t) });
      return {
        stream: new ReadableStream({
          start(ctrl) {
            for (const p of parts) ctrl.enqueue(p);
            ctrl.close();
          },
        }),
      };
    },
  } as FakeModel;
}
