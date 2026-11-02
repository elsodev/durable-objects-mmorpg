// /api/feedback HTTP routes. Session-checked (guests may send too); writes need our own Origin.
//   POST  /api/feedback                    multipart: category, message, info (JSON), screenshot? -> 201 { id }
//   GET   /api/feedback?before=&status=     admins: FeedbackPage, newest first
//   PATCH /api/feedback/:id  { status }     admins: mark seen / resolved / new
//   GET   /api/feedback/:id/screenshot      admins: the image, with headers that keep it an image
import type { Env } from "../env";
import type { AuthUser } from "../auth";
import { errorJson, json, sanitizeName } from "../http/util";
import { originAllowed } from "../http/origin";
import { readCapped } from "../http/sniff";
import { takeQuota } from "../http/rate";
import {
  FEEDBACK_MAX_BODY_BYTES,
  FEEDBACK_PATH,
  SCREENSHOT_MAX_BYTES,
  cleanClientInfo,
  cleanFeedbackMessage,
  isFeedbackCategory,
  isFeedbackId,
  isFeedbackStatus,
  parseCursor,
  type FeedbackSubmitted,
} from "../../shared/feedback";
import { checkScreenshot, type ScreenshotInfo } from "./image";
import * as store from "./store";

type FeedbackEnv = Pick<Env, "DB" | "FILES" | "BETTER_AUTH_URL" | "DMMO_ENV">;

/** Submissions tried (valid or not) per player per hour: bounds the work a bad client can cause. */
export const FEEDBACK_TRY_MAX = 30;
const INFO_MAX_CHARS = 2048;
const RATE_TEXT = "Thanks! You've sent a lot of feedback recently. Try again a bit later.";

export function isFeedbackPath(pathname: string): boolean {
  return pathname === FEEDBACK_PATH || pathname.startsWith(FEEDBACK_PATH + "/");
}

export async function handleFeedback(request: Request, env: FeedbackEnv, user: AuthUser | null, now = Date.now()): Promise<Response> {
  if (!user) return errorJson(401, "sign in required");
  const method = request.method;
  if (method !== "GET" && method !== "HEAD" && !originAllowed(request.headers.get("origin"), env)) return errorJson(403, "bad origin");
  const sub = new URL(request.url).pathname.slice(FEEDBACK_PATH.length);

  if (sub === "" || sub === "/") {
    if (method === "POST") return submit(request, env, user, now);
    if (method === "GET") return list(request, env, user);
    return errorJson(405, "method not allowed");
  }
  const m = /^\/([^/]{1,64})(\/screenshot)?$/.exec(sub);
  if (!m || !isFeedbackId(m[1])) return errorJson(404, "not found");
  // Every per-report route is for admins; anyone else learns nothing about which ids exist.
  if (!isAdmin(user)) return errorJson(403, "admins only");
  if (m[2]) {
    if (method !== "GET" && method !== "HEAD") return errorJson(405, "method not allowed");
    return screenshot(env, m[1]!, method === "HEAD");
  }
  if (method !== "PATCH") return errorJson(405, "method not allowed");
  return patch(request, env, user, m[1]!, now);
}

function isAdmin(user: AuthUser): boolean {
  return user.admin === true && !user.isGuest;
}

interface Parsed {
  category: string;
  message: unknown;
  info: unknown;
  shot: Uint8Array | null;
}

/** The capped body as form fields. Strings for text, bytes for the one optional file. */
export async function parseForm(body: Uint8Array, contentType: string): Promise<Parsed | string> {
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) return "send multipart/form-data";
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body), { headers: { "content-type": contentType } }).formData();
  } catch {
    return "bad form";
  }
  let entries = 0;
  for (const _ of form.keys()) if (++entries > 8) return "too many fields";
  const category = form.get("category");
  const message = form.get("message");
  const info = form.get("info");
  const file = form.get("screenshot");
  if (typeof category !== "string" || typeof message !== "string") return "missing category or message";
  let parsedInfo: unknown = null;
  if (typeof info === "string" && info.length > 0) {
    if (info.length > INFO_MAX_CHARS) return "info too long";
    try {
      parsedInfo = JSON.parse(info);
    } catch {
      return "bad info";
    }
  }
  let shot: Uint8Array | null = null;
  if (file !== null && typeof file !== "string") {
    if (file.size > SCREENSHOT_MAX_BYTES) return "screenshot too large";
    if (file.size > 0) shot = new Uint8Array(await file.arrayBuffer());
  } else if (typeof file === "string" && file.length > 0) {
    return "screenshot must be a file";
  }
  return { category, message, info: parsedInfo, shot };
}

