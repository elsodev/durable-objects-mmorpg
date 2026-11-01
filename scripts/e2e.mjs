// End-to-end browser test for DurableMMO.
// Prereqs: `npm run db:migrate:local` and the Worker running on BASE_URL (default http://localhost:8787,
// started with `npm run dev:local`, NPC_AI_MODE=off so NPCs answer with scripted lines).
// Usage: npm run e2e   (env: BASE_URL, SHOTS_DIR, CHROMIUM_PATH, HEADED=1)
//
// Debug hook contract this test relies on (client exposes it on window.__dmmo):
//   renderer: "webgpu" | "webgl"
//   zone: ZoneId
//   you: string                         // own entity id
//   entities: Map<string, EntityState> | EntityState[]
//   send(msg: ClientMsg): void          // raw intent, same path as the HUD
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const BASE = process.env.BASE_URL ?? "http://localhost:8787"; // e.g. BASE_URL=http://localhost:8789
const SHOTS = (process.env.SHOTS_DIR ?? "test-results/e2e").replace(/\/?$/, "/");
const require = createRequire(import.meta.url);

/** Prefer an installed `playwright`; fall back to playwright-core with CHROMIUM_PATH (or a system Chromium). */
async function loadChromium() {
  try {
    const pw = require("playwright");
    return { chromium: pw.chromium, opts: {} };
  } catch {
    const pw = await import("playwright-core");
    const executablePath =
      process.env.CHROMIUM_PATH ?? ["/opt/pw-browsers/chromium", "/usr/bin/chromium"].find((p) => existsSync(p));
    return { chromium: pw.chromium, opts: executablePath ? { executablePath } : {} };
  }
}

const results = [];
const consoleErrors = [];
function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) throw new Error(`step failed: ${name} ${detail}`);
}

async function shot(page, name) {
  try { await page.screenshot({ path: `${SHOTS}${name}.png` }); } catch (e) { console.warn("screenshot", name, e.message); }
}

/** Reads a snapshot of the debug state from the page. */
const state = (page) =>
  page.evaluate(() => {
    const d = window.__dmmo;
    if (!d) return null;
    // The client exposes entities()/you() as functions; older builds exposed plain values.
    const raw = typeof d.entities === "function" ? d.entities() : d.entities;
    const ents = raw instanceof Map ? [...raw.values()] : Array.isArray(raw) ? raw : Object.values(raw ?? {});
    const youId = typeof d.you === "function" ? d.you()?.id : d.you;
    const me = ents.find((e) => e.id === youId);
    return { renderer: d.renderer, zone: d.zone, you: youId, me: me ? { x: me.x, y: me.y } : null,
      ents: ents.map((e) => ({ id: e.id, kind: e.kind, name: e.name, x: e.x, y: e.y })) };
  });

const send = (page, msg) => page.evaluate((m) => window.__dmmo.send(m), msg);

async function waitFor(page, pred, what, timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await state(page);
    if (last && pred(last)) return last;
    await page.waitForTimeout(150);
  }
  step(what, false, `timeout; last=${JSON.stringify(last)?.slice(0, 300)}`);
}

