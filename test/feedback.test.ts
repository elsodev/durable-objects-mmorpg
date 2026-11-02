import { describe, expect, it } from "vitest";
import { checkScreenshot, hasMarkup, parseJpeg, parsePng, parseWebp } from "../src/worker/feedback/image";
import { handleFeedback, screenshotHeaders } from "../src/worker/feedback/routes";
import { serveFile } from "../src/worker/http/files";
import { isSafeFileKey } from "../src/worker/http/sniff";
import {
  FEEDBACK_MAX_BODY_BYTES,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_RATE_DAY,
  FEEDBACK_RATE_HOUR,
  SCREENSHOT_MAX_BYTES,
  cleanClientInfo,
  cleanFeedbackMessage,
  parseCursor,
  type FeedbackPage,
} from "../src/shared/feedback";
import { dragRect, encodePlan, fitWithin, toSourceRect, usableRect } from "../src/client/ui/feedback-rect-logic";
import { formState, metaLine, viewportText } from "../src/client/ui/feedback-form-logic";
import type { AuthUser } from "../src/worker/auth";
import type { Env } from "../src/worker/env";
import { createTestDb } from "./d1-sqlite";

const zlib = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process.getBuiltinModule("node:zlib") as {
  deflateSync(b: Uint8Array): Uint8Array;
};

// ---------- image builders ----------

const enc = new TextEncoder();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function be32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
function le32(n: number): Uint8Array {
  return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
}

function chunk(type: string, data: Uint8Array, badCrc = false): Uint8Array {
  const td = concat(enc.encode(type), data);
  return concat(be32(data.length), td, be32(badCrc ? crc32(td) ^ 1 : crc32(td)));
}

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function png(w: number, h: number, opts: { extra?: Uint8Array[]; badCrc?: boolean } = {}): Uint8Array<ArrayBuffer> {
  const ihdr = concat(be32(w), be32(h), new Uint8Array([8, 6, 0, 0, 0]));
  const raw = new Uint8Array(Math.min(h, 4) * (1 + Math.min(w, 4) * 4));
  return concat(PNG_SIG, chunk("IHDR", ihdr), ...(opts.extra ?? []), chunk("IDAT", zlib.deflateSync(raw), opts.badCrc), chunk("IEND", new Uint8Array(0)));
}

