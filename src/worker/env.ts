// Worker bindings. Keep in sync with wrangler.jsonc.
import type { ZoneRoom } from "./zone";
import type { HomeRoom } from "./home";
import type { AiBudget } from "./npc/budget";
import type { SocialRoom } from "./social/room";
import type { NpcAgent } from "./npc/think/agent";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  /** R2 bucket for game assets and player uploads. */
  FILES: R2Bucket;
  AI: Ai;
  ZONE: DurableObjectNamespace<ZoneRoom>;
  HOME: DurableObjectNamespace<HomeRoom>;
  /** Global daily AI spend limiter (single instance: idFromName("global")). */
  AI_BUDGET: DurableObjectNamespace<AiBudget>;
  /** Global world chat / whispers / presence / stats (single instance: idFromName("global")). */
  SOCIAL: DurableObjectNamespace<SocialRoom>;
  /** One Project Think agent per (NPC, player): idFromName(`${npcId}:${userId}`), see npc/think/pair.ts. */
  NPC_AGENT: DurableObjectNamespace<NpcAgent>;
  /** Cloudflare Turnstile. Site key is public (served by /api/config). Unset/empty secret = captcha disabled (local dev only). */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Daily Workers AI neuron budget for all NPCs (default 9000). */
  AI_DAILY_NEURONS?: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  /** Workers AI model that writes NPC lines. */
  NPC_MODEL: string;
  /** Workers AI model for NpcAgent turns (needs tool calling). Defaults to NPC_MODEL. */
  NPC_AGENT_MODEL?: string;
  /** "on" uses Workers AI + Jev, "off" uses scripted lines only (local dev without Cloudflare login). */
  NPC_AI_MODE?: "on" | "off";
  /** "on" enables local test commands (e.g. "/day" at home, "/hour N" in shared zones). Honoured only with NPC_AI_MODE "off"; never set in production. */
  DEV_TOOLS?: "on" | "off";
  /** Workers AI model id for TypeSafe Jev decisions ("typesafe/jev"). Empty/unset = rule-based decisions. */
  JEV_MODEL?: string;
  /** AI Gateway id every NPC model call goes through (lines, Think turns, Jev). Empty/unset = no gateway. */
  AI_GATEWAY_ID?: string;
  /** "local" only in `wrangler dev --env local`: relaxes the WS origin check and the captcha requirement. */
  DMMO_ENV?: string;
  /**
   * Drop-rate multipliers (0..10, parsed by shared/engine/dropRate.ts parseDropRates). DROP_RATE
   * scales every chance drop; the others override it for one category, DROP_RATE_RARE for rare items.
   */
  DROP_RATE?: string;
  DROP_RATE_MONSTER?: string;
  DROP_RATE_ROCK?: string;
  DROP_RATE_CHEST?: string;
  DROP_RATE_FORAGE?: string;
  DROP_RATE_GIFT?: string;
  DROP_RATE_HARVEST?: string;
  DROP_RATE_RARE?: string;
  /** "1" deliberately runs a non-local deploy without Turnstile (otherwise sign-up/sign-in fail closed). */
  CAPTCHA_DISABLED?: string;
  /**
   * Admin accounts: comma-separated emails, matched case-insensitively against the signed-in
   * account (never a guest). Empty = no admins. ADMIN_EMAIL (singular) is read too. See admin/config.ts.
   */
  ADMIN_EMAILS?: string;
  ADMIN_EMAIL?: string;
}

/** Local-only test hooks: needs DEV_TOOLS "on" AND scripted NPCs, so a stray var in production does nothing. */
export function devToolsEnabled(env: Pick<Env, "DEV_TOOLS" | "NPC_AI_MODE">): boolean {
  return env.DEV_TOOLS === "on" && env.NPC_AI_MODE === "off";
}

/**
 * Headers the Worker sets when forwarding an authenticated WebSocket to a Durable Object.
 * The DO trusts ONLY these (the Worker strips any client-sent copies).
 */
export const H_USER_ID = "x-dmmo-user-id";
/** Display name; "%" and non-ASCII chars are percent-encoded (read with decodeURIComponent). */
export const H_USER_NAME = "x-dmmo-user-name";
/** Must be sanitized with safeSpawnName(map.spawns, ...) from shared/validate.ts before use. */
export const H_SPAWN = "x-dmmo-spawn";
export const H_ZONE = "x-dmmo-zone";
/** Which copy of the zone (shared/zoneCopies.ts) this join went to; "1" for the original. */
export const H_COPY = "x-dmmo-copy";
/** "1" when the session is a Better Auth anonymous (guest) user. Guests may only connect to their home. */
export const H_GUEST = "x-dmmo-guest";
/** Better Auth session id behind the socket, so the DO can re-check it (game/session.ts). */
export const H_SESSION = "x-dmmo-session-id";
/** "1" when the Worker found the account in ADMIN_EMAILS. Durable Objects trust nothing else for admin rights. */
export const H_ADMIN = "x-dmmo-admin";
/** The client's IP (CF-Connecting-IP) as the Worker saw it; SocialRoom keeps it to ban a kicked player's address. */
export const H_IP = "x-dmmo-ip";
/** Visits (/ws/visit/<ownerId>): the home owner being visited. Its presence marks the socket as a visitor's. */
export const H_VISIT_OWNER = "x-dmmo-visit-owner";
/** Visits: the zone the visitor returns to when the visit ends (from their own save, read without a lease). */
export const H_VISIT_RETURN = "x-dmmo-visit-return";
/** Visits: the visitor's look as JSON (validated again by the home) and sprite key. */
export const H_VISIT_LOOK = "x-dmmo-visit-look";
export const H_VISIT_SPRITE = "x-dmmo-visit-sprite";

/** Placeholder secrets that must never be accepted (they are public in this repo's history). */
const PLACEHOLDER_SECRETS = new Set(["change-me-to-a-long-random-string", "change-me", "secret"]);

/**
 * True if BETTER_AUTH_SECRET is safe to sign sessions with. The Worker must fail closed
 * (500 on /api and /ws) when this is false, before constructing betterAuth.
 */
export function isUsableAuthSecret(secret: string | undefined): boolean {
  return typeof secret === "string" && secret.length >= 32 && !PLACEHOLDER_SECRETS.has(secret);
}

/**
 * Better Auth rate limiting backed by D1 (migrations/0002_rate_limit.sql). The in-memory default
 * is per isolate on Workers and barely limits anything. Pass as `rateLimit` to betterAuth().
 */
export const AUTH_RATE_LIMIT = {
  enabled: true,
  storage: "database" as const,
  window: 60,
  max: 100,
  customRules: {
    "/sign-in/email": { window: 60, max: 5 },
    "/sign-up/email": { window: 3600, max: 5 },
  },
};

/** Per-socket throttles the Durable Objects enforce (chat and NPC talk each cost broadcast / AI calls). */
export const CHAT_MIN_INTERVAL_MS = 1000;
export const MOVE_TO_MIN_INTERVAL_MS = 200;
/** Max one in-flight NPC request per player. */
export const MAX_NPC_INFLIGHT = 1;
