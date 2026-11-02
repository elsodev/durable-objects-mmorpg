// Two-player playtest of every feature, with numbered screenshots (50-82) for a visual review.
// Prereqs: `npm run db:migrate:local` and `npm run dev:local` running (DEV_TOOLS on, captcha off).
// Usage: npm run e2e:playtest   (env: BASE_URL, SHOTS_DIR, PHASES=village,chat,friends,npc,interiors,wild,home,visit,guest)
// Local only: it clears the local D1 rateLimit table first (sign-ups are capped at 5 per IP per hour).
import { existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(`${process.cwd()}/package.json`);
/** Same as e2e.mjs: an installed `playwright`, else playwright-core with CHROMIUM_PATH (or a system Chromium). */
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
const SHOTS = (process.env.SHOTS_DIR ?? "test-results/playtest").replace(/\/?$/, "/");
const PH = (process.env.PHASES ?? "all").split(",");
const on = (p) => PH.includes("all") || PH.includes(p);
const LOG = [];
const errors = [];
const log = (...a) => { const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "); LOG.push(s); console.log(s); };
const check = (name, ok, detail = "") => log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

const PREFIX = process.env.SHOT_PREFIX ?? "";
async function shot(page, name) { await page.screenshot({ path: `${SHOTS}${PREFIX}${name}.png` }); log("shot", PREFIX + name); }
const wait = (page, ms) => page.waitForTimeout(ms);

const state = (page) => page.evaluate(() => {
  const d = window.__dmmo; if (!d) return null;
  const ents = d.entities(); const me = d.you();
  return { zone: d.zone, you: me?.id, me: me ? { x: me.x, y: me.y, facing: me.facing, act: me.act } : null,
    ents: ents.map((e) => ({ id: e.id, kind: e.kind, name: e.name, x: e.x, y: e.y, facing: e.facing, act: e.act, npcId: e.npcId })) };
});
const send = (page, msg) => page.evaluate((m) => window.__dmmo.send(m), msg);
async function waitFor(page, pred, what, timeout = 15000, quiet = false) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { last = await state(page).catch(() => null); if (last && pred(last)) return last; await wait(page, 150); }
  if (!quiet) check(what, false, `timeout last=${JSON.stringify(last)?.slice(0, 300)}`); return null;
}
/** Walks to (x, y). `quiet` tries without failing the run (for probing several spots). */
async function walk(page, x, y, what = `walk ${x},${y}`, timeout = 25000, quiet = false) {
  await page.evaluate(([x, y]) => window.__dmmo.moveTo(x, y), [x, y]);
  return waitFor(page, (s) => s.me && Math.hypot(s.me.x - x, s.me.y - y) < 0.6, what, timeout, quiet);
}
async function chat(page, text) {
  await page.click("#chat-input");
  await page.fill("#chat-input", text);
  await page.press("#chat-input", "Enter");
  await wait(page, 300);
  await page.evaluate(() => document.activeElement?.blur?.());
  // Off the chat box, as a player would: hovering it keeps it expanded.
  await page.mouse.move(900, 300);
}
const msgs = (page, t) => page.evaluate((t) => window.__msgs.filter((m) => !t || m.t === t), t);
const slotOf = (page, id) => page.evaluate((id) => window.__dmmo.inventory().slots.findIndex((s) => s?.item === id), id);
const qtyOf = (page, id) => page.evaluate((id) => window.__dmmo.inventory().slots.filter((s) => s?.item === id).reduce((a, s) => a + s.qty, 0), id);

async function newCtx(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    window.__msgs = [];
    const Orig = window.WebSocket;
    window.WebSocket = class extends Orig {
      constructor(...a) {
        super(...a);
        this.addEventListener("message", (ev) => {
          try { const m = JSON.parse(ev.data); if (m.t !== "tick" && m.t !== "pong") { window.__msgs.push(m); if (window.__msgs.length > 500) window.__msgs.shift(); } } catch {}
        });
      }
    };
  });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] console ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror ${e.message} ${e.stack?.split("\n").slice(0, 3).join(" ")}`));
  return { ctx, page };
}

async function signup(page, name, email, { shots = false } = {}) {
  await page.goto(BASE);
  await page.click("#auth-tab-signup");
  if (shots) {
    // Invalid names first: the form must refuse them before anything is sent.
    const bad = ["ab", "has space", "bad-dash!", "émile"];
    await page.fill("#auth-name", "way_too_long_name_x");
    check("name capped at 16", (await page.inputValue("#auth-name")).length === 16);
    for (const b of bad) {
      await page.fill("#auth-name", b);
      await page.fill("#auth-email", email);
      await page.fill("#auth-password", "correct-horse-42");
      await page.click("#auth-submit");
      await wait(page, 300);
      const err = await page.textContent("#auth-error", { timeout: 3000 }).catch(() => null);
      check(`name rule rejects "${b}"`, !!err && err.trim().length > 0, err);
    }
    await shot(page, "50-signup-name-rule-error");
  }
  await page.fill("#auth-name", name);
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", "correct-horse-42");
  await page.click("#auth-submit");
  await page.waitForSelector("#creator", { timeout: 20000 });
}

async function signin(page, email) {
  await page.goto(BASE);
  await page.click("#auth-tab-signin");
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", "correct-horse-42");
  await page.click("#auth-submit");
  await page.waitForFunction(() => !!window.__dmmo?.you(), null, { timeout: 25000 });
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  // Local only: Better Auth allows 5 sign-ups per IP per hour, and every test browser is 127.0.0.1.
  execSync('npx wrangler d1 execute durable-mmo-auth --local --env local --command "DELETE FROM rateLimit"', { stdio: "ignore", timeout: 60000, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  const { chromium, opts } = await loadChromium();
  const browser = await chromium.launch(opts);
  const stamp = Date.now().toString(36).slice(-5);
  const A = { name: `Alma_${stamp}`, email: `alma-${stamp}@e2e.test` };
  const B = { name: `Bo${stamp}`, email: `bo-${stamp}@e2e.test` };
  const a = await newCtx(browser, "A");
  const b = await newCtx(browser, "B");
  const pa = a.page, pb = b.page;

  // ---------- sign-up + creator ----------
  await signup(pa, A.name, A.email, { shots: true });
  const pills = await pa.$$eval(".creator-tab", (bs) => bs.map((b) => b.textContent));
  check("creator pill tabs", pills.length >= 6, pills.join("|"));
  await pa.click("#creator-tab-hairStyle"); await wait(pa, 300);
  await shot(pa, "51-creator-pills-hair");
  await pa.click("#creator-tab-body"); await wait(pa, 300);
  const bodies = await pa.$$eval(".creator-swatches [data-option]", (bs) => bs.map((b) => b.dataset.option));
  check("three body types", bodies.length === 3, bodies.join(","));
  await pa.click('.creator-swatches [data-option="female"]'); await wait(pa, 400);
  await shot(pa, "52-creator-body-female");
  await pa.click("#creator-save");
  await pa.waitForFunction(() => !!window.__dmmo?.you(), null, { timeout: 20000 });
  await signup(pb, B.name, B.email);
  await pb.click('#creator-tab-body'); await pb.click('.creator-swatches [data-option="male_slim"]');
  await pb.click("#creator-save");
  await pb.waitForFunction(() => !!window.__dmmo?.you(), null, { timeout: 20000 });
  log("zones", (await state(pa)).zone, (await state(pb)).zone);


  // ---------- village: signposts + stats ----------
  if (on("village")) {
    await wait(pa, 1500);
    const statsShown = await pa.isVisible("#hud-stats");
    check("stats panel visible in village", statsShown, await pa.textContent("#hud-stats"));
    await walk(pa, 4.5, 23.5, "walk to home signpost");
    await wait(pa, 800);
    await shot(pa, "53-village-signpost-stats");
  }

  // ---------- chat bubble, PM, emote ----------
  if (on("chat")) {
    await walk(pb, 6.5, 23.5, "B near A");
    await chat(pa, "one two three four five six seven eight nine ten");
    await wait(pa, 500);
    await shot(pa, "54-chat-bubble-truncated");
    await chat(pa, `/w ${B.name} psst hello Bo`);
    await wait(pb, 1200);
    const bLog = await pb.textContent("#chat-log");
    check("B receives PM", bLog.includes("psst hello Bo"), bLog.slice(-200));
    await shot(pb, "55-pm-received-b");
    await chat(pb, "/r hi Alma back");
    await wait(pa, 1000);
    check("A gets reply", (await pa.textContent("#chat-log")).includes("hi Alma back"));
    await chat(pa, "/emote wave");
    await wait(pa, 400);
    await shot(pa, "56-emote-wave");
    await pa.click("#chat-emote"); await wait(pa, 300);
    check("emoji picker opens", await pa.isVisible("#chat-emotes"));
    await shot(pa, "57-emote-picker");
    const first = await pa.$("#chat-emotes button");
    if (first) { await first.click(); await wait(pa, 400); await shot(pa, "58-emote-from-picker"); }
  }

  // ---------- friends ----------
  if (on("friends")) {
    await chat(pa, `/friend ${B.name}`);
    await wait(pb, 2000);
    await pb.click("#hud-btn-friends"); await wait(pb, 400);
    if (await pb.$("#friends-tab-requests")) await pb.click("#friends-tab-requests");
    await wait(pb, 400);
    await shot(pb, "59-friend-request-b");
    const acc = await pb.$("#friends-panel button:has-text('Accept')");
    check("accept button present", !!acc);
    if (acc) await acc.click();
    await wait(pb, 1500);
    await pa.click("#hud-btn-friends"); await wait(pa, 1200);
    if (await pa.$("#friends-tab-friends")) await pa.click("#friends-tab-friends");
    await wait(pa, 800);
    const fl = await pa.textContent("#friends-panel");
    check("A sees B as friend online", fl.includes(B.name), fl.slice(0, 300));
    await shot(pa, "60-friends-presence");
    await pa.click("#hud-btn-friends"); await pb.click("#hud-btn-friends");
  }

  // ---------- NPC talk + memory ----------
  if (on("npc")) {
    await send(pa, { t: "chat", text: "/hour 12" });
    await wait(pa, 1500);
    const s = await state(pa);
    const pip = s.ents.find((e) => e.kind === "npc" && /pip/i.test(e.id + e.name)) ?? s.ents.find((e) => e.kind === "npc");
    log("npc", pip);
    const talkTo = async (page, who, say) => {
      for (let i = 0; i < 4; i++) {
        const n = (await state(page)).ents.find((e) => e.id === pip.id);
        await walk(page, n.x + (who === "A" ? 1.1 : -1.1), n.y + 0.2, `${who} next to npc`, 15000);
        const before = (await page.textContent("#chat-log")).length;
        if (say) await chat(page, say);
        await send(page, { t: "interact", target: pip.id });
        try {
          await page.waitForFunction(([n, nm]) => (document.querySelector("#chat-log")?.textContent ?? "").slice(n).includes(nm + ":"), [before, pip.name], { timeout: 6000 });
          return (await page.textContent("#chat-log")).slice(before);
        } catch { log(who, "talk retry", i); }
      }
      return "";
    };
    const aLines = await talkTo(pa, "A", "My favourite colour is purple, remember it");
    await wait(pa, 400);
    const s2 = await state(pa);
    const npcNow = s2.ents.find((e) => e.id === pip.id);
    const want = Math.abs(s2.me.x - npcNow.x) >= Math.abs(s2.me.y - npcNow.y) ? (s2.me.x > npcNow.x ? "right" : "left") : (s2.me.y > npcNow.y ? "down" : "up");
    check("NPC faces A", npcNow.facing === want, `${npcNow.facing} want ${want}`);
    await shot(pa, "61-npc-faces-player");
    log("A npc lines:", aLines.slice(0, 400));
    check("NPC answered A", aLines.includes(pip.name + ":"));
    const bLines = await talkTo(pb, "B", null);
    log("B npc lines:", bLines.slice(0, 400));
    check("NPC answered B", bLines.includes(pip.name + ":"));
    check("NPC to B doesn't mention A or purple", !bLines.includes(A.name) && !/purple/i.test(bLines));
    await shot(pb, "62-npc-talk-b");
  }

  // ---------- interiors ----------
  if (on("interiors")) {
    await send(pa, { t: "chat", text: "/hour 19" });
    await wait(pa, 1000);
    await walk(pa, 19.5, 20.5, "A to inn door", 30000);
    await page_moveInto(pa, 19.5, 19.2, "int_inn");
    let s = await state(pa);
    for (let i = 0; i < 40 && !s.ents.some((e) => e.kind === "npc" && e.act?.k === "sit"); i++) { await wait(pa, 500); s = await state(pa); }
    await wait(pa, 1500); s = await state(pa);
    const seated = s.ents.filter((e) => e.kind === "npc" && e.act?.k === "sit");
    log("inn npcs", s.ents.filter((e) => e.kind === "npc").map((e) => `${e.name}@${e.x},${e.y} ${e.act?.k ?? ""} ${e.facing}`));
    check("inn has seated NPCs", seated.length > 0, String(seated.length));
    await shot(pa, "63-inn-interior");
    // talk to a seated NPC: they should get up and face the player
    const sitter = seated.find((e) => !/odette/i.test(e.name)) ?? seated[0];
    if (sitter) {
      const st = await state(pa);
      const spots = [[0, 1.2], [1.2, 0], [-1.2, 0], [0, -1.2], [1.2, 1.2], [-1.2, 1.2]];
      for (const [dx, dy] of spots) {
        const r = await walk(pa, sitter.x + dx, sitter.y + dy, "near sitter " + sitter.name, 8000, true);
        if (r) break;
      }
      await send(pa, { t: "interact", target: sitter.id });
      await wait(pa, 1800);
      const s2 = await state(pa);
      const n2 = s2.ents.find((e) => e.id === sitter.id);
      log("sitter after talk", JSON.stringify(n2), "me", JSON.stringify(s2.me));
      const want = Math.abs(s2.me.x - n2.x) >= Math.abs(s2.me.y - n2.y) ? (s2.me.x > n2.x ? "right" : "left") : (s2.me.y > n2.y ? "down" : "up");
      check("seated NPC stood up and faces player", n2 && n2.act?.k !== "sit" && n2.facing === want, n2?.facing + " want " + want);
      if (await pa.isVisible("#shop-dialog")) await pa.keyboard.press("Escape");
      await wait(pa, 300);
      await shot(pa, "64-inn-npc-stands-faces-player");
      check("NPC not on top of player", Math.hypot(s2.me.x - n2.x, s2.me.y - n2.y) >= 0.85, Math.hypot(s2.me.x - n2.x, s2.me.y - n2.y).toFixed(2));
    }
    // sit on a free chair
    const taken = new Set((await state(pa)).ents.filter((e) => e.act?.k === "sit").map((e) => Math.floor(e.x) + "," + Math.floor(e.y)));
    const seats = [["chair_left_2", 17, 7], ["chair_right_2", 15, 7], ["chair_left_1", 12, 7], ["chair_right_1", 10, 7], ["chair_down_4", 15, 9], ["chair_down_3", 13, 9]].filter(([, x, y]) => !taken.has(x + "," + y));
    for (const [id, x, y] of seats) {
      for (const [dx, dy] of [[0.5, 1.5], [0.5, -0.5], [1.5, 0.5], [-0.5, 0.5]]) { if (await walk(pa, x + dx, y + dy, `walk to ${id}`, 8000, true)) break; }
      await send(pa, { t: "interact", target: id });
      await wait(pa, 900);
      const me = (await state(pa)).me;
      if (me?.act?.k === "sit") { check("A sits on " + id, true); break; }
      log("no sit at", id, JSON.stringify((await msgs(pa, "notice")).slice(-1)));
    }
    await wait(pa, 600);
    log("inn at sit", (await state(pa)).ents.map((e) => `${e.name}@${e.x.toFixed(1)},${e.y.toFixed(1)} ${e.act?.k ?? ""} ${e.facing}`));
    await shot(pa, "65-inn-player-sitting");
    {
      // Nobody walking may stand inside anyone else's space (seated people are at their chairs).
      const es = (await state(pa)).ents.filter((e) => e.act?.k !== "sit" && e.kind !== "monster");
      let min = Infinity;
      for (const e of es) for (const o of es) if (e !== o) min = Math.min(min, Math.hypot(e.x - o.x, e.y - o.y));
      log("closest standing pair in the inn", min.toFixed(2));
    }
    // leave to village then a cottage (Tess, 16,8)
    await walk(pa, 9.5, 11.5, "to inn exit");
    await page_moveInto(pa, 9.5, 12.4, "village");
    await walk(pa, 16.5, 10.5, "to tess door", 30000);
    await page_moveInto(pa, 16.5, 8.2, "int_house_tess");
    await wait(pa, 1500);
    await shot(pa, "66-cottage-tess");
    for (const [id, x, y] of [["chair_left_1", 4, 8], ["chair_right_1", 2, 8], ["chair_up_1", 6, 7]]) {
      await walk(pa, x + 0.5, y + 1.5, `walk to ${id}`, 15000);
      await send(pa, { t: "interact", target: id });
      await wait(pa, 900);
      if ((await state(pa)).me?.act?.k === "sit") { check("A sits in cottage on " + id, true); break; }
    }
    await shot(pa, "67-cottage-player-sitting");
    await walk(pa, 2.5, 10.5, "to cottage exit");
    await page_moveInto(pa, 2.5, 11.4, "village");
  }

  // ---------- riverside + caves ----------
  if (on("wild")) {
    await walk(pb, 31.5, 45.5, "B to river exit", 40000);
    await page_moveInto(pb, 31.5, 47.4, "riverside");
    await wait(pb, 1500);
    let mons = (await state(pb)).ents.filter((e) => e.kind === "monster");
    if (mons[0]) { await walk(pb, mons[0].x + (mons[0].x > 39 ? -4 : 4), mons[0].y, "B toward a monster", 30000, true); await wait(pb, 800); mons = (await state(pb)).ents.filter((e) => e.kind === "monster"); }
    check("riverside has monsters", mons.length > 0, String(mons.length));
    await shot(pb, "68-riverside-monsters");
    await walk(pb, 39.5, 1.5, "B back to exit", 40000);
    await page_moveInto(pb, 39.5, 0.4, "village");
    await walk(pb, 61.5, 23.5, "B to quarry exit", 40000);
    await page_moveInto(pb, 63.4, 23.5, "quarry");
    await walk(pb, 26.5, 7.5, "B to the cave mouth", 40000);
    await page_moveInto(pb, 26.5, 5.5, "caves");
    await wait(pb, 1500);
    const cm = (await state(pb)).ents.filter((e) => e.kind === "monster");
    if (cm[0]) { await walk(pb, cm[0].x - 4, cm[0].y, "B toward cave monster", 30000, true); await wait(pb, 800); }
    check("caves monsters", (await state(pb)).ents.filter((e) => e.kind === "monster").length > 0);
    await shot(pb, "69-caves-monsters");
    const vil = (await state(pa)).ents.filter((e) => e.kind === "monster");
    check("no monsters in village", vil.length === 0, String(vil.length));
    await walk(pb, 3.5, 27.5, "B back to cave exit", 40000);
    await page_moveInto(pb, 0.4, 27.5, "village");
  }

  // ---------- home farm, night, sleep ----------
  if (on("home")) {
    await walk(pa, 2.5, 23.5, "A to home exit", 40000);
    await page_moveInto(pa, 0.4, 23.5, "home");
    await wait(pa, 1500);
    await shot(pa, "70a-home-spawn-by-sign");
    // Several plots: crows may eat one a night.
    const tiles = [{ x: 23, y: 6 }, { x: 24, y: 6 }, { x: 25, y: 6 }, { x: 23, y: 8 }, { x: 24, y: 8 }, { x: 25, y: 8 }];
    await walk(pa, 24.5, 7.5, "A to farm");
    await wait(pa, 500);
    for (const t of tiles) {
      for (const item of ["hoe", "seed_turnip", "watering_can"]) {
        const slot = await slotOf(pa, item);
        await send(pa, { t: "use", slot, x: t.x, y: t.y });
        if (item === "hoe" && t.x === 25 && t.y === 6) { await wait(pa, 140); await shot(pa, "70-hoe-mid-swing"); }
        await wait(pa, 600);
      }
    }
    const rej = (await msgs(pa, "reject")).filter((m) => m.action !== "move" && m.action !== "moveTo");
    check("farm actions accepted", rej.length === 0, JSON.stringify(rej));
    await shot(pa, "71-farm-till-plant-water");
    await chat(pa, "/time 21");
    await wait(pa, 2500);
    await shot(pa, "72-home-night-21h");
    // sleep via bed click: the bed is inside the house (door at 8,10; bed at 2,3..4 inside)
    await walk(pa, 8.5, 11.5, "A to the house door");
    await page_moveInto(pa, 8.5, 10.5, "home");
    await wait(pa, 1200);
    await walk(pa, 3.5, 5.5, "A to bed");
    await wait(pa, 500);
    const p = await pa.evaluate(() => window.__dmmo.tileToScreen?.(2.5, 4.5));
    log("bed screen", p);
    if (p) await pa.mouse.click(p.x, p.y);
    await wait(pa, 600);
    check("sleep dialog", await pa.isVisible("#sleep-dialog"));
    await shot(pa, "73-sleep-confirm");
    await pa.click("#sleep-yes").catch(() => {});
    await wait(pa, 6000);
    await shot(pa, "74-day-summary");
    await pa.click("#summary-ok").catch(() => log("no summary-ok"));
    await wait(pa, 800);
    // grow to ripe: water, /day, (water again)
    for (let i = 0; i < 2; i++) {
      // Mornings start inside by the bed: out through the house door (9,11) first.
      await walk(pa, 9.5, 10.5, "A to the inside door");
      await pa.evaluate(() => window.__dmmo.moveTo(9.5, 11.5));
      await wait(pa, 1500);
      await walk(pa, 24.5, 7.5, "back to farm");
      for (const t of tiles) { await send(pa, { t: "use", slot: await slotOf(pa, "watering_can"), x: t.x, y: t.y }); await wait(pa, 600); }
      await chat(pa, "/day"); await wait(pa, 4000);
      await pa.click("#summary-ok").catch(() => {});
      await wait(pa, 600);
    }
    await shot(pa, "75-farm-ripe");
  }

  // ---------- invite + visitor harvest ----------
  if (on("visit")) {
    const turnips = () => pa.evaluate(() => window.__dmmo.inventory().slots.filter((s) => s?.item?.startsWith("turnip")).reduce((a, s) => a + s.qty, 0));
    const before = await turnips();
    await chat(pa, `/invite ${B.name}`);
    await pb.waitForSelector("#visit-invite:not([hidden])", { timeout: 10000 }).catch(() => log("no invite card"));
    await shot(pb, "76-invite-card-b");
    await pb.click("#visit-accept").catch(() => {});
    await pb.waitForFunction(() => window.__dmmo?.zone === "home", null, { timeout: 15000 }).catch(() => log("B didn't go home"));
    await wait(pb, 2000);
    await shot(pa, "77-owner-sees-visitor");
    const farm = {};
    for (const m of await msgs(pa)) { if (m.t === "welcome" && m.farm) for (const t of m.farm) farm[t.x + "," + t.y] = t; if (m.t === "farm") for (const t of m.tiles) farm[t.x + "," + t.y] = t; if (m.t === "farmAll") { for (const k of Object.keys(farm)) delete farm[k]; for (const t of m.tiles) farm[t.x + "," + t.y] = t; } }
    log("owner farm", JSON.stringify(Object.values(farm)));
    for (const crop of Object.values(farm).filter((t) => t.crop)) {
      await walk(pb, crop.x + 0.5, crop.y + 1.5, "B to crop " + crop.x);
      await wait(pb, 500);
      const pt = await pb.evaluate(([x, y]) => window.__dmmo.tileToScreen?.(x, y), [crop.x + 0.5, crop.y + 0.5]);
      await pb.mouse.click(pt.x, pt.y);
      await wait(pb, 300);
      if (crop === Object.values(farm).filter((t) => t.crop)[0]) { log("B pos", JSON.stringify((await state(pb)).me), "crop", crop.x, crop.y); await shot(pb, "78-visitor-harvest-swing"); }
      await wait(pb, 1200);
    }
    await shot(pb, "79-visitor-after-harvest");
    const after = await turnips();
    log("owner turnips", before, "->", after, "B notices", JSON.stringify((await msgs(pb, "notice")).slice(-3)), "A notices", JSON.stringify((await msgs(pa, "notice")).slice(-3)));
    check("owner credited", after > before);
    // visitor tries hoe
    await send(pb, { t: "use", slot: 0, x: 26, y: 6 }); await wait(pb, 600);
    log("B rejects", JSON.stringify((await msgs(pb, "reject")).slice(-2)));
    await shot(pa, "80-owner-credited");
    await pb.click("#visit-leave").catch(() => {});
    await wait(pb, 2000);
  }

  // ---------- guest ----------
  if (on("visit")) {
    // Back to the village: the "← Home" sign's label must clear the name tag at the spawn.
    await walk(pa, 38.5, 12.5, "A to home exit", 40000);
    await page_moveInto(pa, 39.6, 12.5, "village");
    await wait(pa, 1500);
    await shot(pa, "80a-village-spawn-from-home");
  }

  if (on("watchdog")) {
    // A third game in this headless browser never gets a renderer: the page must say so.
    const w = await newCtx(browser, "W");
    const pw = w.page;
    await pw.goto(BASE);
    await pw.click("#auth-tab-guest");
    await pw.fill("#auth-guest-name", `Wd${stamp}`);
    await pw.click("#auth-guest-submit");
    const t0 = Date.now();
    const got = await Promise.race([
      pw.waitForSelector("#dmmo-start-status", { timeout: 25000 }).then(() => "status"),
      pw.waitForSelector("#creator", { timeout: 25000 }).then(() => "started"),
    ]).catch(() => "nothing");
    log("third context", got, "after ms", Date.now() - t0, got === "status" ? await pw.textContent("#dmmo-start-status") : "");
    check("third context shows something (status or game)", got !== "nothing");
    await shot(pw, "83-start-watchdog");
    errors.splice(0, errors.length, ...errors.filter((e) => !e.startsWith("[W]")));
    await w.ctx.close();
  }

  if (on("guest")) {
    // Own browser: headless Chromium caps live WebGL contexts per browser, and A and B hold theirs.
    const gBrowser = await chromium.launch(opts);
    const g = await newCtx(gBrowser, "G");
    const pg = g.page;
    pg.on("console", (m) => log("G console", m.type(), m.text().slice(0, 200)));
    pg.on("response", (r) => { if (r.url().includes("/api") ) log("G resp", r.status(), r.url()); });
    pg.on("websocket", (ws) => { log("G ws", ws.url()); ws.on("close", () => log("G ws close", ws.url())); });
    await pg.goto(BASE);
    await pg.click("#auth-tab-guest");
    await pg.fill("#auth-guest-name", `Gst${stamp}`);
    const t0 = Date.now();
    await pg.click("#auth-guest-submit");
    await pg.waitForSelector("#creator", { timeout: 90000 }).then(() => log("guest creator after ms", Date.now() - t0)).catch(async () => { await shot(pg, "debug-guest"); log("guest err", await pg.textContent("#auth-error").catch(() => "")); log("G msgs", JSON.stringify(await pg.evaluate(() => window.__msgs)).slice(0, 1500)); log("G dom", (await pg.evaluate(() => document.body.innerHTML)).slice(0, 600)); });
    await pg.click("#creator-save", { timeout: 5000 }).catch(() => log("no creator for guest"));
    await pg.waitForFunction(() => !!window.__dmmo?.you(), null, { timeout: 20000 });
    await wait(pg, 1500);
    check("guest at home", (await state(pg)).zone === "home", (await state(pg)).zone);
    await shot(pg, "81-guest-home");
    await walk(pg, 38.5, 12.5, "guest to exit");
    await pg.evaluate(() => window.__dmmo.moveTo(39.6, 12.5));
    await pg.waitForSelector("#account-prompt", { timeout: 8000 }).catch(() => log("no account prompt"));
    await wait(pg, 400);
    await shot(pg, "82-guest-account-prompt");
    check("guest still home", (await state(pg)).zone === "home");
    await gBrowser.close();
  }

  log("ERRORS", errors.length); for (const e of errors) log(e);
  await browser.close();
  const failed = LOG.filter((l) => l.startsWith("FAIL"));
  log(failed.length ? `${failed.length} CHECKS FAILED` : "ALL CHECKS PASSED");
  process.exitCode = failed.length || errors.length ? 1 : 0;
}

async function page_moveInto(page, x, y, zone) {
  await page.evaluate(([x, y]) => window.__dmmo.moveTo(x, y), [x, y]);
  return waitFor(page, (s) => s.zone === zone && !!s.me, `enter ${zone}`, 20000);
}

main().catch((e) => { console.error("CRASH", e); console.log("ERRORS", errors.join("\n")); process.exit(1); });