function jpeg(w: number, h: number): Uint8Array<ArrayBuffer> {
  const app0 = concat(new Uint8Array([0xff, 0xe0, 0x00, 0x10]), enc.encode("JFIF\0"), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0]));
  const sof = new Uint8Array([0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const sos = new Uint8Array([0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);
  const scan = new Uint8Array([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);
  return concat(new Uint8Array([0xff, 0xd8]), app0, sof, sos, scan, new Uint8Array([0xff, 0xd9]));
}

function webpLossless(w: number, h: number): Uint8Array {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  const data = concat(new Uint8Array([0x2f]), le32(bits), new Uint8Array([0, 0, 0]));
  const body = concat(enc.encode("WEBP"), enc.encode("VP8L"), le32(data.length), data);
  return concat(enc.encode("RIFF"), le32(body.length), body);
}

function webpLossy(w: number, h: number): Uint8Array {
  const data = new Uint8Array([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, w & 255, (w >> 8) & 0x3f, h & 255, (h >> 8) & 0x3f, 0, 0]);
  const body = concat(enc.encode("WEBP"), enc.encode("VP8 "), le32(data.length), data);
  return concat(enc.encode("RIFF"), le32(body.length), body);
}

// ---------- sniffing ----------

describe("feedback screenshot validation", () => {
  it("accepts well-formed PNG, JPEG and WebP and reads their size from the header", () => {
    expect(parsePng(png(320, 200))).toEqual({ width: 320, height: 200 });
    expect(parseJpeg(jpeg(640, 360))).toEqual({ width: 640, height: 360 });
    expect(parseWebp(webpLossless(800, 450))).toEqual({ width: 800, height: 450 });
    expect(parseWebp(webpLossy(1024, 576))).toEqual({ width: 1024, height: 576 });
    const v = checkScreenshot(png(10, 10));
    expect(v).toEqual({ ok: true, info: { mime: "image/png", ext: "png", width: 10, height: 10 } });
    expect(checkScreenshot(jpeg(10, 10))).toMatchObject({ ok: true, info: { mime: "image/jpeg", ext: "jpg" } });
    expect(checkScreenshot(webpLossless(10, 10))).toMatchObject({ ok: true, info: { mime: "image/webp", ext: "webp" } });
  });

  it("rejects SVG, HTML and other formats by their bytes", () => {
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', "<!doctype html><script>alert(1)</script>", "<?xml version='1.0'?><svg/>", "GIF89a\x01\x00\x01\x00"]) {
      expect(checkScreenshot(enc.encode(text))).toMatchObject({ ok: false, status: 415 });
    }
    expect(checkScreenshot(new Uint8Array(0))).toMatchObject({ ok: false });
  });

  it("rejects polyglots: a PNG signature on HTML, HTML after IEND, markup in a text chunk", () => {
    const sigThenHtml = concat(PNG_SIG, enc.encode("<html><body><script>alert(document.cookie)</script></body></html>".padEnd(80, " ")));
    expect(checkScreenshot(sigThenHtml)).toMatchObject({ ok: false, status: 422 });
    const trailing = concat(png(8, 8), enc.encode("<script>alert(1)</script>"));
    expect(parsePng(trailing)).toBeNull();
    expect(checkScreenshot(trailing)).toMatchObject({ ok: false });
    const textChunk = png(8, 8, { extra: [chunk("tEXt", enc.encode("Comment\0<script>alert(1)</script>"))] });
    expect(parsePng(textChunk)).not.toBeNull(); // a structurally valid PNG...
    expect(checkScreenshot(textChunk)).toMatchObject({ ok: false, status: 422 }); // ...that still carries markup
    const jpegTail = concat(jpeg(8, 8), enc.encode("<html>"));
    expect(checkScreenshot(jpegTail)).toMatchObject({ ok: false });
    const riff = webpLossless(8, 8);
    expect(checkScreenshot(concat(riff, enc.encode("<svg>")))).toMatchObject({ ok: false });
  });

  it("rejects broken files: bad CRC, truncated, wrong RIFF size, JPEG without a frame", () => {
    expect(parsePng(png(8, 8, { badCrc: true }))).toBeNull();
    const good = png(8, 8);
    expect(parsePng(good.subarray(0, good.length - 5))).toBeNull();
    const w = webpLossless(8, 8);
    w[4] = (w[4]! + 2) & 255;
    expect(parseWebp(w)).toBeNull();
    expect(parseJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(parseJpeg(jpeg(8, 8).subarray(0, 30))).toBeNull();
  });

  it("enforces the byte cap and the dimension limits", () => {
    expect(checkScreenshot(new Uint8Array(SCREENSHOT_MAX_BYTES + 1))).toMatchObject({ ok: false, status: 413 });
    expect(checkScreenshot(png(4000, 10))).toMatchObject({ ok: false, status: 422 });
    expect(checkScreenshot(png(10, 2049))).toMatchObject({ ok: false, status: 422 });
    expect(checkScreenshot(jpeg(0, 10))).toMatchObject({ ok: false, status: 422 });
    expect(checkScreenshot(png(2048, 2048))).toMatchObject({ ok: true });
  });

  it("spots markup only as whole tags", () => {
    expect(hasMarkup(enc.encode("xx<SCRIPT src=a>"))).toBe(true);
    expect(hasMarkup(enc.encode("<svg/onload=x>"))).toBe(true);
    expect(hasMarkup(enc.encode("a<b and c<sv g"))).toBe(false);
  });
});

// ---------- text ----------

describe("feedback text cleaning", () => {
  it("strips control and format characters but keeps newlines", () => {
    expect(cleanFeedbackMessage("  The\u0000 crop‮ vanished​!\r\n\r\n\r\n\r\nAfter rain\t.  ")).toBe("The crop vanished!\n\nAfter rain  .");
    expect(cleanFeedbackMessage("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>"); // kept as text; shown with textContent
  });

  it("caps length in code points and refuses near-empty text", () => {
    expect(cleanFeedbackMessage("🐞".repeat(FEEDBACK_MESSAGE_MAX + 50))).toBe("🐞".repeat(FEEDBACK_MESSAGE_MAX));
    expect(cleanFeedbackMessage("  ​\u0007 ")).toBeNull();
    expect(cleanFeedbackMessage("ok")).toBeNull();
    expect(cleanFeedbackMessage(42)).toBeNull();
  });

  it("keeps client info to tight shapes", () => {
    expect(cleanClientInfo({ zone: "village", x: 12.4, y: -3, viewport: "1280x720@2", renderer: "webgpu", userAgent: "Mozilla\u0000/5.0\n x" })).toEqual({
      zone: "village",
      x: 12,
      y: -3,
      viewport: "1280x720@2",
      renderer: "webgpu",
      userAgent: "Mozilla/5.0 x",
    });
    const bad = cleanClientInfo({ zone: "../etc", x: 1e9, y: "4", viewport: "<b>", renderer: "x".repeat(40), userAgent: "a".repeat(1000) });
    expect(bad).toMatchObject({ zone: null, x: null, y: null, viewport: null });
    expect(bad.renderer).toHaveLength(16);
    expect(bad.userAgent).toHaveLength(256);
    expect(cleanClientInfo("nope")).toMatchObject({ zone: null, userAgent: null });
  });

  it("form state mirrors the server", () => {
    expect(formState("", false)).toMatchObject({ counter: "0 / 1000", canSend: false });
    expect(formState("It broke", false)).toMatchObject({ canSend: true, warn: false });
    expect(formState("It broke", true).canSend).toBe(false);
    expect(formState("x".repeat(1001), false)).toMatchObject({ canSend: false, warn: true });
    expect(viewportText(1280.4, 719.6, 2)).toBe("1280x720@2");
  });

  it("admin meta line", () => {
    expect(metaLine({ zone: "caves", x: 4, y: 9, viewport: "800x600@1", renderer: "webgl" })).toBe("caves (4, 9) · 800x600@1 · webgl");
    expect(metaLine({ zone: null, x: null, y: null, viewport: null, renderer: null })).toBe("");
  });
});

// ---------- drag rectangle ----------

describe("feedback drag rectangle", () => {
  const view = { w: 1000, h: 600 };
  it("normalises either drag direction and clamps to the view", () => {
    expect(dragRect({ x: 300, y: 200 }, { x: 100, y: 50 }, view)).toEqual({ x: 100, y: 50, w: 200, h: 150 });
    expect(dragRect({ x: -50, y: 550 }, { x: 1200, y: 700 }, view)).toEqual({ x: 0, y: 550, w: 1000, h: 50 });
  });
  it("ignores taps", () => {
    expect(usableRect(dragRect({ x: 10, y: 10 }, { x: 20, y: 200 }, view))).toBe(false);
    expect(usableRect(dragRect({ x: 10, y: 10 }, { x: 40, y: 40 }, view))).toBe(true);
    expect(usableRect(null)).toBe(false);
  });
  it("maps CSS pixels to capture pixels without leaving the source", () => {
    expect(toSourceRect({ x: 100, y: 50, w: 200, h: 150 }, view, { w: 2000, h: 1200 })).toEqual({ x: 200, y: 100, w: 400, h: 300 });
    expect(toSourceRect({ x: 990, y: 590, w: 50, h: 50 }, view, { w: 1000, h: 600 })).toEqual({ x: 990, y: 590, w: 10, h: 10 });
    expect(toSourceRect({ x: 1.5, y: 0, w: 0.2, h: 0 }, view, { w: 1500, h: 900 }).w).toBeGreaterThanOrEqual(1);
  });
  it("downscales to the long-side cap and never upscales", () => {
    expect(fitWithin({ w: 3200, h: 1800 }, 1600)).toEqual({ w: 1600, h: 900 });
    expect(fitWithin({ w: 900, h: 2400 }, 1600)).toEqual({ w: 600, h: 1600 });
    expect(fitWithin({ w: 300, h: 200 }, 1600)).toEqual({ w: 300, h: 200 });
  });
  it("tries WebP first, then smaller, then JPEG", () => {
    const plan = encodePlan(1600);
    expect(plan[0]).toEqual({ type: "image/webp", quality: 0.9, maxSide: 1600 });
    expect(plan.every((s, i) => i === 0 || s.maxSide <= 1600)).toBe(true);
    expect(plan[plan.length - 1]!.type).toBe("image/jpeg");
  });
});

// ---------- routes ----------

const ORIGIN = "https://mossbrook.test";

class FakeR2 {
  objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; opts: R2PutOptions | undefined }>();
  async put(key: string, value: Uint8Array, opts?: R2PutOptions) {
    this.objects.set(key, { bytes: new Uint8Array(value), opts });
    return {};
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return {
      body: new Response(o.bytes).body,
      size: o.bytes.length,
      httpEtag: '"x"',
      writeHttpMetadata(h: Headers) {
        const ct = o.opts?.httpMetadata && "contentType" in o.opts.httpMetadata ? o.opts.httpMetadata.contentType : undefined;
        if (ct) h.set("content-type", ct);
      },
    };
  }
}

function setup() {
  const t = createTestDb();
  const files = new FakeR2();
  const env = { DB: t.db, FILES: files as unknown as R2Bucket, BETTER_AUTH_URL: ORIGIN, DMMO_ENV: undefined } as unknown as Env;
  return { t, files, env };
}

const player: AuthUser = { id: "u_player", name: "Fern", email: "fern@test.local", isGuest: false, sessionId: "s1" };
const guest: AuthUser = { id: "u_guest", name: "Guest 12", email: null, isGuest: true, sessionId: "s2" };
const admin: AuthUser = { id: "u_admin", name: "Mod", email: "mod@test.local", isGuest: false, sessionId: "s3", admin: true };

function form(fields: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function post(fd: FormData, opts: { origin?: string | null; headers?: Record<string, string> } = {}): Promise<Request> {
  // Serialise to bytes so Content-Length is known, like a browser upload.
  const r = new Request("https://x/api/feedback", { method: "POST", body: fd });
  const bytes = new Uint8Array(await r.arrayBuffer());
  const headers: Record<string, string> = { "content-type": r.headers.get("content-type")!, "content-length": String(bytes.length), ...opts.headers };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  return new Request(`${ORIGIN}/api/feedback`, { method: "POST", headers, body: bytes });
}

const okFields = (extra: Record<string, string | Blob> = {}) =>
  form({ category: "bug", message: "The hen walked through the fence.", info: JSON.stringify({ zone: "village", x: 3, y: 4 }), ...extra });

describe("POST /api/feedback", () => {
  it("records a report and stores the screenshot under a server-made private key", async () => {
    const { t, files, env } = setup();
    const shot = png(64, 48);
    // The part claims to be SVG with an .svg name: the bytes decide, and they say PNG.
    const res = await handleFeedback(await post(okFields({ screenshot: new File([shot], "evil.svg", { type: "image/svg+xml" }) })), env, player, 1_000_000);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const row = t.raw.prepare(`SELECT * FROM feedback WHERE id = ?`).all(id)[0] as Record<string, unknown>;
    expect(row).toMatchObject({ user_id: "u_player", user_name: "Fern", category: "bug", status: "new", screenshot_type: "image/png", zone: "village", pos_x: 3 });
    expect(row.screenshot_key).toBe(`feedback/${id}.png`);
    const obj = files.objects.get(`feedback/${id}.png`)!;
    expect(obj.bytes).toEqual(shot);
    expect(obj.opts?.httpMetadata).toMatchObject({ contentType: "image/png" });
  });

  it("works without a screenshot and for guests", async () => {
    const { t, files, env } = setup();
    const res = await handleFeedback(await post(okFields()), env, guest, 1000);
    expect(res.status).toBe(201);
    expect(files.objects.size).toBe(0);
    expect(t.raw.prepare(`SELECT is_guest, screenshot_key FROM feedback`).all()[0]).toEqual({ is_guest: 1, screenshot_key: null });
  });

  it("refuses the unsigned-in, other origins and a missing origin", async () => {
    const { env } = setup();
    expect((await handleFeedback(await post(okFields()), env, null)).status).toBe(401);
    expect((await handleFeedback(await post(okFields(), { origin: "https://evil.test" }), env, player)).status).toBe(403);
    expect((await handleFeedback(await post(okFields(), { origin: null }), env, player)).status).toBe(403);
  });

  it("refuses malicious and oversized screenshots and records nothing", async () => {
    const { t, files, env } = setup();
    const bad: [Uint8Array, number][] = [
      [enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 415],
      [enc.encode("<!doctype html><html><script>alert(1)</script></html>"), 415],
      [concat(PNG_SIG, enc.encode("<html><script>alert(1)</script></html>".padEnd(60, " "))), 422],
      [concat(png(8, 8), enc.encode("<script>alert(1)</script>")), 422],
      [png(5000, 5000), 422],
    ];
    for (const [bytes, status] of bad) {
      const res = await handleFeedback(await post(okFields({ screenshot: new File([new Uint8Array(bytes)], "shot.png", { type: "image/png" }) })), env, player, 5000);
      expect(res.status).toBe(status);
    }
    const big = new Uint8Array(SCREENSHOT_MAX_BYTES + 10);
    big.set(PNG_SIG);
    expect((await handleFeedback(await post(okFields({ screenshot: new File([big], "a.png") })), env, player, 5000)).status).toBe(413);
    expect(t.raw.prepare(`SELECT COUNT(*) AS n FROM feedback`).all()[0]).toEqual({ n: 0 });
    expect(files.objects.size).toBe(0);
  });

  it("checks Content-Length before reading, and caps the stream when it lies", async () => {
    const { env } = setup();
    const declared = new Request(`${ORIGIN}/api/feedback`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "multipart/form-data; boundary=x", "content-length": String(FEEDBACK_MAX_BODY_BYTES + 1) },
      body: "x",
    });
    expect((await handleFeedback(declared, env, player)).status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 40; i++) c.enqueue(new Uint8Array(64 * 1024));
        c.close();
      },
    });
    const lying = new Request(`${ORIGIN}/api/feedback`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "multipart/form-data; boundary=x" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await handleFeedback(lying, env, player)).status).toBe(413);
  });

  it("refuses bad fields", async () => {
    const { env } = setup();
    const send = async (fd: FormData) => (await handleFeedback(await post(fd), env, player)).status;
    expect(await send(form({ category: "praise", message: "Lovely game!" }))).toBe(400);
    expect(await send(form({ category: "bug", message: " ​ " }))).toBe(400);
    expect(await send(form({ category: "bug", message: "hello there", info: "{not json" }))).toBe(400);
    expect(await send(form({ category: "bug", message: "hello there", screenshot: "not a file" }))).toBe(400);
    const json = new Request(`${ORIGIN}/api/feedback`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" });
    expect((await handleFeedback(json, env, player)).status).toBe(400);
  });

  it("rate limits each player per hour and per day", async () => {
    const { env } = setup();
    const at = (min: number) => 10_000_000 + min * 60_000;
    for (let i = 0; i < FEEDBACK_RATE_HOUR; i++) expect((await handleFeedback(await post(okFields()), env, player, at(i))).status).toBe(201);
    expect((await handleFeedback(await post(okFields()), env, player, at(10))).status).toBe(429);
    // Another player isn't affected.
    expect((await handleFeedback(await post(okFields()), env, guest, at(10))).status).toBe(201);
    // A new hour lets them send again, until the day's cap.
    let sent = FEEDBACK_RATE_HOUR;
    for (let hour = 1; sent < FEEDBACK_RATE_DAY; hour++) {
      for (let i = 0; i < FEEDBACK_RATE_HOUR && sent < FEEDBACK_RATE_DAY; i++, sent++) {
        expect((await handleFeedback(await post(okFields()), env, player, at(hour * 61 + i))).status).toBe(201);
      }
    }
    expect((await handleFeedback(await post(okFields()), env, player, at(23 * 60))).status).toBe(429);
  });
});

