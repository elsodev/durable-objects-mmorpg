// Release QA pass: every mechanic, the clock, the economy and the UI, measured where it can be,
// with numbered screenshots (qa-NN-*.png) for a visual check.
// Prereqs: `npm run db:migrate:local` and `npm run dev:local` running (DEV_TOOLS on, captcha off).
// Usage: node scripts/e2e-qa.mjs   (env: BASE_URL, SHOTS_DIR, PHASES=onboard,move,farm,...)
// Local only: it clears the local D1 rateLimit table first (sign-ups are capped at 5 per IP per hour).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(`${process.cwd()}/package.json`);

async function loadChromium() {
  try {
    return { chromium: require("playwright").chromium, opts: {} };
  } catch {
    const pw = await import("playwright-core");
    const executablePath = process.env.CHROMIUM_PATH ?? ["/opt/pw-browsers/chromium", "/usr/bin/chromium"].find((p) => existsSync(p));
    return { chromium: pw.chromium, opts: executablePath ? { executablePath } : {} };
  }
}

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const SHOTS = (process.env.SHOTS_DIR ?? "test-results/qa").replace(/\/?$/, "/");
const PH = (process.env.PHASES ?? "all").split(",");
const on = (p) => PH.includes("all") || PH.includes(p);
const LOG = [];
const errors = [];
const log = (...a) => { const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "); LOG.push(s); console.log(s); };
const check = (name, ok, detail = "") => { log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== "" ? " — " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); return ok; };

async function shot(page, name) { await page.screenshot({ path: `${SHOTS}${name}.png` }); log("shot", name); }
const wait = (page, ms) => page.waitForTimeout(ms);

const state = (page) => page.evaluate(() => {
  const d = window.__dmmo; if (!d) return null;
  const ents = d.entities(); const me = d.you();
  return { zone: d.zone, you: me?.id, me: me ? { x: me.x, y: me.y, facing: me.facing, act: me.act, hp: me.hp } : null,
    ents: ents.map((e) => ({ id: e.id, kind: e.kind, name: e.name, x: e.x, y: e.y, facing: e.facing, act: e.act, npcId: e.npcId, sprite: e.sprite, hp: e.hp })) };
});
const send = (page, msg) => page.evaluate((m) => window.__dmmo.send(m), msg);
async function waitFor(page, pred, what, timeout = 15000, quiet = false) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { last = await state(page).catch(() => null); if (last && pred(last)) return last; await wait(page, 120); }
  if (!quiet) check(what, false, `timeout last=${JSON.stringify(last?.me)}`); return null;
}
async function walk(page, x, y, what = `walk ${x},${y}`, timeout = 25000, quiet = false) {
  await page.evaluate(([x, y]) => window.__dmmo.moveTo(x, y), [x, y]);
  return waitFor(page, (s) => s.me && Math.hypot(s.me.x - x, s.me.y - y) < 0.6, what, timeout, quiet);
}
/** Walks through an exit and waits for the new map's welcome (zone, or homeMap "home"/"home_in"). */
async function moveInto(page, x, y, zone, homeMap) {
  const n = (await msgs(page, "welcome")).length;
  await page.evaluate(([x, y]) => window.__dmmo.moveTo(x, y), [x, y]);
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const w = await msgs(page, "welcome");
    const s = await state(page);
    if (w.length > n && s?.zone === zone && s.me && (!homeMap || w.at(-1).homeMap === homeMap)) { await wait(page, 400); return s; }
    await wait(page, 150);
  }
  check(`enter ${zone}${homeMap ? "/" + homeMap : ""}`, false, JSON.stringify((await state(page))?.me));
  return null;
}
async function homeMapOf(page) {
  return page.evaluate(() => [...window.__msgs].reverse().find((m) => m.t === "welcome")?.homeMap ?? null);
}
async function chat(page, text) {
  await page.click("#chat-input");
  await page.fill("#chat-input", text);
  await page.press("#chat-input", "Enter");
  await wait(page, 300);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.mouse.move(900, 300);
}
const cmd = (page, text) => send(page, { t: "chat", text });
const msgs = (page, t) => page.evaluate((t) => window.__msgs.filter((m) => !t || m.t === t), t);
const clearMsgs = (page) => page.evaluate(() => { window.__msgs.length = 0; });
const inv = (page) => page.evaluate(() => window.__dmmo.inventory());
const slotOf = (page, id) => page.evaluate((id) => window.__dmmo.inventory().slots.findIndex((s) => s?.item === id), id);
const qtyOf = (page, id) => page.evaluate((id) => window.__dmmo.inventory().slots.filter((s) => s?.item === id).reduce((a, s) => a + s.qty, 0), id);
const coins = (page) => page.evaluate(() => window.__dmmo.inventory().coins);
const lastOf = async (page, t) => (await msgs(page, t)).at(-1);
const sfx = (page) => page.evaluate(() => window.__sfx.slice());
/** Sends a tool use and waits for the server's answer (anything but tick). */
async function use(page, item, x, y, ms = 650) {
  const slot = typeof item === "number" ? item : await slotOf(page, item);
  await send(page, { t: "use", slot, x, y });
  await wait(page, ms);
  return slot;
}
async function farmMap(page) {
  return page.evaluate(() => {
    const farm = {};
    for (const m of window.__msgs) {
      if (m.t === "welcome" && m.farm) { for (const k of Object.keys(farm)) delete farm[k]; for (const t of m.farm) farm[t.x + "," + t.y] = t; }
      if (m.t === "farm") for (const t of m.tiles) farm[t.x + "," + t.y] = t;
      if (m.t === "farmAll") { for (const k of Object.keys(farm)) delete farm[k]; for (const t of m.tiles) farm[t.x + "," + t.y] = t; }
    }
    return farm;
  });
}
async function dismiss(page) {
  for (const sel of ["#summary-ok", "#tutorial-ok"]) if (await page.isVisible(sel).catch(() => false)) await page.click(sel).catch(() => {});
}

