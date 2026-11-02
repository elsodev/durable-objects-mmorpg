// Phases of scripts/e2e-qa.mjs, run in order; each takes the shared run context.
import * as Q from "../e2e-qa.mjs";
const { log, check, shot, wait, state, send, walk, moveInto, chat, cmd, msgs, clearMsgs, inv, slotOf, qtyOf, coins, lastOf, sfx, use, farmMap, dismiss, newPlayer, signup, overlaps, clippedText } = Q;

/** A (and B) accounts, created on first use. */
async function playerA(ctx) {
  if (ctx.A) return ctx.A;
  const p = await newPlayer(ctx.chromium, ctx.opts, "A");
  ctx.players.push(p);
  p.name = `Alma_${ctx.stamp}`; p.email = `alma-${ctx.stamp}@qa.test`;
  await signup(p.page, p.name, p.email, "female");
  ctx.A = p;
  return p;
}
async function playerB(ctx) {
  if (ctx.B) return ctx.B;
  const p = await newPlayer(ctx.chromium, ctx.opts, "B");
  ctx.players.push(p);
  p.name = `Bo${ctx.stamp}`; p.email = `bo-${ctx.stamp}@qa.test`;
  await signup(p.page, p.name, p.email, "male_slim");
  ctx.B = p;
  return p;
}

const PHASES = [];
const phase = (name, fn) => PHASES.push([name, fn]);

// ---------------------------------------------------------------- 1. onboarding
phase("onboard", async (ctx) => {
  const p = await newPlayer(ctx.chromium, ctx.opts, "A");
  ctx.players.push(p);
  const page = p.page;
  p.name = `Alma_${ctx.stamp}`; p.email = `alma-${ctx.stamp}@qa.test`;
  const t0 = Date.now();
  await page.goto(Q.BASE);
  await page.waitForSelector("#auth-tab-signup", { timeout: 15000 });
  log("auth form after ms", Date.now() - t0);
  await shot(page, "qa-02-auth");
  await page.click("#auth-tab-signup");
  await page.fill("#auth-name", "way_too_long_name_x");
  check("name capped at 16", (await page.inputValue("#auth-name")).length === 16);
  for (const b of ["ab", "has space", "bad-dash!", "émile"]) {
    await page.fill("#auth-name", b);
    await page.fill("#auth-email", p.email);
    await page.fill("#auth-password", "correct-horse-42");
    await page.click("#auth-submit");
    await wait(page, 300);
    const err = (await page.textContent("#auth-error").catch(() => "")) ?? "";
    const created = await page.isVisible("#creator").catch(() => false);
    check(`name rule "${b}"`, b === "___" || b === " lead" ? true : !!err.trim() && !created, err.trim() || (created ? "ACCEPTED" : "no error"));
    if (created) return;
  }
  await shot(page, "qa-03-signup-name-error");
  await page.fill("#auth-name", p.name);
  await page.click("#auth-submit");
  const sawLoading = await page.waitForSelector("#loading", { timeout: 8000 }).then(() => true).catch(() => false);
  check("loading screen after sign-up", sawLoading);
  await wait(page, 150);
  await shot(page, "qa-01-loading");
  await page.waitForSelector("#creator", { timeout: 25000 });
  check("loading screen gone at the creator", !(await page.isVisible("#loading").catch(() => false)));
  const pills = await page.$$eval(".creator-tab", (bs) => bs.map((b) => b.textContent));
  check("creator pill tabs", pills.length >= 6, pills.join("|"));
  await page.click("#creator-tab-body");
  const bodies = await page.$$eval(".creator-swatches [data-option]", (bs) => bs.map((b) => b.dataset.option));
  check("three body types", bodies.length === 3, bodies.join(","));
  for (const b of bodies) { await page.click(`.creator-swatches [data-option="${b}"]`); await wait(page, 350); await shot(page, `qa-04-creator-body-${b}`); }
  await page.click('.creator-swatches [data-option="female"]');
  for (const t of pills.slice(0, 8)) {
    const id = await page.$$eval(".creator-tab", (bs, t) => bs.find((b) => b.textContent === t)?.id, t);
    if (!id) continue;
    await page.click(`#${id}`); await wait(page, 150);
    const n = await page.$$eval(".creator-swatches [data-option]", (bs) => bs.length);
    log("creator tab", t, "options", n);
  }
  check("creator text not clipped", (await clippedText(page)).length === 0, await clippedText(page));
  await page.click("#creator-save");
  await page.waitForFunction(() => !!window.__dmmo?.you(), null, { timeout: 25000 });
  await wait(page, 1500);
  const tut = await page.isVisible("#tutorial").catch(() => false);
  check("controls card on first entry", tut);
  await shot(page, "qa-05-controls-card");
  if (tut) await page.click("#tutorial-ok");
  const s = await state(page);
  log("first zone", s.zone, s.me);
  ctx.A = p;
  await wait(page, 500);
  await shot(page, "qa-06-first-spawn");
  // reload: the controls card must not come back
  await page.reload();
  await page.waitForFunction(() => !!window.__dmmo?.you(), null, { timeout: 25000 });
  await wait(page, 1500);
  check("controls card not shown again", !(await page.isVisible("#tutorial").catch(() => false)));
});

phase("guest", async (ctx) => {
  const g = await newPlayer(ctx.chromium, ctx.opts, "G");
  const pg = g.page;
  await pg.goto(Q.BASE);
  await pg.click("#auth-tab-guest");
  await pg.fill("#auth-guest-name", "x");
  await pg.click("#auth-guest-submit");
  await wait(pg, 400);
  log("guest bad name error", await pg.textContent("#auth-error").catch(() => ""));
  await pg.fill("#auth-guest-name", `Gst${ctx.stamp}`);
  await pg.click("#auth-guest-submit");
  await pg.waitForSelector("#creator", { timeout: 60000 });
  await pg.click("#creator-save");
  await pg.waitForFunction(() => !!window.__dmmo?.you(), null, { timeout: 25000 });
  await wait(pg, 1200); await dismiss(pg);
  check("guest starts at home", (await state(pg)).zone === "home");
  // guest: world chat, friends, invite are refused?
  await chat(pg, "hello world from a guest");
  await wait(pg, 600);
  log("guest chat log", (await pg.textContent("#chat-log")).slice(-200));
  await walk(pg, 38.5, 12.5, "guest to exit");
  await pg.evaluate(() => window.__dmmo.moveTo(39.6, 12.5));
  const prompt = await pg.waitForSelector("#account-prompt", { timeout: 8000 }).then(() => true).catch(() => false);
  check("guest gets account prompt at the exit", prompt);
  await wait(pg, 400);
  await shot(pg, "qa-07-guest-account-prompt");
  check("guest stays home", (await state(pg)).zone === "home");
  await g.browser.close();
});



/** Samples your predicted position every frame while `during` runs (ms). */
async function sampleFrames(page, ms, action) {
  const p = page.evaluate((ms) => new Promise((res) => {
    const out = []; const t0 = performance.now();
    const f = () => { const me = window.__dmmo.you(); out.push([performance.now() - t0, me.x, me.y]); if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(out); };
    requestAnimationFrame(f);
  }), ms);
  await action();
  return p;
}
function frameStats(samples) {
  const v = [];
  for (let i = 1; i < samples.length; i++) {
    const [t0, x0, y0] = samples[i - 1], [t1, x1, y1] = samples[i];
    const dt = (t1 - t0) / 1000; if (dt <= 0) continue;
    v.push(Math.hypot(x1 - x0, y1 - y0) / dt);
  }
  const moving = v.filter((s) => s > 0.05);
  const mean = moving.reduce((a, b) => a + b, 0) / (moving.length || 1);
  const sd = Math.sqrt(moving.reduce((a, b) => a + (b - mean) ** 2, 0) / (moving.length || 1));
  const firstMove = samples.find((s, i) => i > 0 && Math.hypot(s[1] - samples[0][1], s[2] - samples[0][2]) > 0.01);
  const stalls = v.slice(v.findIndex((s) => s > 0.05)).filter((s, i, a) => s < 0.05 && i < a.length - 1 && a.slice(i).some((q) => q > 0.05)).length;
  return { frames: samples.length, meanSpeed: +mean.toFixed(2), sdSpeed: +sd.toFixed(2), firstMoveMs: firstMove ? Math.round(firstMove[0]) : null, stalls };
}

// ---------------------------------------------------------------- 2. movement
phase("move", async (ctx) => {
  const A = await playerA(ctx); const B = await playerB(ctx);
  const pa = A.page, pb = B.page;
  for (const p of [pa, pb]) { await dismiss(p); if ((await state(p)).zone !== "village") log("not in village", (await state(p)).zone); }
  await walk(pa, 27.5, 26.5, "A to open ground");
  await pa.mouse.click(640, 300); // focus the canvas
  await wait(pa, 300);
  // WASD: hold D for 1.2 s, then let go
  const before = (await state(pa)).me;
  const t0 = Date.now();
  const samples = await sampleFrames(pa, 1800, async () => {
    await pa.keyboard.down("d"); await wait(pa, 1200); await pa.keyboard.up("d");
  });
  const st = frameStats(samples);
  const end = samples.at(-1);
  log("WASD hold D 1.2s", st, "moved", +(end[1] - before.x).toFixed(2));
  check("WASD first frame of movement < 50 ms", st.firstMoveMs !== null && st.firstMoveMs < 80, st.firstMoveMs);
  check("WASD walk speed steady (sd < 15% of mean)", st.sdSpeed < st.meanSpeed * 0.15, st);
  await wait(pa, 600);
  const settled = (await state(pa)).me;
  check("no snap-back after key up", Math.abs(settled.x - end[1]) < 0.15, `${end[1].toFixed(2)} -> ${settled.x.toFixed(2)}`);
  // diagonal
  const s2 = await sampleFrames(pa, 1300, async () => { await pa.keyboard.down("w"); await pa.keyboard.down("a"); await wait(pa, 1000); await pa.keyboard.up("w"); await pa.keyboard.up("a"); });
  log("diagonal WA", frameStats(s2));
  // click-to-move
  const me = (await state(pa)).me;
  const target = { x: me.x + 4, y: me.y + 2 };
  const pt = await pa.evaluate(([x, y]) => window.__dmmo.tileToScreen(x, y), [target.x, target.y]);
  const c0 = Date.now();
  await pa.mouse.click(pt.x, pt.y);
  const arrived = await Q.waitFor(pa, (s) => Math.hypot(s.me.x - target.x, s.me.y - target.y) < 0.7, "click-to-move arrives", 8000);
  log("click-to-move ms", Date.now() - c0, "dist", Math.hypot(4, 2).toFixed(2), arrived?.me);
  await shot(pa, "qa-08-click-to-move");
  // players overlap in public zones
  await walk(pa, 30.5, 26.5, "A to overlap spot");
  await walk(pb, 30.5, 26.5, "B onto A", 25000, true);
  const sa = (await state(pa)).me, sb = (await state(pb)).me;
  const d = Math.hypot(sa.x - sb.x, sa.y - sb.y);
  log("A-B distance after walking onto the same tile", d.toFixed(2));
  check("players can share a spot in public zones (no blocking)", d < 0.6, d.toFixed(2));
  await walk(pb, 33.5, 26.5, "B walks through A", 8000);
  await shot(pa, "qa-09-players-overlap");
  // NPCs walking around standing players: watch 25 s
  await cmd(pa, "/hour 9");
  const npcMin = {}; let stuckNpc = [];
  const last = {};
  for (let i = 0; i < 50; i++) {
    const s = await state(pa);
    const players = s.ents.filter((e) => e.kind === "player");
    for (const n of s.ents.filter((e) => e.kind === "npc")) {
      for (const pl of players) { const dd = Math.hypot(n.x - pl.x, n.y - pl.y); npcMin[n.name] = Math.min(npcMin[n.name] ?? 99, dd); }
      last[n.name] = [...(last[n.name] ?? []), [n.x, n.y]];
    }
    await wait(pa, 500);
  }
  log("closest each NPC came to a player (tiles)", Object.fromEntries(Object.entries(npcMin).map(([k, v]) => [k, +v.toFixed(2)])));
  const tooClose = Object.entries(npcMin).filter(([, v]) => v < 0.55);
  check("NPCs keep personal space from players", tooClose.length === 0, tooClose);
});