async function submit(request: Request, env: FeedbackEnv, user: AuthUser, now: number): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > FEEDBACK_MAX_BODY_BYTES) return errorJson(413, "Feedback too large (screenshot max 1.5 MB).");
  if (!(await takeQuota(env.DB, `feedback:try:${user.id}`, now, store.HOUR_MS, FEEDBACK_TRY_MAX))) return errorJson(429, RATE_TEXT);
  // Cheap check before reading the body; the INSERT below re-checks atomically.
  if (!store.underLimit(await store.recentCounts(env.DB, user.id, now))) return errorJson(429, RATE_TEXT);

  const body = await readCapped(request.body, FEEDBACK_MAX_BODY_BYTES);
  if (!body) return errorJson(413, "Feedback too large (screenshot max 1.5 MB).");
  const form = await parseForm(body, request.headers.get("content-type") ?? "");
  if (typeof form === "string") return errorJson(form.includes("too large") ? 413 : 400, form);
  if (!isFeedbackCategory(form.category)) return errorJson(400, "bad category");
  const message = cleanFeedbackMessage(form.message);
  if (!message) return errorJson(400, "Please write a few words.");

  let shot: ScreenshotInfo | null = null;
  if (form.shot) {
    const v = checkScreenshot(form.shot);
    if (!v.ok) return errorJson(v.status, v.error);
    shot = v.info;
  }

  // Server-made id and key: nothing the client sends ends up in a path.
  const id = crypto.randomUUID();
  const key = shot ? `feedback/${id}.${shot.ext}` : null;
  const ok = await store.insertFeedback(env.DB, {
    id,
    userId: user.id,
    userName: sanitizeName(user.name),
    guest: user.isGuest,
    category: form.category,
    message,
    screenshotKey: key,
    screenshotType: shot?.mime ?? null,
    info: cleanClientInfo(form.info),
    createdAt: now,
  });
  if (!ok) return errorJson(429, RATE_TEXT);
  if (key && shot && form.shot) {
    try {
      await env.FILES.put(key, form.shot, {
        httpMetadata: { contentType: shot.mime, contentDisposition: `inline; filename="feedback.${shot.ext}"`, cacheControl: "private, no-store" },
        customMetadata: { owner: user.id, feedback: id },
      });
    } catch (err) {
      console.error("feedback screenshot upload failed", id, err);
      await store.clearScreenshot(env.DB, id).catch(() => {});
    }
  }
  return json({ id } satisfies FeedbackSubmitted, 201);
}

async function list(request: Request, env: FeedbackEnv, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) return errorJson(403, "admins only");
  const q = new URL(request.url).searchParams;
  const rawBefore = q.get("before");
  const before = parseCursor(rawBefore);
  if (rawBefore && !before) return errorJson(400, "bad cursor");
  const rawStatus = q.get("status");
  if (rawStatus && !isFeedbackStatus(rawStatus)) return errorJson(400, "bad status");
  return json(await store.listFeedback(env.DB, { before, status: rawStatus && isFeedbackStatus(rawStatus) ? rawStatus : null }));
}

async function patch(request: Request, env: FeedbackEnv, user: AuthUser, id: string, now: number): Promise<Response> {
  const text = await readCapped(request.body, 1024);
  if (!text) return errorJson(413, "too large");
  let body: { status?: unknown };
  try {
    body = JSON.parse(new TextDecoder().decode(text)) as { status?: unknown };
  } catch {
    return errorJson(400, "bad json");
  }
  if (!body || typeof body !== "object" || !isFeedbackStatus(body.status)) return errorJson(400, "bad status");
  if (!(await store.setStatus(env.DB, id, body.status, user.id, now))) return errorJson(404, "not found");
  return json({ id, status: body.status });
}

/** Headers that keep a stored screenshot an inert image whatever its bytes say. */
export function screenshotHeaders(type: string, ext: string, size?: number): Headers {
  const h = new Headers();
  h.set("content-type", type);
  h.set("x-content-type-options", "nosniff");
  h.set("content-disposition", `inline; filename="feedback.${ext}"`);
  h.set("content-security-policy", "default-src 'none'; sandbox");
  h.set("cross-origin-resource-policy", "same-origin");
  h.set("cache-control", "private, no-store");
  h.set("referrer-policy", "no-referrer");
  if (size !== undefined) h.set("content-length", String(size));
  return h;
}

async function screenshot(env: FeedbackEnv, id: string, head: boolean): Promise<Response> {
  const ref = await store.screenshotOf(env.DB, id);
  if (!ref) return errorJson(404, "no screenshot");
  const obj = await env.FILES.get(ref.key);
  if (!obj) return errorJson(404, "no screenshot");
  const ext = ref.type === "image/png" ? "png" : ref.type === "image/jpeg" ? "jpg" : "webp";
  // The type recorded when the bytes were sniffed, not anything stored alongside the object.
  return new Response(head ? null : obj.body, { headers: screenshotHeaders(ref.type, ext, obj.size) });
}
