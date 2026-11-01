// Cloudflare Turnstile: site key from /api/config, explicit-render script loader and a small widget wrapper.
// A null site key (local dev) means captcha is disabled: widgets resolve a null token and render nothing.

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_TIMEOUT_MS = 30_000;

interface TurnstileRenderOptions {
  sitekey: string;
  size?: "normal" | "compact" | "flexible" | "invisible";
  appearance?: "always" | "execute" | "interaction-only";
  execution?: "render" | "execute";
  theme?: "auto" | "light" | "dark";
  action?: string;
  callback?: (token: string) => void;
  "error-callback"?: (code?: string) => boolean | void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
}

interface TurnstileApi {
  render(el: HTMLElement, opts: TurnstileRenderOptions): string | undefined;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
  getResponse(widgetId: string): string | undefined;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let configPromise: Promise<string | null> | null = null;
let scriptPromise: Promise<TurnstileApi> | null = null;

/** GET /api/config once; any failure counts as "no captcha" so local dev and outages still show the form. */
export function getTurnstileSiteKey(): Promise<string | null> {
  configPromise ??= fetch("/api/config", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg: unknown) => {
      const key = (cfg as { turnstileSiteKey?: unknown } | null)?.turnstileSiteKey;
      return typeof key === "string" && key.length > 0 ? key : null;
    })
    .catch(() => null);
  return configPromise;
}

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    s.onerror = () => {
      scriptPromise = null;
      s.remove();
      reject(new Error("turnstile script failed to load"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export class CaptchaError extends Error {}

export interface Captcha {
  /** A fresh single-use token, or null when captcha is disabled. Rejects with CaptchaError. */
  token(): Promise<string | null>;
  /** Call after every submit: Turnstile tokens are single-use. */
  reset(): void;
  destroy(): void;
}

/**
 * "managed": only shows a challenge if Turnstile needs interaction (guest button).
 * "visible": always shows the checkbox widget (sign in / sign up).
 */
export async function createCaptcha(container: HTMLElement, mode: "managed" | "visible"): Promise<Captcha> {
  const siteKey = await getTurnstileSiteKey();
  if (!siteKey) return { token: async () => null, reset() {}, destroy() {} };

  let api: TurnstileApi | null = null;
  let widgetId: string | null = null;
  let current: string | null = null;
  let waiters: Array<{ resolve(t: string): void; reject(e: Error): void }> = [];
  let loadError: Error | null = null;

  const settle = (tok: string | null, err?: Error) => {
    const list = waiters;
    waiters = [];
    for (const w of list) tok ? w.resolve(tok) : w.reject(err ?? new CaptchaError("Verification failed."));
  };

  const ready = loadScript()
    .then((t) => {
      api = t;
      widgetId =
        t.render(container, {
          sitekey: siteKey,
          size: mode === "managed" ? "flexible" : "normal",
          appearance: mode === "managed" ? "interaction-only" : "always",
          execution: mode === "managed" ? "execute" : "render",
          theme: "auto",
          callback: (tok) => {
            current = tok;
            settle(tok);
          },
          "error-callback": () => {
            current = null;
            settle(null, new CaptchaError("Verification failed. Please try again."));
            return true;
          },
          "expired-callback": () => {
            current = null;
          },
          "timeout-callback": () => {
            current = null;
            settle(null, new CaptchaError("Verification timed out. Please try again."));
          },
        }) ?? null;
    })
    .catch(() => {
      loadError = new CaptchaError("Couldn't load the human check. Check your connection or ad blocker.");
    });

  return {
    async token() {
      await ready;
      if (loadError) throw loadError;
      if (!api || widgetId === null) throw new CaptchaError("Human check is not ready yet.");
      const existing = current ?? api.getResponse(widgetId) ?? null;
      if (existing) return existing;
      const wait = new Promise<string>((resolve, reject) => {
        waiters.push({ resolve, reject });
        setTimeout(() => reject(new CaptchaError("Please complete the human check.")), TOKEN_TIMEOUT_MS);
      });
      if (mode === "managed") api.execute(widgetId);
      return wait;
    },
    reset() {
      current = null;
      if (api && widgetId !== null) api.reset(widgetId);
    },
    destroy() {
      settle(null, new CaptchaError("Cancelled."));
      if (api && widgetId !== null) api.remove(widgetId);
      widgetId = null;
    },
  };
}
