// POST /api/uploads (player images -> R2) and GET /files/* (serve R2 objects).
import type { Env } from "../env";
import type { AuthUser } from "../auth";
import { errorJson, json } from "./util";
import { MAX_UPLOAD_BYTES, isSafeFileKey, readCapped, sniffImage } from "./sniff";
import { checkQuota, releaseUpload, reserveUpload, uploadStats } from "./quota";

export async function handleUpload(request: Request, env: Env, user: AuthUser | null): Promise<Response> {
  if (request.method !== "POST") return errorJson(405, "method not allowed");
  if (!user) return errorJson(401, "sign in required");
  if (user.isGuest) return errorJson(403, "account required");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) return errorJson(413, "file too large (max 1 MB)");
  // Cheap pre-check (clear error, no body read); reserveUpload re-checks atomically below.
  const now = Date.now();
  const pre = checkQuota(await uploadStats(env, user.id, now), Math.max(0, declared || 0));
  if (!pre.ok) return errorJson(pre.status, pre.error);

  const bytes = await readCapped(request.body, MAX_UPLOAD_BYTES);
  if (!bytes) return errorJson(413, "file too large (max 1 MB)");
  const kind = sniffImage(bytes);
  if (!kind) return errorJson(415, "only PNG or WebP images");

  const key = `uploads/${user.id}/${crypto.randomUUID()}.${kind.ext}`;
  if (!(await reserveUpload(env, user.id, key, bytes.byteLength, now))) {
    const v = checkQuota(await uploadStats(env, user.id, now), bytes.byteLength);
    return v.ok ? errorJson(429, "too many uploads, try again later") : errorJson(v.status, v.error);
  }
  try {
    await env.FILES.put(key, bytes, {
      httpMetadata: { contentType: kind.mime, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { owner: user.id },
    });
  } catch (err) {
    await releaseUpload(env, key).catch(() => {});
    throw err;
  }
  return json({ key, url: `/files/${key}` }, 201);
}

export async function serveFile(request: Request, env: Env, pathname: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return errorJson(405, "method not allowed");
  let key: string;
  try {
    key = decodeURIComponent(pathname.slice("/files/".length));
  } catch {
    return errorJson(400, "bad path");
  }
  if (!isSafeFileKey(key)) return errorJson(404, "not found");
  const obj = await env.FILES.get(key);
  if (!obj) return errorJson(404, "not found");

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=3600");
  return new Response(request.method === "HEAD" ? null : obj.body, { headers });
}