async function newPlayer(chromium, opts, label, viewport = { width: 1280, height: 800 }) {
  const browser = await chromium.launch(opts);
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => {
    window.__msgs = [];
    window.__sfx = [];
    const Orig = window.WebSocket;
    window.WebSocket = class extends Orig {
      constructor(...a) {
        super(...a);
        this.addEventListener("message", (ev) => {
          try { const m = JSON.parse(ev.data); if (m.t !== "tick" && m.t !== "pong") { m.__at = performance.now(); window.__msgs.push(m); if (window.__msgs.length > 800) window.__msgs.shift(); } } catch {}
        });
        const s = this.send.bind(this);
        this.send = (d) => { try { const m = JSON.parse(d); if (m.t === "use" || m.t === "buy" || m.t === "sell") (window.__sent ??= []).push({ ...m, __at: performance.now() }); } catch {} return s(d); };
      }
    };
    // Sound log: tag fetched audio buffers with their URL and log every buffer that starts.
    const urlOf = new WeakMap();
    const ab = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = async function () { const b = await ab.call(this); try { urlOf.set(b, this.url); } catch {} return b; };
    const AC = window.AudioContext;
    if (AC) {
      const dec = AC.prototype.decodeAudioData;
      AC.prototype.decodeAudioData = function (data, ok, bad) {
        const url = urlOf.get(data);
        const wrap = (buf) => { try { buf.__url = url; } catch {} ok?.(buf); };
        const p = dec.call(this, data, wrap, bad);
        return p?.then?.((buf) => { try { buf.__url = url; } catch {} return buf; });
      };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...a) {
        const u = this.buffer?.__url ?? "?";
        window.__sfx.push(u.split("/").pop().replace(/\.(ogg|mp3|wav)$/, ""));
        if (window.__sfx.length > 400) window.__sfx.shift();
        return start.apply(this, a);
      };
    }
  });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] console ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror ${e.message} ${e.stack?.split("\n").slice(0, 3).join(" ")}`));
  return { browser, ctx, page, label };
}

async function signup(page, name, email, body = "male", randomize = 0) {
  await page.goto(BASE);
  await page.click("#auth-tab-signup");
  await page.fill("#auth-name", name);
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", "correct-horse-42");
  await page.click("#auth-submit");
  await page.waitForSelector("#creator", { timeout: 25000 });
  await page.click("#creator-tab-body");
  await page.click(`.creator-swatches [data-option="${body}"]`);
  for (let i = 0; i < randomize; i++) { await page.click("#creator-random"); await wait(page, 150); }
  await page.click("#creator-save");
  await page.waitForFunction(() => !!window.__dmmo?.you(), null, { timeout: 25000 });
  await wait(page, 800);
  await dismiss(page);
}

/** Overlap of two DOM rects (both visible). */
async function overlaps(page, a, b) {
  return page.evaluate(([a, b]) => {
    const ea = document.querySelector(a), eb = document.querySelector(b);
    if (!ea || !eb) return null;
    const ra = ea.getBoundingClientRect(), rb = eb.getBoundingClientRect();
    if (!ra.width || !rb.width) return null;
    const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
    const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
    return ix * iy;
  }, [a, b]);
}
/** Visible elements whose text is clipped (scrollWidth > clientWidth with overflow hidden / ellipsis). */
async function clippedText(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("#ui *")) {
      if (!(el instanceof HTMLElement) || el.children.length > 0 || !el.textContent?.trim()) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      if (el.scrollWidth > el.clientWidth + 1 && (cs.overflow !== "visible" || cs.textOverflow === "ellipsis")) out.push(`${el.id || el.className}: "${el.textContent.trim().slice(0, 30)}"`);
      const scroller = (() => { for (let a = el.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll") return true; } return false; })();
      if (!scroller && (r.right > innerWidth + 1 || r.left < -1)) out.push(`offscreen ${el.id || el.className}: "${el.textContent.trim().slice(0, 30)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return out.slice(0, 20);
  });
}

export { BASE, SHOTS, on, log, check, shot, wait, state, send, waitFor, walk, moveInto, homeMapOf, chat, cmd, msgs, clearMsgs, inv, slotOf, qtyOf, coins, lastOf, sfx, use, farmMap, dismiss, newPlayer, signup, overlaps, clippedText, errors, LOG, loadChromium };

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  execSync('npx wrangler d1 execute durable-mmo-auth --local --env local --command "DELETE FROM rateLimit"', { stdio: "ignore", timeout: 60000, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  const { chromium, opts } = await loadChromium();
  const stamp = Date.now().toString(36).slice(-5);
  const ctx = { chromium, opts, stamp, players: [] };
  const phases = (await import("./qa/phases.mjs")).PHASES;
  for (const [name, fn] of phases) {
    if (!on(name)) continue;
    log(`---------- ${name} ----------`);
    try { await fn(ctx); } catch (e) { check(`phase ${name} ran`, false, String(e?.stack ?? e).slice(0, 600)); }
  }
  for (const p of ctx.players) await p.browser.close().catch(() => {});
  log("ERRORS", errors.length); for (const e of errors) log(e);
  const failed = LOG.filter((l) => l.startsWith("FAIL"));
  log(failed.length ? `${failed.length} CHECKS FAILED` : "ALL CHECKS PASSED");
  writeFileSync(`${SHOTS}qa-log.txt`, LOG.join("\n"));
  process.exitCode = failed.length || errors.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error("CRASH", e); process.exit(1); });