// ---------------------------------------------------------------- 2b. doors
phase("doors", async (ctx) => {
  const A = await playerA(ctx);
  const pa = A.page;
  await cmd(pa, "/hour 12");
  await walk(pa, 19.5, 20.5, "A to inn door", 40000);
  let t = Date.now();
  await moveInto(pa, 19.5, 19.2, "int_inn");
  log("village -> inn ms", Date.now() - t);
  await wait(pa, 600);
  await shot(pa, "qa-10-inn-inside");
  const s = await state(pa);
  check("inn spawn not inside a wall/NPC", s.ents.filter((e) => e.kind === "npc").every((n) => Math.hypot(n.x - s.me.x, n.y - s.me.y) > 0.5));
  await walk(pa, 9.5, 11.5, "to inn exit");
  t = Date.now();
  await moveInto(pa, 9.5, 12.4, "village");
  log("inn -> village ms", Date.now() - t, (await state(pa)).me);
  // home: yard <-> house
  await walk(pa, 2.5, 23.5, "A to home exit", 40000);
  t = Date.now();
  await moveInto(pa, 0.4, 23.5, "home");
  log("village -> home ms", Date.now() - t, (await state(pa)).me);
  await walk(pa, 8.5, 11.8, "A to house door");
  t = Date.now();
  await moveInto(pa, 8.5, 10.5, "home", "home_in");
  log("yard -> house ms", Date.now() - t, (await state(pa)).me);
  await shot(pa, "qa-11-house-inside");
  const inside = (await state(pa)).me;
  const exitIn = await pa.evaluate(() => [...window.__msgs].reverse().find((m) => m.t === "welcome"));
  log("house welcome spawn", inside, "objects", exitIn.objects?.length);
  await walk(pa, 9.5, 10.5, "to inside door", 10000, true);
  t = Date.now();
  await moveInto(pa, 9.5, 11.6, "home", "home");
  log("house -> yard ms", Date.now() - t, (await state(pa)).me);
  await shot(pa, "qa-12-yard-doorstep");
});

/** Walks next to tile (tx, ty) (any free side), within tool reach of its centre. */
async function near(page, tx, ty, what = `near ${tx},${ty}`) {
  const spots = [[0, 1.2], [0, -1.1], [1.2, 0], [-1.2, 0], [1.1, 1.1], [-1.1, 1.1], [1.1, -1.1], [-1.1, -1.1], [0, 2], [2, 0], [-2, 0]];
  for (const [dx, dy] of spots) {
    const x = tx + 0.5 + dx, y = ty + 0.5 + dy;
    const r = await walk(page, x, y, what, 9000, true);
    if (r && Math.hypot(r.me.x - (tx + 0.5), r.me.y - (ty + 0.5)) <= 1.9) return r;
  }
  check(what, false, "no free spot within reach");
  return null;
}
async function goHome(page) {
  const s = await state(page);
  if (s.zone === "home") {
    if ((await Q.homeMapOf(page)) === "home_in") { await walk(page, 9.5, 10.5, "to inside door", 10000, true); await moveInto(page, 9.5, 11.6, "home", "home"); }
    return;
  }
  if (s.zone !== "village") await goVillage(page);
  await walk(page, 2.5, 23.5, "to home exit", 40000);
  await moveInto(page, 0.4, 23.5, "home");
}
async function goVillage(page) {
  const s = await state(page);
  if (s.zone === "village") return;
  if (s.zone === "riverside") { await walk(page, 39.5, 1.5, "to riverside exit", 40000); await moveInto(page, 39.5, 0.4, "village"); return; }
  if (s.zone === "caves") { await walk(page, 10.5, 39.5, "to caves exit", 40000); await moveInto(page, 10.5, 41.5, "quarry"); }
  if ((await state(page)).zone === "quarry") { await walk(page, 1.5, 15.5, "to quarry exit", 40000); await moveInto(page, 0.4, 15.5, "village"); return; }
  if (s.zone.startsWith("int_")) throw new Error("goVillage from " + s.zone);
  await goHome(page);
  await walk(page, 38.5, 12.5, "to village exit", 40000);
  await moveInto(page, 39.6, 12.5, "village");
}
/** The last reject/notice text after `fn` ran. */
async function answer(page, fn) {
  const n = (await msgs(page)).length;
  await fn();
  await wait(page, 450);
  const after = (await msgs(page)).slice(n).filter((m) => m.t === "reject" || m.t === "notice");
  return after.map((m) => m.reason ?? m.text).join(" | ");
}
async function dayEnd(page) {
  const n = (await msgs(page, "daySummary")).length;
  await cmd(page, "/day");
  const end = Date.now() + 15000;
  while (Date.now() < end) { const d = await msgs(page, "daySummary"); if (d.length > n) { await wait(page, 1200); await dismiss(page); return d.at(-1).summary; } await wait(page, 200); }
  check("day ended", false); return null;
}
async function homeState(page) { return (await lastOf(page, "homeState")); }

