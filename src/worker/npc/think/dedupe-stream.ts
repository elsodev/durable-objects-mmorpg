// Some Workers AI models answer each streamed chunk in two shapes at once (a native `response`
// field and an OpenAI-style `choices[0].delta.content`). The provider turns both into text, so
// every token arrives twice and villagers said "GoodGood evening evening". This filter spots a
// stream whose text deltas come in identical back-to-back pairs and keeps one of each pair.
import type { LanguageModelMiddleware } from "ai";

type Part = { type: string; id?: string; delta?: string };

interface TextState {
  mode: "unknown" | "doubled" | "plain";
  /** A delta held back until we know whether its twin follows. */
  pending: string | null;
}

/** Feed stream parts in, get the parts to pass on. Pure, so the pairing rules are easy to test. */
export function createDoubledTextFilter<P extends Part>(): { push(part: P): P[]; flush(): P[] } {
  const states = new Map<string, TextState>();
  const held = new Map<string, P>();

  const release = (id: string): P[] => {
    const s = states.get(id);
    const part = held.get(id);
    if (!s || s.pending === null || !part) return [];
    s.pending = null;
    held.delete(id);
    return [part];
  };

  return {
    push(part) {
      if (part.type !== "text-delta" || typeof part.delta !== "string") {
        // Anything else ends a pairing run: let any held delta through first.
        if (part.type === "text-end" && part.id) return [...release(part.id), part];
        return [part];
      }
      const id = part.id ?? "";
      const s = states.get(id) ?? { mode: "unknown", pending: null };
      states.set(id, s);
      if (s.mode === "plain") return [part];
      if (s.pending === null) {
        s.pending = part.delta;
        held.set(id, part);
        return [];
      }
      if (s.pending === part.delta) {
        // The twin: keep the first copy only.
        s.mode = "doubled";
        const first = held.get(id)!;
        s.pending = null;
        held.delete(id);
        return [first];
      }
      // Not a twin: this stream (or what's left of it) is normal text.
      s.mode = "plain";
      return [...release(id), part];
    },
    flush() {
      return [...held.keys()].flatMap((id) => release(id));
    },
  };
}

/** AI SDK middleware applying the filter to streamed text. Generate calls pass through. */
export const dedupeDoubledText: LanguageModelMiddleware = {
  wrapStream: async ({ doStream }) => {
    const res = await doStream();
    const filter = createDoubledTextFilter<Part>();
    const stream = (res.stream as ReadableStream<Part>).pipeThrough(
      new TransformStream<Part, Part>({
        transform(part, controller) {
          for (const p of filter.push(part)) controller.enqueue(p);
        },
        flush(controller) {
          for (const p of filter.flush()) controller.enqueue(p);
        },
      }),
    );
    return { ...res, stream: stream as typeof res.stream };
  },
};
