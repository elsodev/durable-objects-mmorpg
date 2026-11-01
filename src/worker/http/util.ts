// Small HTTP helpers shared by the Worker routes.

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorJson(status: number, error: string): Response {
  return json({ error }, status);
}

/** Copy of `headers` without any client-supplied x-dmmo-* identity headers. */
export function stripIdentityHeaders(headers: Headers): Headers {
  const out = new Headers();
  headers.forEach((value, key) => {
    if (!key.toLowerCase().startsWith("x-dmmo-")) out.append(key, value);
  });
  return out;
}

export const MAX_NAME_LEN = 24;

/** Display names: no control/format chars, collapsed whitespace, 1..24 code points. Empty input -> fallback. */
export function sanitizeName(name: unknown, fallback = "Farmer"): string {
  if (typeof name !== "string") return fallback;
  const cleaned = name
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const capped = Array.from(cleaned).slice(0, MAX_NAME_LEN).join("").trim();
  return capped || fallback;
}