async function newPlayer(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Record server rejects so steps can assert their actions were accepted.
  await ctx.addInitScript(() => {
    window.__e2eRejects = [];
    const Orig = window.WebSocket;
    window.WebSocket = class extends Orig {
      constructor(...a) {
        super(...a);
        this.addEventListener("message", (ev) => {
          try {
            const m = JSON.parse(ev.data);
            if (m.t === "reject" && m.action !== "move" && m.action !== "moveTo") window.__e2eRejects.push(`${m.action}: ${m.reason}`);
          } catch {}
        });
      }
    };
  });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`[${label}] ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`[${label}] pageerror ${e.message}`));
  await page.goto(BASE);
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `${label}-${stamp}@e2e.test`;
  await page.click("#auth-tab-signup");
  await page.fill("#auth-name", `${label}${stamp.slice(-4)}`);
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", "correct-horse-42");
  await page.click("#auth-submit");
  await page.waitForSelector("canvas", { timeout: 15000 });
  // New accounts get the character creator first; keep the default look.
  await page.click("#creator-save", { timeout: 15000 });
  // First visit shows the controls card; it holds game keys until dismissed.
  await page.click("#tutorial-ok", { timeout: 15000 });
  const s = await waitFor(page, (s) => !!s.you && !!s.me, `${label}: connected with own entity`, 15000);
  return { ctx, page, email, state: s };
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const { chromium, opts } = await loadChromium();
  const browser = await chromium.launch({ ...opts, headless: !process.env.HEADED });

  // ---- Player A: sign up, renderer, spawn ----
  const A = await newPlayer(browser, "alice");
  const pa = A.page;
  await shot(pa, "01-spawn");
  step("renderer is webgpu or webgl", ["webgpu", "webgl"].includes(A.state.renderer), A.state.renderer);
  step("first spawn is village", A.state.zone === "village", A.state.zone);

  // ---- WASD movement ----
  const before = A.state.me;
  await pa.keyboard.down("d"); await pa.waitForTimeout(700); await pa.keyboard.up("d");
  await pa.keyboard.down("s"); await pa.waitForTimeout(500); await pa.keyboard.up("s");
  const moved = await waitFor(pa, (s) => s.me && (s.me.x !== before.x || s.me.y !== before.y), "WASD moves player");
  step("WASD moves player", true, `${JSON.stringify(before)} -> ${JSON.stringify(moved.me)}`);
  await shot(pa, "02-moved");

  // ---- Chat ----
  await pa.keyboard.press("Enter");
  await pa.keyboard.type("hello mossbrook");
  await pa.keyboard.press("Enter");
  await pa.waitForFunction(() => document.querySelector("#chat-log")?.textContent?.includes("hello mossbrook"), null, { timeout: 5000 });
  step("chat message appears in #chat-log", true);

  // ---- NPC talk (odette, the market seed seller) ----
  // NPCs follow UTC daily routines (Odette keeps her stall 08-18). Local dev servers accept
  // "/hour N" (DEV_TOOLS) to run the routines at midday; elsewhere it is just a chat line.
  await send(pa, { t: "chat", text: "/hour 12" });
  const isOdette = (e) => e.kind === "npc" && /odette/i.test(e.id + e.name);
  await waitFor(pa, (s) => s.ents.some(isOdette), "odette at her stall", 10000);
  const npc = (await state(pa)).ents.find(isOdette);
  step("odette present in village", !!npc);
  await send(pa, { t: "moveTo", x: Math.round(npc.x), y: Math.round(npc.y) + 1 });
  await waitFor(pa, (s) => s.me && Math.hypot(s.me.x - npc.x, s.me.y - npc.y) < 2.5, "walk near odette", 20000);
  // `me` is the client prediction; give the server a moment to catch up before talking.
  await pa.waitForTimeout(800);
  const chatBefore = await pa.textContent("#chat-log");
  await send(pa, { t: "interact", target: npc.id });
  await pa.waitForFunction((n) => (document.querySelector("#chat-log")?.textContent ?? "").length > n, chatBefore.length, { timeout: 8000 });
  step("NPC replies in chat", true);

  // ---- Shop: buy seeds ----
  await pa.waitForSelector("#shop-dialog, #shop, .shop, [data-shop]", { timeout: 8000 });
  await shot(pa, "03-shop");
  await send(pa, { t: "buy", npc: npc.id, item: "seed_turnip", qty: 3 });
  await pa.waitForTimeout(800);
  step("bought seeds", true);

  // ---- Travel home ----
  await send(pa, { t: "moveTo", x: 0, y: 23 }); // village west exit (rows 22-25); server should zone us
  await waitFor(pa, (s) => s.zone === "home", "travel home via west exit", 30000);
  await shot(pa, "04-home");
  step("arrived home", true);

  // ---- Farming: hoe, seed, water on a plot (slots per starting inventory: 0 hoe, 1 can, seeds found by id) ----
  // A tile in the fenced field (any yard grass can be farmed). Tools only reach ~2 tiles, so stand next to it first.
  const tile = { x: 24, y: 6 };
  await send(pa, { t: "moveTo", x: tile.x + 0.5, y: tile.y + 1.5 });
  await waitFor(pa, (s) => s.me && Math.hypot(s.me.x - (tile.x + 0.5), s.me.y - (tile.y + 1.5)) < 0.3, "walk to the farm plot", 20000);
  await pa.waitForTimeout(600);
  const slotOf = (id) => pa.evaluate((id) => (typeof window.__dmmo.inventory === "function" ? window.__dmmo.inventory() : window.__dmmo.inventory)?.slots.findIndex((s) => s?.item === id), id);
  for (const item of ["hoe", "seed_turnip", "watering_can"]) {
    const slot = await slotOf(item);
    step(`have ${item}`, slot >= 0, `slot ${slot}`);
    await send(pa, { t: "use", slot, x: tile.x, y: tile.y });
    await pa.waitForTimeout(500);
  }
  const farmMsgs = await pa.evaluate(() => window.__e2eRejects.slice());
  step("farming actions accepted", farmMsgs.length === 0, farmMsgs.join(" | "));
  await shot(pa, "05-farm");

  // ---- Build mode: place a chair ----
  const chairSlot = await slotOf("chair_wood");
  if (chairSlot >= 0) {
    // Furniture goes inside the house: walk through its door (8,10) into the house map.
    await send(pa, { t: "moveTo", x: 8.5, y: 10.5 });
    await waitFor(pa, (s) => s.me && s.me.x < 13 && s.me.y < 10, "walk into the house", 20000);
    await pa.waitForTimeout(800);
    await send(pa, { t: "place", slot: chairSlot, x: 6, y: 6, rotation: 0 });
    await pa.waitForTimeout(800);
    await shot(pa, "06-chair");
    const rejects = await pa.evaluate(() => window.__e2eRejects.slice());
    step("placed chair", (await slotOf("chair_wood")) < 0 && rejects.length === 0, rejects.join(" | "));
  } else step("have chair_wood to place", false);

  // ---- Home isolation: B cannot reach A's home ----
  const B = await newPlayer(browser, "bob");
  const pb = B.page;
  const sneaky = await pb.evaluate(async (base) => {
    const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws/home");
    return await new Promise((res) => {
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); res(m.t === "welcome" ? m.you : "other"); ws.close(); };
      ws.onerror = () => res("error");
      setTimeout(() => res("timeout"), 5000);
    });
  }, BASE);
  step("B's /ws/home is not A's home", sneaky !== A.state.you, sneaky);
  // That probe took B's session lease (one live session per player), so B's tab was closed: reload it.
  await pb.reload();
  await waitFor(pb, (s) => !!s.me && s.zone === "village", "B reconnected after lease probe", 20000);

  // ---- Two players see each other in the village ----
  await send(pa, { t: "moveTo", x: 39, y: 12.5 }); // home east exit (x 39, rows 11-14) back to village
  await waitFor(pa, (s) => s.zone === "village", "A back in village", 30000);
  await waitFor(pa, (s) => s.ents.filter((e) => e.kind === "player").length >= 2, "A sees B");
  await waitFor(pb, (s) => s.ents.filter((e) => e.kind === "player").length >= 2, "B sees A");
  await shot(pa, "07-two-players-a");
  await shot(pb, "08-two-players-b");
  step("both players visible", true);

  // ---- Reconnect after server-driven zone change (B: village -> riverside -> village) ----
  await send(pb, { t: "moveTo", x: 32, y: 47 });
  await waitFor(pb, (s) => s.zone === "riverside", "B zoned to riverside", 30000);
  step("reconnected after zone change", true);

  step("no browser console errors", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
  await browser.close();
}

main().then(
  () => { console.log(`\nALL ${results.length} STEPS PASSED`); process.exit(0); },
  (e) => { console.error("\nE2E FAILED:", e.message); if (consoleErrors.length) console.error(consoleErrors.join("\n")); process.exit(1); },
);