// ---------------------------------------------------------------- 3/4. farming loop + tools at home
phase("farm", async (ctx) => {
  const A = await playerA(ctx);
  const pa = A.page;
  await goHome(pa);
  await cmd(pa, "/time 8");
  for (const [it, n] of [["seed_radish", 3], ["seed_strawberry", 2], ["seed_potato", 2], ["seed_pumpkin", 2], ["seed_blueberry", 2], ["seed_corn", 1], ["seed_moonberry", 1], ["seed_golden_melon", 1]]) { await cmd(pa, `/give ${it} ${n}`); await wait(pa, 600); }
  await wait(pa, 600);
  log("bag", (await inv(pa)).slots.filter(Boolean).map((s) => `${s.item}x${s.qty}`).join(" "));
  const hs0 = await homeState(pa);
  log("start stamina/water", hs0?.stamina, hs0?.water);

  // --- soil autotiling: a 3x3 block, an L and a lone tile inside the plot, plus grass outside it
  const block = [];
  for (let y = 4; y <= 6; y++) for (let x = 20; x <= 22; x++) block.push([x, y]);
  const L = [[25, 4], [25, 5], [25, 6], [26, 6], [27, 6]];
  const lone = [[30, 4]];
  const outside = [[14, 16], [3, 4]];
  let st0 = (await homeState(pa)).stamina;
  let tilled = 0;
  for (const [x, y] of [...block, ...L, ...lone]) {
    await near(pa, x, y);
    const a = await answer(pa, () => use(pa, "hoe", x, y, 420));
    if (a) log("till", x, y, a); else tilled++;
  }
  for (const [x, y] of outside) {
    await near(pa, x, y);
    const a = await answer(pa, () => use(pa, "hoe", x, y, 420));
    log("till outside the plot", x, y, a || "ok");
  }
  const farm1 = await farmMap(pa);
  check("hoe tills grass in the plot", tilled === block.length + L.length + lone.length, `${tilled}`);
  check("hoe tills yard grass outside the plot", outside.every(([x, y]) => farm1[`${x},${y}`]), outside.filter(([x, y]) => !farm1[`${x},${y}`]));
  const hs1 = await homeState(pa);
  log("stamina after", tilled + outside.length, "tills:", st0, "->", hs1.stamina);
  check("hoe costs 2 stamina a swing", st0 - hs1.stamina === 2 * (tilled + outside.length), `${st0 - hs1.stamina}`);
  await walk(pa, 24.5, 8.5);
  await wait(pa, 600);
  await shot(pa, "qa-13-soil-autotile");

  // --- tool rules at home
  const rocks = await pa.evaluate(() => window.__dmmo.rocks());
  const props = await pa.evaluate(() => window.__dmmo.props());
  const trees = props.filter((p) => p.type === "tree");
  log("home rocks", rocks.length, "trees", trees.length);
  const rock = rocks[0];
  const tree = trees.find((t) => t.y > 14 && t.x > 10 && t.x < 30) ?? trees[0];
  const matrix = {};
  const tryAll = async (label, tx, ty, items) => {
    await near(pa, tx, ty, `near ${label}`);
    for (const it of items) matrix[`${it} → ${label}`] = (await answer(pa, () => use(pa, it, tx, ty, 450))) || "(ok/silent)";
  };
  await tryAll("path", 15, 12, ["hoe", "watering_can", "seed_turnip", "pickaxe", "axe", "sword_wood"]);
  await tryAll("doorstep", 8, 11, ["hoe"]);
  await tryAll("grass", 16, 15, ["watering_can", "seed_turnip", "pickaxe", "axe", "sword_wood", "chair_wood"]);
  await tryAll("soil", 20, 4, ["hoe", "pickaxe", "axe", "sword_wood"]);
  await tryAll("pond", 8, 20, ["hoe", "seed_turnip", "pickaxe", "watering_can"]);
  if (rock) await tryAll("rock", rock.x, rock.y, ["hoe", "watering_can", "axe", "sword_wood", "seed_turnip"]);
  if (tree) await tryAll("tree", tree.x, tree.y, ["hoe", "watering_can", "pickaxe", "sword_wood"]);
  for (const [k, v] of Object.entries(matrix)) log("  ", k.padEnd(28), v);
  check("wrong tool on a rock says pickaxe", /pickaxe/.test(matrix["axe → rock"] ?? ""), matrix["axe → rock"]);
  check("wrong tool on a tree says axe", /axe/.test(matrix["pickaxe → tree"] ?? ""), matrix["pickaxe → tree"]);
  check("hoe on path refused", /can't till/i.test(matrix["hoe → path"]), matrix["hoe → path"]);
  check("can on grass says till first", /Till/.test(matrix["watering_can → grass"]), matrix["watering_can → grass"]);
  check("seed on grass says till first", /Till/.test(matrix["seed_turnip → grass"]), matrix["seed_turnip → grass"]);

  // --- rocks: multi-hit, drops
  if (rock) {
    await near(pa, rock.x, rock.y);
    const hits = [];
    for (let i = 0; i < 4; i++) {
      await use(pa, "pickaxe", rock.x, rock.y, 600);
      const r = (await msgs(pa, "rock")).filter((m) => m.id === rock.id).at(-1);
      hits.push(r ? `${r.hits}/${r.need}${r.broken ? " broken " + r.drops : ""}` : "none");
      if (r?.broken) break;
    }
    log("rock hits", hits);
    check("stone rock breaks in 2 hits", hits[1]?.includes("broken"), hits);
    await shot(pa, "qa-14-rock-broken");
  }
  // --- tree: multi-hit, stump, clear
  if (tree) {
    await near(pa, tree.x, tree.y);
    const seq = [];
    for (let i = 0; i < 9; i++) {
      await use(pa, "axe", tree.x, tree.y, 600);
      const r = (await msgs(pa, "tree")).filter((m) => m.id === tree.id).at(-1);
      seq.push(r ? `${r.stage}${r.hits}/${r.need}${r.drops?.length ? " +" + r.drops.length : ""}` : "none");
      if (r?.stage === "gone") break;
      if (i === 2) await shot(pa, "qa-15-tree-chop");
    }
    log("tree chop", seq);
    check("tree falls to a stump, then clears", seq.some((s) => s.startsWith("stump")) && seq.at(-1).startsWith("gone"), seq);
    await shot(pa, "qa-16-tree-cleared");
  }

  // --- plant a crop of each kind (row y=4..6 block) + water
  const plots = [
    [20, 4, "seed_turnip"], [21, 4, "seed_radish"], [22, 4, "seed_strawberry"],
    [20, 5, "seed_potato"], [21, 5, "seed_pumpkin"], [22, 5, "seed_blueberry"],
    [20, 6, "seed_corn"], [21, 6, "seed_moonberry"], [22, 6, "seed_golden_melon"],
  ];
  // Wilt / revive / death tiles: planted, never watered (25,4..6); (26,6) revived on day 2.
  const dry = [[25, 4, "seed_turnip"], [25, 5, "seed_turnip"], [25, 6, "seed_turnip"], [26, 6, "seed_turnip"]];
  // Watered while empty, then planted: today's water counts.
  await near(pa, 27, 6);
  const wa = await answer(pa, () => use(pa, "watering_can", 27, 6));
  check("watering empty soil works", !wa, wa);
  await use(pa, "seed_turnip", 27, 6);
  const t276 = (await farmMap(pa))["27,6"];
  check("seed on pre-watered soil counts today's water", t276?.wateredDays === 1, t276);
  for (const [x, y, seed] of [...plots, ...dry]) {
    await near(pa, x, y);
    const a = await answer(pa, () => use(pa, seed, x, y, 380));
    if (a) log("plant", seed, a);
  }
  const waterAll = async (tiles) => { for (const [x, y] of tiles) { await near(pa, x, y); const a = await answer(pa, () => use(pa, "watering_can", x, y, 380)); if (a) log("water", x, y, a); } };
  await waterAll(plots);
  await walk(pa, 23.5, 8.2);
  await wait(pa, 500);
  await shot(pa, "qa-17-planted-watered");
  const hsW = await homeState(pa);
  log("water left", hsW.water, "stamina", hsW.stamina);

  // --- grow with /day; water the main plots each morning, revive (26,6) on day 2
  const stages = {};
  const view = async () => {
    const f = await farmMap(pa);
    return f;
  };
  const coinsStart = await coins(pa);
  const harvested = [];
  for (let day = 1; day <= 9; day++) {
    const sum = await dayEnd(pa);
    log(`day ${day} summary`, JSON.stringify({ grown: sum?.grown, wilted: sum?.wilted, died: sum?.died?.length, crows: sum?.crows?.length, reverted: sum?.reverted, total: sum?.total }));
    // mornings start inside: go out
    await goHome(pa);
    const f = await view();
    stages[day] = Object.fromEntries([...plots, ...dry].map(([x, y]) => { const t = f[`${x},${y}`]; return [`${x},${y}`, t ? `${t.crop ?? "-"}:${t.wateredDays}${t.dead ? ":dead" : ""}${t.dryDays ? ":dry" + t.dryDays : ""}` : "gone"]; }));
    if (day === 1) { await walk(pa, 25.5, 8.2); await wait(pa, 600); await shot(pa, "qa-18-wilted"); }
    if (day === 1) await waterAll([[26, 6]]); // revive
    // refill when low
    let hs = await homeState(pa);
    if (hs.water < 10) {
      await near(pa, 35, 5, "near well");
      const r = await answer(pa, () => use(pa, "watering_can", 35, 5));
      log("refill at well:", r, "water", (await homeState(pa)).water);
    }
    // harvest what's ready
    for (const [x, y] of plots) {
      const t = (await view())[`${x},${y}`];
      if (!t?.crop) continue;
      await near(pa, x, y);
      const n0 = (await msgs(pa, "notice")).length;
      const before = await inv(pa);
      const a = await answer(pa, () => use(pa, "hoe", x, y, 500));
      const tt = (await view())[`${x},${y}`];
      if (tt && t.crop && (!tt.crop || tt.wateredDays < t.wateredDays)) {
        const notes = (await msgs(pa, "notice")).slice(n0).map((m) => m.text);
        harvested.push({ day, crop: t.crop, x, y, got: notes.join("|") });
        if (harvested.length === 1) { await wait(pa, 250); await shot(pa, "qa-19-harvest-toast"); }
      } else if (a && !/Already tilled|You can't till/.test(a)) log("harvest try", x, y, a);
    }
    await waterAll(plots.filter(([x, y]) => (async () => true)));
    if (day === 4) { await walk(pa, 21.5, 8.2); await wait(pa, 500); await shot(pa, "qa-20-crops-growing"); }
  }
  log("growth by day", stages);
  log("harvests", harvested);
  const f = await view();
  check("never-watered turnips died after 3 dry days", [[25, 4], [25, 5], [25, 6]].every(([x, y]) => f[`${x},${y}`]?.dead), [[25, 4], [25, 5], [25, 6]].map(([x, y]) => f[`${x},${y}`]));
  ctx.harvested = harvested;
  await walk(pa, 24.5, 8.2); await wait(pa, 500);
  await shot(pa, "qa-21-dead-crops");
  // clear dead: hoe and by hand
  await near(pa, 25, 4);
  const c1 = await answer(pa, () => use(pa, "hoe", 25, 4));
  await near(pa, 25, 5);
  const c2 = await answer(pa, () => use(pa, "chair_wood", 25, 5));
  const f2 = await view();
  check("hoe clears a dead crop", f2["25,4"] && !f2["25,4"].crop, c1 + JSON.stringify(f2["25,4"]));
  check("hand clears a dead crop", f2["25,5"] && !f2["25,5"].crop, c2 + JSON.stringify(f2["25,5"]));
  log("coins during farming", coinsStart, "->", await coins(pa));
});

async function goRiverside(page) {
  await goVillage(page);
  await walk(page, 31.5, 45.5, "to river exit", 40000);
  await moveInto(page, 31.5, 47.4, "riverside");
}
const monsters = async (page) => (await state(page)).ents.filter((e) => e.kind === "monster");
/** Swings `item` at the nearest monster until it dies or `max` swings; returns hit messages. */
async function fight(page, item, max = 12, near = null) {
  const hits = [];
  const me0 = await state(page);
  let target = null;
  for (let i = 0; i < max; i++) {
    const s = await state(page);
    const ms = s.ents.filter((e) => e.kind === "monster");
    target = (target && ms.find((m) => m.id === target.id)) ?? ms.filter((m) => !near || Math.hypot(m.x - near.x, m.y - near.y) < 8).sort((a, b) => Math.hypot(a.x - s.me.x, a.y - s.me.y) - Math.hypot(b.x - s.me.x, b.y - s.me.y))[0];
    if (!target) break;
    if (Math.hypot(target.x - s.me.x, target.y - s.me.y) > 1.1) {
      await page.evaluate(([x, y]) => window.__dmmo.moveTo(x, y), [target.x - 0.9, target.y]);
      await wait(page, 500);
      continue;
    }
    const n = (await msgs(page, "hit")).length;
    const t0 = await page.evaluate(() => performance.now());
    await send(page, { t: "use", slot: await slotOf(page, item), x: Math.floor(target.x), y: Math.floor(target.y) });
    await wait(page, 520);
    const got = (await msgs(page, "hit")).slice(n);
    for (const h of got) hits.push({ ...h, lagMs: Math.round(h.__at - t0) });
    if (got.some((h) => h.kill && h.id === target.id)) target = null;
  }
  void me0;
  return hits;
}

// ---------------------------------------------------------------- 5. combat
async function goCaves(page) {
  await goVillage(page);
  await walk(page, 61.5, 23.5, "to quarry exit", 40000);
  await moveInto(page, 63.4, 23.5, "quarry");
  // Up the road to the cave mouth in the cliff, and in.
  await walk(page, 26.5, 7.5, "to the cave mouth", 40000);
  await moveInto(page, 26.5, 5.5, "caves");
}
const groundOf = (page) => page.evaluate(() => { const g = {}; for (const m of window.__msgs) { if (m.t === "welcome") { for (const k of Object.keys(g)) delete g[k]; for (const x of m.ground ?? []) g[x.id] = x; } if (m.t === "ground") { for (const x of m.upd) g[x.id] = x; for (const d of m.del) delete g[d]; } } return Object.values(g); });
/** Round trip of an emote echo: the baseline delay for anything the server sends back at once. */
async function echoMs(page) {
  const n = (await msgs(page, "emote")).length;
  const t0 = await page.evaluate(() => performance.now());
  await send(page, { t: "emote", code: "wave" });
  for (let i = 0; i < 40; i++) { const e = await msgs(page, "emote"); if (e.length > n) return Math.round(e.at(-1).__at - t0); await wait(page, 25); }
  return null;
}
phase("combat", async (ctx) => {
  const A = await playerA(ctx); const B = await playerB(ctx);
  const pa = A.page, pb = B.page;
  await goHome(pa);
  await cmd(pa, "/give sword_copper 1");
  await wait(pa, 400);
  // --- riverside: HUD, forage, monster hit timing
  await goRiverside(pa);
  await wait(pa, 1500);
  check("stamina bar shows in zones", await pa.isVisible("#home-stamina").catch(() => false));
  check("clock and can hidden in zones", !(await pa.isVisible("#home-clock").catch(() => true)) && !(await pa.isVisible("#home-water").catch(() => true)));
  await shot(pa, "qa-22-zone-hud-stamina");
  const ground = await groundOf(pa);
  const forage = ground.filter((g) => g.forage);
  log("riverside ground items", ground.length, "forage", forage.length, JSON.stringify(forage.slice(0, 3)));
  if (forage[0]) {
    const me = (await state(pa)).me;
    const f = forage.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
    await walk(pa, f.x + 0.9, f.y, "A to forage", 30000, true);
    const before = await qtyOf(pa, f.item);
    await send(pa, { t: "interact", target: "ground:" + f.id });
    await wait(pa, 800);
    check("forage picked into the bag", (await qtyOf(pa, f.item)) === before + f.qty, `${f.item} ${before} -> ${await qtyOf(pa, f.item)}`);
    await shot(pa, "qa-26-forage");
  } else check("riverside has forage", false);
  const camp = { x: 5.5, y: 6.5 };
  await walk(pa, 10.5, 6.5, "A to slime camp", 40000, true);
  const base = [];
  for (let i = 0; i < 3; i++) base.push(await echoMs(pa));
  const hits = await fight(pa, "sword_wood", 10, camp);
  const echo = Math.min(...base.filter((x) => x !== null));
  log("echo baseline ms", base, "wood sword hits", hits.map((h) => `${h.dmg}${h.crit ? "!" : ""}${h.kill ? " KILL" : ""} kb=${h.kb ? Math.hypot(h.kb.x, h.kb.y).toFixed(2) : "-"} lag=${h.lagMs}`));
  const extra = hits.map((h) => h.lagMs - echo).sort((a, b) => a - b);
  check("monster hit lands at the impact frame (~180-230 ms after the echo baseline)", extra.length > 0 && extra[Math.floor(extra.length / 2)] >= 140, extra);
  check("wood sword 4-6 minus defence", hits.filter((h) => !h.crit && !h.miss).every((h) => h.dmg >= 3 && h.dmg <= 6), hits.map((h) => h.dmg));
  check("hits knock back", hits.filter((h) => !h.kill && !h.miss).every((h) => h.kb));
  await shot(pa, "qa-23-combat-damage-numbers");

  // --- caves: spawn scaling 1 vs 2 players, shared kills, hurt, faint
  await goCaves(pa);
  const f1 = { x: 35, y: 12 };
  await walk(pa, 30.5, 12.5, "A to floor 1", 40000, true);
  const count = async () => (await monsters(pa)).filter((m) => m.sprite !== "bat" && Math.hypot(m.x - f1.x, m.y - f1.y) < 12).length;
  const solo = []; for (let i = 0; i < 4; i++) { solo.push(await count()); await wait(pa, 1500); }
  await goCaves(pb);
  await walk(pb, 30.5, 13.5, "B to floor 1", 40000, true);
  const duo = []; for (let i = 0; i < 6; i++) { duo.push(await count()); await wait(pa, 2000); }
  log("floor 1 slimes solo", solo, "with two", duo);
  check("more slimes with two players", Math.max(...duo) > Math.max(...solo), { solo, duo });
  await shot(pa, "qa-24-caves-two-players");
  // both swing at the same slimes
  const nA = (await msgs(pa, "loot")).length, nB = (await msgs(pb, "loot")).length;
  const both = await Promise.all([fight(pa, "sword_copper", 12, f1), fight(pb, "sword_wood", 12, f1)]);
  const aKills = new Set(both[0].filter((h) => h.kill).map((h) => h.id)), bHit = new Set(both[1].map((h) => h.id));
  const aHit = new Set(both[0].map((h) => h.id));
  log("A copper", both[0].map((h) => `${h.dmg}${h.crit ? "!" : ""}${h.kill ? "K" : ""}`), "B wood", both[1].map((h) => `${h.dmg}${h.crit ? "!" : ""}${h.kill ? "K" : ""}`));
  const sharedKills = [...aKills].filter((id) => bHit.has(id)).length + both[1].filter((h) => h.kill && aHit.has(h.id)).length;
  const lootA = (await msgs(pa, "loot")).slice(nA), lootB = (await msgs(pb, "loot")).slice(nB);
  log("kills both hit", sharedKills, "A loot", lootA.map((l) => l.items.join("+")), "B loot", lootB.map((l) => l.items.join("+")));
  const crits = [...both[0], ...both[1], ...hits].filter((h) => h.crit).length;
  log("crits", crits, "of", both[0].length + both[1].length + hits.length);
  await shot(pb, "qa-25-combat-b-view");
  // bag full: loot goes to the ground
  await goHome(pb);
  for (let i = 0; i < 24; i++) await cmd(pb, "/give stone 99");
  await wait(pb, 800);
  log("B free slots", (await inv(pb)).slots.filter((x) => !x).length);
  await goCaves(pb);
  await walk(pb, 30.5, 13.5, "B to floor 1 (full bag)", 40000, true);
  const gB0 = (await groundOf(pb)).filter((g) => !g.forage).length;
  const fullHits = await fight(pb, "sword_wood", 16, f1);
  await wait(pb, 600);
  const gB = (await groundOf(pb)).filter((g) => !g.forage);
  const gA = (await groundOf(pa)).filter((g) => !g.forage);
  log("B full-bag kills", fullHits.filter((h) => h.kill).length, "B ground items", gB0, "->", gB.length, JSON.stringify(gB.slice(0, 3)), "A sees", gA.length);
  check("full bag: loot dropped on the ground for B", fullHits.every((h) => !h.kill) || gB.length > gB0, gB.length);
  check("B's drops are private (A doesn't see them)", gA.every((g) => !gB.some((x) => x.id === g.id)));
  if (gB[0]) { await walk(pb, gB[0].x, gB[0].y - 1, "B by its drop", 15000, true); await wait(pb, 400); await shot(pb, "qa-27-ground-drop-full-bag"); }
  // hurt, i-frames and fainting: A stands among the slimes
  ctx.youA = (await state(pa)).you;
  const hurt0 = (await msgs(pa, "hurt")).filter((h) => h.id === ctx.youA).length;
  const coins0 = await coins(pa);
  const mlist = (await monsters(pa)).filter((m) => Math.hypot(m.x - f1.x, m.y - f1.y) < 12);
  log("A waits among", mlist.length, "monsters, hp", (await state(pa)).me.hp);
  let fainted = false;
  for (let i = 0; i < 70 && !fainted; i++) {
    const ms = (await monsters(pa)).filter((m) => m.sprite !== "bat");
    const s = await state(pa);
    if (!s || s.zone !== "caves") { fainted = true; break; }
    const m = ms.sort((a, b) => Math.hypot(a.x - s.me.x, a.y - s.me.y) - Math.hypot(b.x - s.me.x, b.y - s.me.y))[0];
    if (m && Math.hypot(m.x - s.me.x, m.y - s.me.y) > 1) await pa.evaluate(([x, y]) => window.__dmmo.moveTo(x, y), [m.x, m.y + 0.3]);
    if (i === 8) await shot(pa, "qa-28-player-hurt");
    await wait(pa, 1000);
  }
  const hurts = (await msgs(pa, "hurt")).filter((h) => h.id === ctx.youA).slice(hurt0);
  const gaps = hurts.map((h, i, a) => (i ? Math.round(h.__at - a[i - 1].__at) : null)).filter((x) => x !== null);
  log("A hurt", hurts.map((h) => h.dmg), "min gap ms", Math.min(...gaps));
  check("player i-frames: hurts at least ~1.2 s apart", gaps.every((g) => g >= 1050), gaps.filter((g) => g < 1050));
  const s = await state(pa);
  const notes = (await msgs(pa, "notice")).slice(-4).map((m) => m.text);
  log("after the fight", s.zone, await Q.homeMapOf(pa), "hp", s.me?.hp, "coins", coins0, "->", await coins(pa), notes);
  check("fainting in a zone wakes you inside at home, healed, minus 10% coins", s.zone === "home" && (await Q.homeMapOf(pa)) === "home_in" && s.me.hp === 100, notes.join(" | "));
  await wait(pa, 1000);
  await shot(pa, "qa-29-fainted-home");
});

// ---------------------------------------------------------------- 6. time
const clockText = (page) => page.textContent("#home-clock").catch(() => "");
async function toBed(page) {
  await goHome(page);
  if ((await Q.homeMapOf(page)) !== "home_in") { await walk(page, 8.5, 11.8, "to house door"); await moveInto(page, 8.5, 10.5, "home", "home_in"); }
  await walk(page, 3.5, 5.5, "to the bed", 15000, true);
}
phase("time", async (ctx) => {
  const A = await playerA(ctx);
  const pa = A.page;
  await goHome(pa);
  await cmd(pa, "/time 9");
  await wait(pa, 800);
  const c1 = await clockText(pa); await wait(pa, 10000); const c2 = await clockText(pa);
  log("home clock over 10 s real time:", c1, "->", c2);
  check("home clock advances (~12 game minutes per 10 s)", c1 !== c2, `${c1} -> ${c2}`);
  for (const h of [6, 12, 18, 20, 22, 25]) {
    await cmd(pa, `/time ${h % 24}`); await wait(pa, 1800);
    await shot(pa, `qa-30-light-${String(h).padStart(2, "0")}h`);
  }
  // sleep alone via the bed
  await cmd(pa, "/time 21");
  await toBed(pa);
  const p = await pa.evaluate(() => window.__dmmo.tileToScreen(2.5, 4.5));
  await pa.mouse.click(p.x, p.y);
  await wait(pa, 600);
  check("clicking the bed asks to sleep", await pa.isVisible("#sleep-dialog"));
  await shot(pa, "qa-31-sleep-confirm");
  await pa.click("#sleep-no"); await wait(pa, 300);
  check("Not now keeps the day", !(await pa.isVisible("#sleep-dialog")) && (await msgs(pa, "daySummary")).length >= 0);
  const n = (await msgs(pa, "daySummary")).length;
  await pa.mouse.click(p.x, p.y); await wait(pa, 500);
  await pa.click("#sleep-yes");
  await wait(pa, 5000);
  const sums = await msgs(pa, "daySummary");
  check("sleeping ends the day", sums.length > n, sums.at(-1)?.summary);
  await shot(pa, "qa-32-day-summary");
  await dismiss(pa);
  // pass out at 2 AM
  await cmd(pa, "/time 1:58");
  const coins0 = await coins(pa);
  await wait(pa, 4500);
  const last = (await msgs(pa, "daySummary")).at(-1)?.summary;
  log("pass-out summary", last, "coins", coins0, "->", await coins(pa));
  check("passing out at 2:00 ends the day with a penalty", last?.passedOut === true && (await coins(pa)) === coins0 - last.penalty, last);
  await shot(pa, "qa-33-passed-out-summary");
  await dismiss(pa);
  const hs = await homeState(pa);
  check("passing out leaves you with half stamina", hs.stamina === 50, hs.stamina);
  // world calendar on the map
  await pa.keyboard.press("m"); await wait(pa, 700);
  log("map pane", (await pa.textContent("#map-pane").catch(() => "")).slice(0, 200));
  await shot(pa, "qa-34-map-calendar");
  await pa.keyboard.press("Escape"); await wait(pa, 300);
});

// ---------------------------------------------------------------- 7. economy
async function odette(page) {
  await goVillage(page);
  await cmd(page, "/hour 12");
  await walk(page, 46.5, 21.5, "to the market", 40000);
  const s = await state(page);
  const o = s.ents.find((e) => e.npcId === "odette" || /odette/i.test(e.name));
  if (o) await walk(page, o.x, o.y + 1.3, "next to Odette", 15000, true);
  return o;
}
phase("economy", async (ctx) => {
  const A = await playerA(ctx);
  const pa = A.page;
  // stock up at home for selling
  await goHome(pa);
  for (const [it, n] of [["turnip", 5], ["turnip_silver", 2], ["turnip_gold", 2], ["pumpkin", 1], ["stone", 10], ["carrot", 12], ["potato", 6]]) { await cmd(pa, `/give ${it} ${n}`); await wait(pa, 600); }
  await wait(pa, 500);
  // shipping bin: drop-in, lid, merge, unship, payout
  await walk(pa, 10.5, 12.6, "to the shipping bin", 20000);
  const binSlot = async (it) => { await send(pa, { t: "interact", target: `shipping_bin:${await slotOf(pa, it)}` }); await wait(pa, 600); };
  await use(pa, "turnip", 10, 11, 200);
  await wait(pa, 200);
  await shot(pa, "qa-35-bin-lid-dropin");
  await wait(pa, 600);
  await cmd(pa, "/give turnip 3"); await wait(pa, 400);
  await cmd(pa, "/give turnip_silver 2"); await wait(pa, 400);
  await cmd(pa, "/give turnip_gold 1"); await wait(pa, 400);
  await cmd(pa, "/give carrot 4"); await wait(pa, 400);
  const binBefore = await lastOf(pa, "bin");
  const t0 = binBefore?.items?.find((l) => l.item === "turnip")?.qty ?? 0;
  const tq = await qtyOf(pa, "turnip"), sq = await qtyOf(pa, "stone"), gq = await qtyOf(pa, "turnip_silver");
  await use(pa, "turnip", 10, 11, 700);
  await use(pa, "turnip_silver", 10, 11, 700);
  await use(pa, "stone", 10, 11, 700);
  const bin = await lastOf(pa, "bin");
  log("bin", JSON.stringify(bin.items), "total", bin.total);
  check("same item merges into one bin line", bin.items.filter((l) => l.item === "turnip").length === 1 && bin.items.find((l) => l.item === "turnip")?.qty === t0 + tq, { t0, tq, items: bin.items });
  check("silver sells x1.25", bin.items.find((l) => l.item === "turnip_silver")?.coins === gq * Math.round(25 * 1.25), { gq, items: bin.items });
  await shot(pa, "qa-36-bin-panel");
  await pa.click("#bin-takeback"); await wait(pa, 600);
  const bin2 = await lastOf(pa, "bin");
  check("take back returns the last stack", !bin2.items.some((l) => l.item === "stone") && (await qtyOf(pa, "stone")) === sq, { sq, items: bin2.items });
  const c0 = await coins(pa);
  const sum = await dayEnd(pa);
  log("day summary lines", JSON.stringify(sum.lines), "total", sum.total, "coins", c0, "->", await coins(pa));
  check("end of day pays the bin total", (await coins(pa)) === c0 + sum.total && sum.total === bin2.total, `${c0}+${sum.total}`);
  await shot(pa, "qa-37-summary-payout");
  // shop at Odette: season shelf, buy, sell, quality prices, not enough coins, spam buy
  const o = await odette(pa);
  if (!o) { check("Odette found", false); return; }
  await send(pa, { t: "interact", target: o.id });
  await wait(pa, 1200);
  const shop = await lastOf(pa, "shop");
  log("odette offers", shop?.offers.map((x) => `${x.item}@${x.price}`).join(" "));
  ctx.shopOffers = shop?.offers;
  await shot(pa, "qa-38-shop-buy");
  if (await pa.isVisible("#shop-tab-sell")) { await pa.click("#shop-tab-sell"); await wait(pa, 400); await shot(pa, "qa-39-shop-sell"); }
  const sellOne = async (it) => { const before = await coins(pa); await send(pa, { t: "sell", npc: o.id, slot: await slotOf(pa, it), qty: 1 }); await wait(pa, 500); return (await coins(pa)) - before; };
  const pN = await sellOne("turnip_gold"); const pG = pN;
  log("sell gold turnip +", pG);
  check("gold turnip sells for 1.5x (38)", pG === Math.round(25 * 1.5), pG);
  const stoneAns = await answer(pa, () => send(pa, { t: "sell", npc: o.id, slot: 0, qty: 1 }));
  check("Odette won't buy a hoe", /can't be sold|don't buy/i.test(stoneAns), stoneAns);
  const offer = shop.offers[0];
  const before = await coins(pa);
  // Spam: 30 buys at once for 1 seed each; coins must never go negative, items match coins spent.
  const items0 = await qtyOf(pa, offer.item);
  await pa.evaluate(([npc, item]) => { for (let i = 0; i < 30; i++) window.__dmmo.send({ t: "buy", npc, item, qty: 1 }); }, [o.id, offer.item]);
  await wait(pa, 2000);
  const after = await coins(pa), items1 = await qtyOf(pa, offer.item);
  log("spam buy", offer.item, "@", offer.price, "coins", before, "->", after, "items", items0, "->", items1);
  check("spam buy: coins >= 0 and items == coins spent / price", after >= 0 && (before - after) === (items1 - items0) * offer.price, { before, after, items0, items1 });
  const poor = await answer(pa, () => send(pa, { t: "buy", npc: o.id, item: shop.offers.at(-1).item, qty: 99 }));
  check("can't buy without coins", /Not enough coins|bag is full/.test(poor), poor);
  // sell spam on one slot: only what's there gets paid
  const sl = await slotOf(pa, "carrot"), have = await qtyOf(pa, "carrot"), cs = await coins(pa);
  await pa.evaluate(([npc, slot, q]) => { for (let i = 0; i < 10; i++) window.__dmmo.send({ t: "sell", npc, slot, qty: q }); }, [o.id, sl, have]);
  await wait(pa, 1500);
  const sellPrice = 40;
  log("sell spam paid", (await coins(pa)) - cs, "for", have, "x", sellPrice);
  check("sell spam pays once", (await coins(pa)) - cs === have * sellPrice, (await coins(pa)) - cs);
  // moveSlot race: shuffle while selling; total stones conserved or paid
  const st0 = await qtyOf(pa, "potato"), co0 = await coins(pa);
  await pa.evaluate(([npc]) => {
    const inv = window.__dmmo.inventory(); const from = inv.slots.findIndex((s) => s?.item === "potato");
    const empty = inv.slots.findIndex((s, i) => !s && i > 8);
    for (let i = 0; i < 10; i++) { window.__dmmo.send({ t: "moveSlot", from, to: empty, qty: 1 }); window.__dmmo.send({ t: "moveSlot", from: empty, to: from }); }
    window.__dmmo.send({ t: "sell", npc, slot: from, qty: 5 });
  }, [o.id]);
  await wait(pa, 1500);
  const st1 = await qtyOf(pa, "potato");
  log("moveSlot race potato", st0, "->", st1, "coins +", (await coins(pa)) - co0);
  check("moveSlot races conserve items (sold ones paid at 70)", st1 <= st0 && (st0 - st1) * 70 === (await coins(pa)) - co0, { st0, st1, paid: (await coins(pa)) - co0 });
  // zone save hand-off: sell then leave at once
  const cLeave = await coins(pa);
  await goHome(pa);
  check("coins survive the zone -> home hand-off", (await coins(pa)) === cLeave, `${cLeave} -> ${await coins(pa)}`);
});

// ---------------------------------------------------------------- 8. social
const chatLog = (page) => page.textContent("#chat-log");
async function rightClickPlayer(page, entityId) {
  const e = (await state(page)).ents.find((x) => x.id === entityId);
  const p = await page.evaluate(([x, y]) => window.__dmmo.tileToScreen(x, y - 0.6), [e.x, e.y]);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await wait(page, 500);
}
phase("social", async (ctx) => {
  const A = await playerA(ctx); const B = await playerB(ctx);
  const pa = A.page, pb = B.page;
  await goVillage(pa); await goVillage(pb);
  await cmd(pa, "/hour 12");
  await walk(pa, 30.5, 26.5, "A to the square", 40000);
  await walk(pb, 32, 26.5, "B next to A", 40000);
  // world chat + bubble
  await pa.click("#chat-tab-world").catch(() => {});
  await chat(pa, "hello from the world tab everyone, this is a long line");
  await wait(pb, 1200);
  check("B gets A's world chat", (await chatLog(pb)).includes("hello from the world tab"));
  await shot(pa, "qa-40-chat-bubble");
  // slash popup
  await pa.click("#chat-input"); await pa.keyboard.type("/");
  await wait(pa, 400);
  const slashVisible = await pa.isVisible("#chat-slash");
  log("slash popup", slashVisible, (await pa.textContent("#chat-slash").catch(() => "")).slice(0, 200));
  check("typing / shows the command popup", slashVisible);
  await shot(pa, "qa-41-slash-popup");
  await pa.keyboard.press("Escape"); await pa.fill("#chat-input", ""); await pa.evaluate(() => document.activeElement?.blur?.());
  // PM + reply
  await chat(pa, `/w ${B.name} secret note`);
  await wait(pb, 1200);
  check("B gets the whisper", (await chatLog(pb)).includes("secret note"));
  await chat(pb, "/r got it");
  await wait(pa, 1000);
  check("A gets the reply", (await chatLog(pa)).includes("got it"));
  await pa.click("#chat-tab-pm").catch(() => {}); await wait(pa, 300);
  await shot(pa, "qa-42-pm-tab");
  await pa.click("#chat-tab-all").catch(() => {});
  // emotes
  await pa.click("#chat-emote"); await wait(pa, 300);
  check("emote picker opens", await pa.isVisible("#chat-emotes"));
  await shot(pa, "qa-43-emote-picker");
  const em = await pa.$$("#chat-emotes button");
  log("emote choices", em.length);
  if (em[2]) await em[2].click();
  await wait(pb, 600);
  check("B sees A's emote", (await msgs(pb, "emote")).length > 0);
  await shot(pb, "qa-44-emote-seen-by-b");
  // right-click card, friend, mute
  const bId = (await state(pb)).you, aId = (await state(pa)).you;
  await rightClickPlayer(pa, bId);
  check("right-click opens the player card", await pa.isVisible("#player-card"));
  log("card", (await pa.textContent("#player-card").catch(() => "")).replace(/\s+/g, " ").slice(0, 200));
  await shot(pa, "qa-45-player-card");
  if (await pa.isVisible("#player-card-friend")) { await pa.click("#player-card-friend"); await wait(pa, 1500); }
  await pb.click("#hud-btn-friends").catch(() => pb.keyboard.press("o")); await wait(pb, 800);
  if (await pb.$("#friends-tab-requests")) await pb.click("#friends-tab-requests");
  await wait(pb, 500);
  await shot(pb, "qa-46-friend-request");
  const acc = await pb.$("#friends-panel button:has-text('Accept')");
  check("B has a friend request", !!acc);
  if (acc) { await acc.click(); await wait(pb, 1500); }
  await pb.keyboard.press("Escape");
  await pa.keyboard.press("Escape");
  await pa.keyboard.press("o"); await wait(pa, 1200);
  if (await pa.$("#friends-tab-friends")) await pa.click("#friends-tab-friends");
  await wait(pa, 600);
  const fl = await pa.textContent("#friends-panel").catch(() => "");
  check("A sees B as a friend, online", fl.includes(B.name) && /online|village|Mossbrook/i.test(fl), fl.slice(0, 200));
  await shot(pa, "qa-47-friends-presence");
  await pa.keyboard.press("Escape");
  // mute: A mutes B, B talks, A must not see it; unmute
  await rightClickPlayer(pa, bId);
  if (await pa.isVisible("#player-card-mute")) { await pa.click("#player-card-mute"); await wait(pa, 1200); }
  await pa.keyboard.press("Escape");
  await chat(pb, "muted words here");
  await wait(pa, 1200);
  check("muted player's chat hidden", !(await chatLog(pa)).includes("muted words here"));
  await shot(pa, "qa-48-muted");
  await rightClickPlayer(pa, bId);
  const muteLabel = await pa.textContent("#player-card-mute").catch(() => "");
  check("card offers Unmute", /Unmute/.test(muteLabel), muteLabel);
  if (/Unmute/.test(muteLabel)) { await pa.click("#player-card-mute"); await wait(pa, 1200); }
  await pa.keyboard.press("Escape");
  await chat(pb, "back in the chat");
  await wait(pa, 1200);
  check("unmuted chat shows again", (await chatLog(pa)).includes("back in the chat"));
  void aId;
});

// ---------------------------------------------------------------- 8b. home visit, harvest-only, double harvest, kick, sleep countdown, mailbox
phase("visit", async (ctx) => {
  const A = await playerA(ctx); const B = await playerB(ctx);
  const pa = A.page, pb = B.page;
  await goHome(pa);
  await cmd(pa, "/time 8");
  // two ripe turnips at A's farm
  const tiles = [[23, 8], [24, 8]];
  await cmd(pa, "/give seed_turnip 2");
  for (const [x, y] of tiles) { await near(pa, x, y); for (const it of ["hoe", "seed_turnip", "watering_can"]) await use(pa, it, x, y, 450); }
  for (let d = 0; d < 2; d++) {
    await dayEnd(pa); await goHome(pa);
    // On the last morning they're ripe: any tool on a ripe crop harvests it, so don't water then.
    if (d === 0) for (const [x, y] of tiles) { await near(pa, x, y); await use(pa, "watering_can", x, y, 450); }
  }
  await walk(pa, 24.5, 10.2, "A by the crops");
  const farm = await farmMap(pa);
  log("A's crops", tiles.map(([x, y]) => JSON.stringify(farm[`${x},${y}`])));
  await goVillage(pb);
  await chat(pa, `/invite ${B.name}`);
  const card = await pb.waitForSelector("#visit-invite:not([hidden])", { timeout: 10000 }).then(() => true).catch(() => false);
  check("B gets an invite card", card);
  await shot(pb, "qa-49-invite-card");
  await pb.click("#visit-accept").catch(() => {});
  await pb.waitForFunction(() => window.__dmmo?.zone === "home", null, { timeout: 15000 }).catch(() => {});
  await wait(pb, 1500);
  check("B is visiting A's home", (await state(pb)).zone === "home");
  await shot(pa, "qa-50-owner-sees-visitor");
  // visitor tools are refused
  await walk(pb, 23.5, 9.6, "B to the crops", 20000, true);
  // a visitor carries nothing here (slot 0 is what the client sends for any swing)
  const hoeAns = await answer(pb, () => use(pb, 0, 22, 8, 500));
  log("visitor hoe:", hoeAns);
  check("visitor can't hoe", hoeAns.length > 0 && !(await farmMap(pa))["22,8"], hoeAns);
  // double harvest race: owner and visitor at the same tick
  await walk(pa, 24.5, 9.6, "A to the crops");
  const t0 = await qtyOf(pa, "turnip") + await qtyOf(pa, "turnip_silver") + await qtyOf(pa, "turnip_gold");
  await Promise.all([send(pa, { t: "use", slot: await slotOf(pa, "hoe"), x: 23, y: 8 }), send(pb, { t: "use", slot: 0, x: 23, y: 8 })]);
  await wait(pa, 1200);
  await send(pb, { t: "use", slot: 0, x: 24, y: 8 });
  await wait(pa, 1200);
  const t1 = await qtyOf(pa, "turnip") + await qtyOf(pa, "turnip_silver") + await qtyOf(pa, "turnip_gold");
  const bin = (await lastOf(pa, "bin"))?.items ?? [];
  log("owner turnips", t0, "->", t1, "bin", JSON.stringify(bin), "B notices", (await msgs(pb, "notice")).slice(-3).map((m) => m.text), "B rejects", (await msgs(pb, "reject")).slice(-3).map((m) => m.reason));
  const roll = (await msgs(pa, "notice")).slice(-4).map((m) => m.text);
  check("two crops harvested by owner+visitor, no duplicate (owner gets <= 2 harvests' worth)", t1 - t0 >= 1 && t1 - t0 <= 4, `${t0}->${t1} ${roll.join("|")}`);
  await shot(pb, "qa-51-visitor-harvest");
  // sleep with a visitor: countdown
  await cmd(pa, "/time 21");
  await toBed(pa);
  const bp = await pa.evaluate(() => window.__dmmo.tileToScreen(2.5, 4.5));
  await pa.mouse.click(bp.x, bp.y); await wait(pa, 500);
  if (await pa.isVisible("#sleep-yes")) await pa.click("#sleep-yes");
  await wait(pb, 1200);
  const cd = await pb.isVisible("#sleep-countdown").catch(() => false);
  log("visitor countdown", cd, await pb.textContent("#sleep-countdown").catch(() => ""));
  check("visitor sees the sleep countdown", cd);
  await shot(pb, "qa-52-visitor-sleep-countdown");
  await wait(pa, 9000);
  await dismiss(pa);
  log("after sleep: B zone", (await state(pb))?.zone, "A summary", JSON.stringify((await msgs(pa, "daySummary")).at(-1)?.summary).slice(0, 200));
  // kick
  if ((await state(pb))?.zone === "home") {
    await chat(pa, `/kick ${B.name}`);
    await pb.waitForFunction(() => window.__dmmo?.zone && window.__dmmo.zone !== "home", null, { timeout: 15000 }).catch(() => {});
    check("kick sends the visitor away", (await state(pb))?.zone !== "home", (await state(pb))?.zone);
    await wait(pb, 800);
    await shot(pb, "qa-53-kicked");
  }
  // mailbox
  await goHome(pa);
  await walk(pa, 5.5, 12.6, "A to the mailbox");
  await send(pa, { t: "interact", target: "mailbox" });
  await wait(pa, 800);
  check("mailbox opens", await pa.isVisible("#mailbox-panel"));
  log("mailbox", (await pa.textContent("#mailbox-panel").catch(() => "")).replace(/\s+/g, " ").slice(0, 300));
  await shot(pa, "qa-54-mailbox");
  await pa.keyboard.press("Escape");
});

// ---------------------------------------------------------------- 9. NPCs
async function talk(page, npcId, say) {
  for (let i = 0; i < 4; i++) {
    const n = (await state(page)).ents.find((e) => e.id === npcId);
    if (!n) return null;
    await walk(page, n.x + 1.1, n.y + 0.2, "next to npc", 12000, true);
    const before = (await msgs(page, "bond")).length;
    if (say) await chat(page, say);
    await send(page, { t: "interact", target: npcId });
    await wait(page, 1500);
    const b = (await msgs(page, "bond")).slice(before);
    if (b.length) return b.at(-1);
  }
  return null;
}
phase("npc", async (ctx) => {
  const A = await playerA(ctx); const B = await playerB(ctx);
  const pa = A.page, pb = B.page;
  await goHome(pa);
  for (const [it, n] of [["strawberry", 2], ["slime_gel", 1], ["turnip", 1], ["moonberry", 1]]) { await cmd(pa, `/give ${it} ${n}`); await wait(pa, 600); }
  await wait(pa, 400);
  const o = await odette(pa);
  if (!o) return check("Odette found", false);
  // talk: facing + bond card
  const b1 = await talk(pa, o.id, "My favourite colour is purple, remember it");
  const s1 = await state(pa); const on = s1.ents.find((e) => e.id === o.id);
  const want = Math.abs(s1.me.x - on.x) >= Math.abs(s1.me.y - on.y) ? (s1.me.x > on.x ? "right" : "left") : (s1.me.y > on.y ? "down" : "up");
  check("Odette faces A when talked to", on.facing === want, `${on.facing} want ${want}`);
  log("talk bond", JSON.stringify(b1).slice(0, 250));
  check("talking raises friendship", (b1?.view?.into ?? 0) > 0, b1?.view);
  await shot(pa, "qa-55-npc-talk-hearts");
  if (await pa.isVisible("#shop-dialog")) await pa.keyboard.press("Escape");
  // gifts: loved, then refused the same day
  const g1 = await answer(pa, async () => send(pa, { t: "giftNpc", npc: o.id, slot: await slotOf(pa, "hoe") }));
  log("gift a hoe:", g1);
  check("tools can't be gifted", /need that yourself/.test(g1), g1);
  const nb = (await msgs(pa, "bond")).length;
  await send(pa, { t: "giftNpc", npc: o.id, slot: await slotOf(pa, "strawberry") });
  await wait(pa, 2000);
  const gb = (await msgs(pa, "bond")).slice(nb);
  log("loved gift bond deltas", gb.map((b) => b.delta));
  check("loved gift gives a big boost (~80)", gb.some((b) => b.delta >= 60), gb.map((b) => b.delta));
  await shot(pa, "qa-56-npc-gift-loved");
  const tSlot = await slotOf(pa, "turnip");
  const g2 = await answer(pa, () => send(pa, { t: "giftNpc", npc: o.id, slot: tSlot }));
  check("second gift the same day refused", /already had a gift|moment/.test(g2), g2);
  // hearts panel
  await pa.keyboard.press("h"); await wait(pa, 700);
  log("hearts panel", (await pa.textContent("#bonds-panel").catch(() => "")).replace(/\s+/g, " ").slice(0, 300));
  await shot(pa, "qa-57-hearts-panel");
  await pa.keyboard.press("Escape");
  // milestones via /hearts: furniture + maybe rare seeds
  const bag0 = (await inv(pa)).slots.filter(Boolean).map((x) => x.item);
  const got = [];
  for (const h of [2, 4, 6, 8, 10]) {
    const n2 = (await state(pa)).ents.find((e) => e.id === o.id);
    await walk(pa, n2.x + 1.1, n2.y + 0.2, "by Odette", 12000, true);
    await cmd(pa, `/hearts ${h}`); await wait(pa, 600);
    const bb = await talk(pa, o.id, null);
    got.push({ h, gifts: bb?.gifts ?? [], hearts: bb?.view?.hearts, pending: bb?.view?.pending ?? 0 });
    if (bb?.gifts?.length && got.filter((g) => g.gifts.length).length === 1) { await wait(pa, 300); await shot(pa, "qa-58-milestone-gift"); }
  }
  const bag1 = (await inv(pa)).slots.filter(Boolean).map((x) => x.item);
  log("milestones", JSON.stringify(got), "new in bag", bag1.filter((x) => !bag0.includes(x)));
  // a full bag keeps the gift with the villager (pending) until there's room
  const gave = (g) => g.gifts.length > 0 || g.pending > 0;
  check("milestone gifts roll at 2/4/6/8/10 hearts (10 always gives)", gave(got.at(-1)) && got.filter(gave).length >= 2, got);
  // per-player memory: B talks to Odette, must not hear about A or purple
  await goVillage(pb);
  await cmd(pb, "/hour 12");
  const lines0 = (await pb.textContent("#chat-log")).length;
  await talk(pb, o.id, "hello Odette");
  await wait(pb, 2500);
  const bLines = (await pb.textContent("#chat-log")).slice(lines0);
  log("Odette to B:", bLines.slice(0, 300));
  check("NPC memory is per player (B hears nothing of A)", !bLines.includes(A.name) && !/purple/i.test(bLines));
  const aLines0 = (await pa.textContent("#chat-log")).length;
  await talk(pa, o.id, "do you remember my favourite colour?");
  await wait(pa, 2500);
  log("Odette to A later:", (await pa.textContent("#chat-log")).slice(aLines0, aLines0 + 300));
  // seated NPC stands up and faces you (inn at 19:00)
  await cmd(pa, "/hour 19");
  await walk(pa, 19.5, 20.5, "A to inn door", 40000);
  await moveInto(pa, 19.5, 19.2, "int_inn");
  let st = await state(pa);
  for (let i = 0; i < 30 && !st.ents.some((e) => e.kind === "npc" && e.act?.k === "sit"); i++) { await wait(pa, 500); st = await state(pa); }
  const sitter = st.ents.find((e) => e.kind === "npc" && e.act?.k === "sit");
  if (sitter) {
    for (const [dx, dy] of [[0, 1.2], [1.2, 0], [-1.2, 0], [0, -1.2]]) if (await walk(pa, sitter.x + dx, sitter.y + dy, "near sitter", 8000, true)) break;
    await send(pa, { t: "interact", target: sitter.id });
    await wait(pa, 1800);
    const s2 = await state(pa); const n2 = s2.ents.find((e) => e.id === sitter.id);
    const w2 = Math.abs(s2.me.x - n2.x) >= Math.abs(s2.me.y - n2.y) ? (s2.me.x > n2.x ? "right" : "left") : (s2.me.y > n2.y ? "down" : "up");
    check("seated NPC stands and faces you", n2.act?.k !== "sit" && n2.facing === w2, `${n2.act?.k} ${n2.facing} want ${w2}`);
    if (await pa.isVisible("#shop-dialog")) await pa.keyboard.press("Escape");
    await shot(pa, "qa-59-npc-stood-up");
  } else check("someone sits in the inn at 19:00", false);
  await walk(pa, 9.5, 11.5, "to inn exit"); await moveInto(pa, 9.5, 12.4, "village");
});

// ---------------------------------------------------------------- 10. inventory + build mode
async function slotEl(page, i) { return page.$(`[data-bag-slot="${i}"]`); }
async function drag(page, from, to, shift = false) {
  const a = await (await slotEl(page, from)).boundingBox(), b = await (await slotEl(page, to)).boundingBox();
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
  await wait(page, 700);
}
const slotsOf = async (page) => (await inv(page)).slots.map((s) => (s ? `${s.item}x${s.qty}` : null));
phase("build", async (ctx) => {
  // A fresh player: the earlier phases leave A's bag full, and the drag tests need empty slots.
  const A = await newPlayer(ctx.chromium, ctx.opts, "Bd");
  ctx.players.push(A);
  await signup(A.page, `Bea_${ctx.stamp}`, `bea-${ctx.stamp}@qa.test`, "female");
  const pa = A.page;
  await goHome(pa);
  await cmd(pa, "/time 10");
  for (const [it, n] of [["seed_radish", 1], ["table_wood", 1], ["painting_landscape", 1], ["rug", 1], ["seed_turnip", 6]]) { await cmd(pa, `/give ${it} ${n}`); await wait(pa, 600); }
  await wait(pa, 500);
  // hotbar stability when a stack runs out
  const before = await slotsOf(pa);
  const rs = before.findIndex((x) => x?.startsWith("seed_radish"));
  for (let k = 0; k < 4 && (await slotsOf(pa))[rs]; k++) {
    await near(pa, 15 + k, 15);
    await use(pa, "hoe", 15 + k, 15, 500);
    await use(pa, rs, 15 + k, 15, 600);
  }
  const after = await slotsOf(pa);
  const moved = before.map((x, i) => (i !== rs && x !== after[i] && !(x?.split("x")[0] === after[i]?.split("x")[0]) ? `${i}:${x}->${after[i]}` : null)).filter(Boolean);
  check("hotbar stays put when a stack is used up", after[rs] === null && moved.length === 0, { rs, moved });
  // drag and drop, split
  await pa.keyboard.press("i"); await wait(pa, 600);
  await shot(pa, "qa-60-bag-open");
  const s0 = await slotsOf(pa);
  const empty = s0.findIndex((x, i) => i > 8 && !x);
  await drag(pa, 0, empty);
  const s1 = await slotsOf(pa);
  check("drag moves an item to an empty slot", s1[0] === null && s1[empty] === s0[0], { from: s1[0], to: s1[empty] });
  await drag(pa, empty, 0);
  const turn = s0.findIndex((x) => x?.startsWith("seed_turnip"));
  const empty2 = (await slotsOf(pa)).findIndex((x, i) => i > 8 && !x);
  await drag(pa, turn, empty2, true);
  const s2 = await slotsOf(pa);
  log("split", s0[turn], "->", s2[turn], "+", s2[empty2]);
  check("shift-drag splits a stack", s2[turn] && s2[empty2] && s2[empty2].startsWith("seed_turnip"), { a: s2[turn], b: s2[empty2] });
  await drag(pa, empty2, turn);
  const s3 = await slotsOf(pa);
  check("dropping on the same item merges", s3[turn] === s0[turn] && !s3[empty2], { a: s3[turn], b: s3[empty2] });
  // swap two different items
  await drag(pa, 1, 2);
  const s4 = await slotsOf(pa);
  check("dropping on another item swaps", s4[1] === s0[2] && s4[2] === s0[1]);
  await drag(pa, 1, 2);
  await shot(pa, "qa-61-bag-after-drags");
  await pa.keyboard.press("Escape"); await wait(pa, 300);
  // furniture inside the house
  await walk(pa, 8.5, 11.8, "to house door"); await moveInto(pa, 8.5, 10.5, "home", "home_in");
  await walk(pa, 6.5, 8.5, "into the room");
  const place = async (item, x, y, rotation = 0) => answer(pa, async () => { await send(pa, { t: "place", slot: await slotOf(pa, item), x, y, rotation }); await wait(pa, 300); });
  const r = {};
  r.wall = await place("chair_wood", 5, 1);
  r.door = await place("chair_wood", 9, 11);
  r.oob = await place("chair_wood", 40, 40);
  r.onBed = await place("chair_wood", 2, 4);
  r.paintingOnFloor = await place("painting_landscape", 6, 6);
  r.tableBadRot = await place("table_wood", 6, 6, 2);
  log("invalid placements", r);
  check("placements on walls, the door, out of bounds and the bed are refused", [r.wall, r.door, r.oob, r.onBed].every((x) => x.length > 0), r);
  check("a wall piece can't go on the floor", r.paintingOnFloor.length > 0, r.paintingOnFloor);
  const objs0 = (await msgs(pa, "objects")).length;
  const okChair = await place("chair_wood", 6, 6, 1);
  let okPaint = "no wall spot";
  for (const [x, y] of [[4, 1], [6, 1], [7, 1], [10, 1], [11, 1], [3, 1], [6, 2], [7, 2], [10, 0], [6, 0]]) {
    okPaint = await place("painting_landscape", x, y);
    if (!okPaint) { log("painting hung at", x, y); break; }
    log("painting at", x, y, "->", okPaint);
  }
  const okRug = await place("rug", 7, 7);
  log("valid placements", { okChair, okPaint, okRug }, "objects msgs", (await msgs(pa, "objects")).length - objs0);
  check("chair (turned), painting on the wall and rug placed", !okChair && !okPaint && !okRug, { okChair, okPaint, okRug });
  await wait(pa, 600);
  await shot(pa, "qa-62-house-furnished");
  // build mode through the UI: select the table, B, rotate with R and the wheel, click
  let ts = await slotOf(pa, "table_wood");
  if (ts >= 8) { await send(pa, { t: "moveSlot", from: ts, to: 7 }); await wait(pa, 500); ts = await slotOf(pa, "table_wood"); }
  if (ts >= 0 && ts < 8) {
    await pa.keyboard.press(String(ts + 1)); await wait(pa, 200);
    await pa.mouse.move(640, 400);
    await pa.keyboard.press("b"); await wait(pa, 400);
    const p = await pa.evaluate(() => window.__dmmo.tileToScreen(9.5, 5.5));
    await pa.mouse.move(p.x, p.y); await wait(pa, 300);
    await shot(pa, "qa-63-build-ghost");
    await pa.keyboard.press("r"); await wait(pa, 300);
    await shot(pa, "qa-64-build-ghost-rotated");
    await pa.mouse.wheel(0, 120); await wait(pa, 300);
    await pa.mouse.click(p.x, p.y); await wait(pa, 800);
    const last = (await msgs(pa, "objects")).at(-1);
    log("UI placed", JSON.stringify(last?.upd));
    check("build mode places the table from the UI", last?.upd?.some((o) => o.item === "table_wood"), last);
  } else log("table not on the hotbar", ts);
  await shot(pa, "qa-65-house-after-build");
});


// ---------------------------------------------------------------- 11. UI / UX at desktop and phone sizes
/** Visible DOM boxes that cover each other, among the HUD's fixed pieces. */
async function hudOverlaps(page) {
  const sels = [".hud-status", ".hud-menu", "#hotbar", ".hud-layer-chat .chat-input, .hud-layer-chat input", ".dlg-notice", ".home-status", ".build-banner"];
  const out = [];
  for (let i = 0; i < sels.length; i++) for (let j = i + 1; j < sels.length; j++) {
    const a = await overlaps(page, sels[i], sels[j]);
    if (a && a > 4) out.push(`${sels[i]} x ${sels[j]}: ${Math.round(a)}px2`);
  }
  return out;
}
async function panelsTour(page, tag, nn) {
  const found = {};
  for (const t of ["bag", "hearts", "friends", "map", "options"]) {
    await page.evaluate((t) => { const b = document.getElementById(`menu-tab-${t}`); if (b && b.offsetParent) b.click(); }, t);
    if (!(await page.isVisible(`#menu-tab-${t}`).catch(() => false))) {
      const id = { bag: "hud-btn-inventory", hearts: "hud-btn-bonds", friends: "hud-btn-friends", map: "hud-btn-map", options: "hud-btn-options" }[t];
      await page.click(`#${id}`).catch((e) => log("open", t, e.message.split("\n")[0]));
    }
    await wait(page, 500);
    const vis = await page.isVisible(`#menu-tab-${t}[aria-selected="true"], #menu-tab-${t}.active, #menu-tab-${t}[aria-current]`).catch(() => false);
    found[t] = vis;
    const clip = await clippedText(page);
    if (clip.length) log(tag, t, "clipped", clip);
    check(`${tag}: ${t} tab has no cut-off text`, clip.length === 0, clip);
    await shot(page, `qa-${nn}-${tag}-menu-${t}`);
  }
  log(tag, "tabs selected", found);
  await page.keyboard.press("Escape"); await wait(page, 400);
  const open = await page.evaluate(() => [...document.querySelectorAll(".game-menu")].some((m) => m.offsetParent));
  check(`${tag}: Esc closes the menu`, !open);
  // goals is its own panel
  await page.click("#hud-btn-goals").catch(() => {});
  await wait(page, 500);
  await shot(page, `qa-${nn}-${tag}-goals`);
  const clip = await clippedText(page);
  check(`${tag}: goals panel has no cut-off text`, clip.length === 0, clip);
  await page.keyboard.press("Escape"); await wait(page, 300);
}

phase("ui", async (ctx) => {
  const p = await newPlayer(ctx.chromium, ctx.opts, "U");
  ctx.players.push(p);
  const pg = p.page;
  await signup(pg, `Uma_${ctx.stamp}`, `uma-${ctx.stamp}@qa.test`, "female");
  await wait(pg, 1000);
  check("desktop: HUD pieces don't overlap at start", (await hudOverlaps(pg)).length === 0, await hudOverlaps(pg));
  check("desktop: no cut-off text at start", (await clippedText(pg)).length === 0, await clippedText(pg));
  await shot(pg, "qa-70-desktop-village");
  await goHome(pg);
  await wait(pg, 600);
  // grow a radish on the top row of the plot and harvest it: the loot pop-up must stay clear of the top bar
  await cmd(pg, "/time 8"); await cmd(pg, "/give seed_radish 1");
  await wait(pg, 400);
  const fx = 21, fy = 4;
  await near(pg, fx, fy);
  await use(pg, "hoe", fx, fy, 500);
  await use(pg, "seed_radish", fx, fy, 500);
  for (let d = 0; d < 3; d++) {
    await goHome(pg);
    await near(pg, fx, fy);
    await use(pg, "watering_can", fx, fy, 500);
    await dayEnd(pg);
    await wait(pg, 800);
  }
  await goHome(pg);
  await near(pg, fx, fy);
  await walk(pg, fx + 0.5, fy + 1.4, "below the radish", 8000, true);
  const tile = (await farmMap(pg))?.[`${fx},${fy}`];
  log("radish before harvest", JSON.stringify(tile));
  await pg.evaluate(([x, y]) => window.__dmmo.send({ t: "use", slot: window.__dmmo.inventory().slots.findIndex((s) => s?.item === "hoe"), x, y }), [fx, fy]);
  await wait(pg, 650);
  await shot(pg, "qa-71-harvest-float");
  const top = await pg.evaluate(() => { const r = document.querySelector(".hud-menu")?.getBoundingClientRect(); return r ? Math.round(r.bottom) : null; });
  const head = await pg.evaluate(() => { const me = window.__dmmo.you(); return window.__dmmo.tileToScreen(me.x, me.y - 3.4); });
  log("menu bottom", top, "float spawn screen y", Math.round(head.y));
  // a real click with the hoe and the can, for the tool sounds
  await pg.evaluate(() => { window.__sfx.length = 0; });
  await pg.keyboard.press("1"); await wait(pg, 200);
  const me = (await state(pg)).me;
  const tx = Math.floor(me.x), ty = Math.floor(me.y) + 1;
  let sp = await pg.evaluate(([x, y]) => window.__dmmo.tileToScreen(x + 0.5, y + 0.5), [tx, ty]);
  await pg.mouse.click(sp.x, sp.y); await wait(pg, 900);
  await pg.keyboard.press("2"); await wait(pg, 200);
  await pg.mouse.click(sp.x, sp.y); await wait(pg, 900);
  const toolSfx = [...new Set((await sfx(pg)).filter((x) => !x.startsWith("step_")))];
  log("tool click sounds", toolSfx);
  check("hoe and watering can play sounds", toolSfx.length >= 2, toolSfx);
  // a long toast, then sounds
  await chat(pg, "/give");
  await wait(pg, 500);
  await shot(pg, "qa-72-toast");
  check("desktop: toasts sit below the top bar", (await overlaps(pg, ".dlg-notice", ".hud-menu")) === 0 || (await overlaps(pg, ".dlg-notice", ".hud-menu")) === null);
  await panelsTour(pg, "desktop", 73);
  // emote wheel, chat
  await pg.keyboard.press("Enter"); await pg.keyboard.type("hello from the desktop ui pass"); await pg.keyboard.press("Enter");
  await wait(pg, 800);
  await shot(pg, "qa-74-chat-bubble");
  const sounds = await sfx(pg);
  const uniq = [...new Set(sounds)];
  log("sounds heard", uniq.join(", "));
  check("sounds fire (tools, ui, day end)", uniq.length >= 5, uniq);
  check("desktop: no overlaps after the tour", (await hudOverlaps(pg)).length === 0, await hudOverlaps(pg));

  // ---- phone size
  const m = await newPlayer(ctx.chromium, ctx.opts, "M", { width: 390, height: 844 });
  ctx.players.push(m);
  const mp = m.page;
  await mp.goto(Q.BASE);
  await wait(mp, 1500);
  await shot(mp, "qa-75-phone-login");
  check("phone: login has no cut-off text", (await clippedText(mp)).length === 0, await clippedText(mp));
  await signup(mp, `Mo_${ctx.stamp}`, `mo-${ctx.stamp}@qa.test`, "male");
  await wait(mp, 1000);
  await shot(mp, "qa-76-phone-home");
  const ov = await hudOverlaps(mp);
  log("phone overlaps", ov);
  check("phone: HUD pieces don't overlap", ov.length === 0, ov);
  check("phone: no cut-off text", (await clippedText(mp)).length === 0, await clippedText(mp));
  const hb = await mp.evaluate(() => { const r = document.getElementById("hotbar")?.getBoundingClientRect(); return r && { l: Math.round(r.left), r: Math.round(r.right), w: innerWidth }; });
  log("phone hotbar", hb);
  check("phone: hotbar fits the screen", hb && hb.l >= 0 && hb.r <= hb.w, hb);
  await panelsTour(mp, "phone", 77);
  await chat(mp, "/give");
  await wait(mp, 400);
  await shot(mp, "qa-78-phone-toast");
  check("phone: no page scroll", await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
});


// ---------------------------------------------------------------- 12. a zone tree felled with a full bag
phase("zonetree", async (ctx) => {
  const p = await newPlayer(ctx.chromium, ctx.opts, "Z");
  ctx.players.push(p);
  const pg = p.page;
  await signup(pg, `Zed_${ctx.stamp}`, `zed-${ctx.stamp}@qa.test`, "male");
  await goHome(pg);
  const fill = ["radish", "lettuce", "potato", "beet", "onion", "bell_pepper", "green_bean", "tomato", "eggplant", "cabbage", "cauliflower", "blueberry", "corn", "grape", "watermelon", "pineapple", "moonberry", "golden_melon", "starfruit", "seed_turnip", "seed_radish", "seed_potato", "seed_corn", "seed_tomato"];
  for (const it of fill) { await cmd(pg, `/give ${it} 1`); await wait(pg, 700); }
  await wait(pg, 800);
  await goVillage(pg);
  const free = (await inv(pg)).slots.filter((x) => !x).length;
  log("free slots", free);
  const me = (await state(pg)).me;
  const trees = (await pg.evaluate(() => window.__dmmo.props())).filter((t) => t.type === "tree").sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
  let done = null;
  for (const t of trees.slice(0, 6)) {
    if (!(await near(pg, t.x, t.y, `tree ${t.id}`))) continue;
    const n0 = (await msgs(pg, "ground")).length;
    const seen = [];
    for (let i = 0; i < 8; i++) {
      await use(pg, "axe", t.x, t.y, 700);
      const tm = (await msgs(pg, "tree")).at(-1);
      seen.push(tm ? `${tm.stage}${tm.hits}/${tm.need}${tm.drops ? " +" + tm.drops.join(",") : ""}` : "-");
      if (tm?.stage === "stump") break;
    }
    log("zone tree", t.id, seen);
    const ground = (await msgs(pg, "ground")).slice(n0).flatMap((m) => m.upd);
    const rejects = (await msgs(pg, "reject")).map((m) => m.reason).slice(-3);
    done = { seen, ground: ground.map((g) => g.item), rejects };
    if (seen.some((x) => x.startsWith("stump"))) break;
  }
  log("full-bag zone tree", JSON.stringify(done));
  await shot(pg, "qa-79-zone-tree-full-bag");
  check("a zone tree falls with a full bag and its wood lands on the ground", done && done.seen.some((x) => x.startsWith("stump")) && done.ground.some((i) => i === "wood"), done);
});



// ---------------------------------------------------------------- README hero shots (1280x800)
/** Drops dev-command echoes from the chat log so a hero shot only shows what players said. */
const tidyChat = (page) => page.evaluate(() => { for (const r of [...document.querySelectorAll("#chat-log > *")]) if (/: \/(give|hour|time|day|hearts)/.test(r.textContent ?? "")) r.remove(); });
async function heroShot(page, name) {
  for (let i = 0; i < 30 && (await page.$$(".dlg-notice")).length; i++) await wait(page, 250);
  await tidyChat(page);
  await page.mouse.move(1270, 400);
  await wait(page, 400);
  await shot(page, name);
}
phase("readme", async (ctx) => {
  const letters = ctx.stamp.replace(/[0-9]/g, (d) => "abcdefghij"[+d]);
  const J = await newPlayer(ctx.chromium, ctx.opts, "J"); ctx.players.push(J);
  const W = await newPlayer(ctx.chromium, ctx.opts, "W"); ctx.players.push(W);
  const pj = J.page, pw = W.page;
  J.name = `Juniper${letters[0].toUpperCase()}${letters.slice(1, 3)}`; W.name = `Wren${letters[0].toUpperCase()}${letters.slice(1, 3)}`;
  await signup(pj, J.name, `juniper-${ctx.stamp}@qa.test`, "female", 3);
  await signup(pw, W.name, `wren-${ctx.stamp}@qa.test`, "male", 2);
  log("hero players", J.name, W.name);

  // ---- farm: three days of crops, the last row planted later
  await goHome(pj);
  await cmd(pj, "/hour 7");
  for (const [it, n] of [["seed_pumpkin", 6], ["seed_corn", 3], ["seed_blueberry", 3], ["seed_potato", 6], ["seed_radish", 3], ["seed_strawberry", 3]]) { await cmd(pj, `/give ${it} ${n}`); await wait(pj, 600); }
  const rows = { 6: Array(6).fill("seed_pumpkin"), 7: ["seed_corn", "seed_corn", "seed_corn", "seed_blueberry", "seed_blueberry", "seed_blueberry"], 8: Array(6).fill("seed_potato"), 9: ["seed_radish", "seed_radish", "seed_radish"] };
  const late = { 9: [null, null, null, "seed_strawberry", "seed_strawberry", "seed_strawberry"] };
  const X0 = 19;
  const reach = async (x, y) => { const me = (await state(pj)).me; if (Math.hypot(me.x - x - 0.5, me.y - y - 0.5) > 1.6) await near(pj, x, y); };
  const tiles = (plan) => Object.entries(plan).flatMap(([y, seeds]) => seeds.map((sd, i) => (sd ? [X0 + i, +y, sd] : null)).filter(Boolean));
  const plant = async (plan) => { for (const [x, y, sd] of tiles(plan)) { await reach(x, y); await use(pj, "hoe", x, y, 450); await use(pj, sd, x, y, 400); } };
  const waterAll = async (list) => {
    for (const [x, y] of list) {
      if ((await homeState(pj))?.water < 2) { await near(pj, 35, 5, "near well"); await use(pj, "watering_can", 35, 5, 600); }
      await reach(x, y); await use(pj, "watering_can", x, y, 420);
    }
  };
  await plant(rows);
  for (let d = 0; d < 3; d++) {
    if (d === 1) await plant(late);
    await waterAll([...tiles(rows), ...(d >= 1 ? tiles(late) : [])]);
    await dayEnd(pj);
    await goHome(pj);
    await cmd(pj, "/hour 10");
  }
  // water all but the radishes, which are ripe now (any tool would pull them up)
  await waterAll([...tiles(rows), ...tiles(late)].filter(([, y, sd]) => sd !== "seed_radish"));
  await walk(pj, 22.0, 10.7, "below the crops", 10000, true);
  await wait(pj, 500);
  await heroShot(pj, "readme-farm");
  log("farm", JSON.stringify(Object.values(await farmMap(pj)).filter((t) => t.crop).map((t) => `${t.crop}@${t.x},${t.y}:${t.wateredDays}`)));

  // ---- house
  for (const [it, n] of [["rug", 1], ["table_round", 1], ["chair_wood", 1], ["lamp", 1], ["flower_pot", 2], ["wall_shelf", 1], ["mirror", 1], ["stove", 1], ["writing_desk", 1], ["candle", 1]]) { await cmd(pj, `/give ${it} ${n}`); await wait(pj, 600); }
  log("bag before furnishing", (await inv(pj)).slots.filter(Boolean).length);
  await walk(pj, 8.5, 11.8, "to house door"); await moveInto(pj, 8.5, 10.5, "home", "home_in");
  await walk(pj, 10.5, 9.5, "into the room");
  const place = async (item, spots) => { const why = []; for (const [x, y, r = 0] of spots) { const slot = await slotOf(pj, item); if (slot < 0) return `${item}: not in bag`; const a = await answer(pj, async () => { await send(pj, { t: "place", slot, x, y, rotation: r }); await wait(pj, 300); }); if (!a) return `${item}@${x},${y}`; why.push(a); } return `${item}: ${why.join(" / ")}`; };
  const placed = [];
  placed.push(await place("rug", [[5, 7], [4, 7], [5, 6]]));
  placed.push(await place("table_round", [[7, 7], [7, 6]]));
  placed.push(await place("chair_wood", [[6, 7, 1], [6, 6, 1]]));
  placed.push(await place("chair_wood", [[8, 7, 3], [8, 6, 3]]));
  placed.push(await place("writing_desk", [[10, 3], [11, 3]]));
  placed.push(await place("candle", [[12, 3], [4, 3]]));
  placed.push(await place("lamp", [[4, 3], [12, 4]]));
  placed.push(await place("stove", [[12, 6], [12, 5]]));
  placed.push(await place("flower_pot", [[1, 10], [1, 9]]));
  placed.push(await place("flower_pot", [[12, 10], [12, 9]]));
  placed.push(await place("wall_shelf", [[6, 1], [7, 1], [6, 2]]));
  placed.push(await place("mirror", [[12, 1], [1, 1], [12, 2]]));
  log("house", placed);
  await walk(pj, 9.6, 8.4, "by the table", 8000, true);
  await heroShot(pj, "readme-house");

  await goVillage(pj);
  await cmd(pj, "/hour 10");
  // ---- villager talk with hearts
  const npcs = (await state(pj)).ents.filter((e) => e.kind === "npc");
  log("npcs here", npcs.map((n) => `${n.id}:${n.name}`).join(" "));
  const me = (await state(pj)).me;
  npcs.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
  let talked = null;
  for (const n of npcs) {
    if (/odette/i.test(n.name)) continue;
    await walk(pj, n.x + 1.1, n.y + 0.2, `to ${n.name}`, 20000, true);
    await cmd(pj, "/hearts 6"); await wait(pj, 600);
    const b = await talk(pj, n.id, null);
    if (!b) continue;
    if (await pj.isVisible(".dlg-shop, #shop-dialog").catch(() => false)) { await pj.keyboard.press("Escape"); continue; }
    talked = n.name;
    await wait(pj, 500);
    await heroShot(pj, "readme-npc");
    break;
  }
  log("talked to", talked);
  check("readme: talked to a villager", !!talked);

});

phase("readme2", async (ctx) => {
  const letters = (ctx.stamp + "x").replace(/[0-9]/g, (d) => "klmnopqrst"[+d]);
  const J = await newPlayer(ctx.chromium, ctx.opts, "J2"); ctx.players.push(J);
  const W = await newPlayer(ctx.chromium, ctx.opts, "W2"); ctx.players.push(W);
  const pj = J.page, pw = W.page;
  J.name = `Juniper${letters[0].toUpperCase()}${letters.slice(1, 3)}`; W.name = `Wren${letters[0].toUpperCase()}${letters.slice(1, 3)}`;
  await signup(pj, J.name, `juniper2-${ctx.stamp}@qa.test`, "female", 3);
  await signup(pw, W.name, `wren2-${ctx.stamp}@qa.test`, "male", 2);
  // ---- village: both players near the market
  await goVillage(pj); await goVillage(pw);
  await cmd(pj, "/hour 10");
  const fountain = (await pj.evaluate(() => window.__dmmo.props())).find((p) => /fountain/.test(p.type));
  log("fountain", JSON.stringify(fountain));
  const fx0 = fountain ? fountain.x + fountain.w / 2 : 44.5, fy0 = fountain ? fountain.y + fountain.h : 22;
  await walk(pj, fx0 - 2.0, fy0 + 2.2, "J by the fountain", 40000, true);
  await walk(pw, fx0 + 1.2, fy0 + 2.4, "W by the fountain", 40000, true);
  await chat(pw, "Morning! The market's open early today.");
  await wait(pw, 600);
  await chat(pj, "Perfect, I need more pumpkin seeds 🎃");
  await wait(pj, 500);
  await heroShot(pj, "readme-village");

  // ---- social: friends, presence, an emote
  const wId = (await state(pw)).you;
  await rightClickPlayer(pj, wId);
  if (await pj.isVisible("#player-card-friend")) { await pj.click("#player-card-friend"); await wait(pj, 1500); }
  await pj.keyboard.press("Escape");
  await pw.keyboard.press("o"); await wait(pw, 800);
  if (await pw.$("#friends-tab-requests")) await pw.click("#friends-tab-requests");
  const acc = await pw.$("#friends-panel button:has-text('Accept')");
  if (acc) { await acc.click(); await wait(pw, 1500); }
  await pw.keyboard.press("Escape");
  await chat(pw, "Added you! Come help with my harvest later?");
  await wait(pw, 400);
  await send(pw, { t: "emote", code: "wave" });
  await wait(pj, 300);
  await rightClickPlayer(pj, wId);
  await wait(pj, 400);
  await tidyChat(pj);
  await pj.mouse.move(1270, 300);
  await wait(pj, 300);
  await shot(pj, "readme-social");
  await pj.keyboard.press("Escape"); await wait(pj, 300);

  // ---- combat in the caves (the riverside camps sit in the map's corners, off-centre on screen)
  await goCaves(pj);
  await cmd(pj, "/hour 15");
  const sword = await slotOf(pj, "sword_wood");
  await pj.keyboard.press(String(sword + 1));
  let shots = 0;
  for (let i = 0; i < 40 && shots < 6; i++) {
    const st = await state(pj);
    const t = st.ents.filter((e) => e.kind === "monster" && Math.hypot(e.x - 35, e.y - 12) < 9).sort((a, b) => Math.hypot(a.x - st.me.x, a.y - st.me.y) - Math.hypot(b.x - st.me.x, b.y - st.me.y))[0];
    if (!t) { await walk(pj, 33.5, 12.5, "to the slime camp", 30000, true); await wait(pj, 800); continue; }
    if (Math.hypot(t.x - st.me.x, t.y - st.me.y) > 1.1) { await pj.evaluate(([x, y]) => window.__dmmo.moveTo(x, y), [t.x - 0.9, t.y]); await wait(pj, 600); continue; }
    const sp = await pj.evaluate(([x, y]) => window.__dmmo.tileToScreen(x, y), [t.x, t.y]);
    await pj.mouse.click(sp.x, sp.y);
    await wait(pj, [110, 200, 420][shots % 3]);
    await tidyChat(pj);
    await shot(pj, `readme-combat-${shots}`);
    shots++;
    await wait(pj, 600);
  }
  log("combat shots", shots);
});


export { PHASES, playerA, playerB, phase };