describe("admin feedback routes", () => {
  async function seeded() {
    const s = setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const fd = okFields({ message: `Report number ${i}`, ...(i === 0 ? { screenshot: new File([jpeg(32, 32)], "x.png", { type: "image/png" }) } : {}) });
      const res = await handleFeedback(await post(fd), s.env, i === 2 ? guest : player, 1_000 + i * 1000);
      ids.push(((await res.json()) as { id: string }).id);
    }
    return { ...s, ids };
  }
  const get = (path: string) => new Request(`${ORIGIN}${path}`);

  it("lists newest first in pages, admins only", async () => {
    const { env, ids } = await seeded();
    for (const who of [player, guest, { ...guest, admin: true }]) {
      expect((await handleFeedback(get("/api/feedback"), env, who)).status).toBe(403);
    }
    expect((await handleFeedback(get("/api/feedback"), env, null)).status).toBe(401);
    const res = await handleFeedback(get("/api/feedback"), env, admin);
    const page = (await res.json()) as FeedbackPage;
    expect(page.items.map((i) => i.id)).toEqual([ids[2], ids[1], ids[0]]);
    expect(page.items[0]).toMatchObject({ guest: true, userName: "Guest 12", hasScreenshot: false });
    expect(page.items[2]).toMatchObject({ hasScreenshot: true, message: "Report number 0" });
    expect(page.next).toBeNull();
  });

  it("pages with a keyset cursor and filters by status", async () => {
    const { t, env, ids } = await seeded();
    const store = await import("../src/worker/feedback/store");
    const p1 = await store.listFeedback(t.db, { limit: 2 });
    expect(p1.items.map((i) => i.id)).toEqual([ids[2], ids[1]]);
    expect(p1.next).not.toBeNull();
    const p2 = await store.listFeedback(t.db, { limit: 2, before: parseCursor(p1.next) });
    expect(p2.items.map((i) => i.id)).toEqual([ids[0]]);
    expect(p2.next).toBeNull();
    expect((await handleFeedback(get("/api/feedback?before=../../x"), env, admin)).status).toBe(400);
    expect((await handleFeedback(get("/api/feedback?status=deleted"), env, admin)).status).toBe(400);
  });

  it("marks seen / resolved, admins only, same origin only", async () => {
    const { t, env, ids } = await seeded();
    const patch = (status: unknown, origin = ORIGIN) =>
      new Request(`${ORIGIN}/api/feedback/${ids[1]}`, { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ status }) });
    expect((await handleFeedback(patch("resolved"), env, player)).status).toBe(403);
    expect((await handleFeedback(patch("resolved", "https://evil.test"), env, admin)).status).toBe(403);
    expect((await handleFeedback(patch("deleted"), env, admin)).status).toBe(400);
    expect((await handleFeedback(patch("resolved"), env, admin, 99)).status).toBe(200);
    expect(t.raw.prepare(`SELECT status, updated_by FROM feedback WHERE id = ?`).all(ids[1])[0]).toEqual({ status: "resolved", updated_by: "u_admin" });
    const resolved = (await (await handleFeedback(get("/api/feedback?status=resolved"), env, admin)).json()) as FeedbackPage;
    expect(resolved.items.map((i) => i.id)).toEqual([ids[1]]);
    const missing = new Request(`${ORIGIN}/api/feedback/00000000-0000-4000-8000-000000000000`, {
      method: "PATCH",
      headers: { origin: ORIGIN },
      body: JSON.stringify({ status: "seen" }),
    });
    expect((await handleFeedback(missing, env, admin)).status).toBe(404);
  });

  it("serves a screenshot to admins only, as an inert image with the sniffed type", async () => {
    const { env, ids } = await seeded();
    const path = `/api/feedback/${ids[0]}/screenshot`;
    expect((await handleFeedback(get(path), env, player)).status).toBe(403);
    expect((await handleFeedback(get(path), env, null)).status).toBe(401);
    const res = await handleFeedback(get(path), env, admin);
    expect(res.status).toBe(200);
    // Uploaded as "x.png" / image/png, but the bytes were JPEG: served as JPEG.
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="feedback.jpg"');
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(jpeg(32, 32));
    expect((await handleFeedback(get(`/api/feedback/${ids[1]}/screenshot`), env, admin)).status).toBe(404);
    expect((await handleFeedback(get(`/api/feedback/..%2F..%2Fuploads/screenshot`), env, admin)).status).toBe(404);
  });

  it("never serves feedback screenshots through the public /files/* route", async () => {
    const { env, files, ids } = await seeded();
    const key = [...files.objects.keys()][0]!;
    expect(key).toBe(`feedback/${ids[0]}.jpg`);
    expect(isSafeFileKey(key)).toBe(false);
    expect(isSafeFileKey("FEEDBACK/x.png")).toBe(false);
    for (const p of [`/files/${key}`, `/files/${encodeURIComponent(key)}`, `/files/Feedback/${ids[0]}.jpg`]) {
      expect((await serveFile(get(p), env, p)).status).toBe(404);
    }
  });

  it("screenshot headers", () => {
    const h = screenshotHeaders("image/webp", "webp", 10);
    expect(h.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(h.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(h.get("content-length")).toBe("10");
  });
});

