// Client-side bus for pushes from the social socket (/ws/social). Whoever owns that socket calls
// emitSocial(payload) for each `{ t: "social", payload }` frame; UI modules subscribe by payload type:
//   onSocial("friendRequest", (p) => ...)   // returns an unsubscribe function
//   onSocial("*", (p) => ...)               // every payload
// Payloads come from the server but are still treated as untrusted data (render with textContent).

export interface SocialPayload {
  t: string;
  [key: string]: unknown;
}

type Handler = (payload: SocialPayload) => void;

const handlers = new Map<string, Set<Handler>>();

export function onSocial(type: string, fn: Handler): () => void {
  let set = handlers.get(type);
  if (!set) handlers.set(type, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

/** Delivers one payload to its type's handlers and to "*" handlers. Ignores anything without a string `t`. */
export function emitSocial(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const p = payload as SocialPayload;
  if (typeof p.t !== "string" || p.t === "*") return;
  for (const key of [p.t, "*"]) {
    for (const fn of [...(handlers.get(key) ?? [])]) {
      try {
        fn(p);
      } catch (err) {
        console.error("social handler failed", err);
      }
    }
  }
}