describe("feedback migration", () => {
  it("creates the table with the expected columns and constraints", () => {
    const { raw } = createTestDb();
    const cols = (raw.prepare(`PRAGMA table_info(feedback)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual([
      "id", "user_id", "user_name", "is_guest", "category", "message", "screenshot_key", "screenshot_type", "zone", "pos_x", "pos_y",
      "viewport", "renderer", "user_agent", "created_at", "status", "updated_at", "updated_by",
    ]);
    const ins = (category: string, status: string, key: string | null) =>
      raw.prepare(`INSERT INTO feedback (id, user_id, user_name, category, message, screenshot_key, created_at, status) VALUES (?, 'u', 'n', ?, 'hello', ?, 1, ?)`).run(crypto.randomUUID(), category, key, status);
    expect(() => ins("bug", "new", "feedback/a.png")).not.toThrow();
    expect(() => ins("spam", "new", null)).toThrow();
    expect(() => ins("bug", "deleted", null)).toThrow();
    expect(() => ins("bug", "new", "uploads/u/a.png")).toThrow();
    const idx = (raw.prepare(`PRAGMA index_list(feedback)`).all() as { name: string }[]).map((i) => i.name);
    expect(idx).toEqual(expect.arrayContaining(["feedback_created_idx", "feedback_user_idx"]));
  });
});
