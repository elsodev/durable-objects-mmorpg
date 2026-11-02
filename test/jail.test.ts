import { describe, expect, it } from "vitest";
import {
  cleanJailUntil,
  cleanStrikes,
  formatJailLeft,
  isJailed,
  jailEndsAt,
  jailLeftMs,
  jailPlacement,
  jailedText,
  minutesLabel,
  nextInsult,
  parseJailMinutes,
  CELL_SPAWN,
  RELEASE_SPAWN,
} from "../src/shared/jail";
import { getMap } from "../src/shared/maps";
import { buildCollision, exitAt, findPath } from "../src/shared/engine";
import { POLICE_CELL } from "../src/shared/maps/interiors/police";
import { NORTH_EXIT } from "../src/shared/maps/jailyard";
import { JAIL_EXIT } from "../src/shared/maps/quarry";
import { arrestLine, buildInsultRequest, interpretInsult, isInsult, ruleInsult, warningLine } from "../src/worker/npc/sheriff";
import type { JevClient } from "../src/worker/npc/jev";
import { getNpc } from "../src/worker/npc/catalog";
import { NPC_BIBLE, NPC_BIRTHDAYS, NPC_IDS } from "../src/worker/npc/bible";
import { NPC_TIPS } from "../src/worker/npc/tipTables";
import { npcPresent } from "../src/shared/npcSchedule";
import { TRAVEL_ZONES } from "../src/shared/travel";

const T0 = Date.UTC(2026, 10, 2, 12);

describe("jail time", () => {
  it("defaults to 5 minutes and accepts whole minutes 1..1440 only", () => {
    for (const raw of [undefined, null, ""]) expect(parseJailMinutes(raw)).toBe(5);
    expect(parseJailMinutes(1)).toBe(1);
    expect(parseJailMinutes(1440)).toBe(1440);
    expect(parseJailMinutes(" 30 ")).toBe(30);
    for (const bad of [0, -1, 1.5, 1441, NaN, Infinity, "5m", "abc", "99999", {}, [5], true]) expect(parseJailMinutes(bad), String(bad)).toBeNull();
  });

  it("ends the sentence on time and counts down to zero", () => {
    const until = jailEndsAt(T0, 5);
    expect(until).toBe(T0 + 300_000);
    expect(isJailed(until, T0)).toBe(true);
    expect(isJailed(until, until - 1)).toBe(true);
    expect(isJailed(until, until)).toBe(false);
    expect(isJailed(undefined, T0)).toBe(false);
    expect(isJailed(NaN, T0)).toBe(false);
    expect(jailLeftMs(until, T0 + 28_000)).toBe(272_000);
    expect(jailLeftMs(until, until + 5)).toBe(0);
    expect(formatJailLeft(272_000)).toBe("4:32");
    expect(formatJailLeft(271_001)).toBe("4:32"); // rounded up: never shows 0:00 while still inside
    expect(formatJailLeft(3_723_000)).toBe("1:02:03");
    expect(formatJailLeft(0)).toBe("0:00");
  });

  it("cleans stored sentences so a bad value can't lock anyone up for ever", () => {
    expect(cleanJailUntil(T0 + 60_000, T0)).toBe(T0 + 60_000);
    expect(cleanJailUntil(T0 + 1e12, T0)).toBe(T0 + 1440 * 60_000);
    for (const bad of [undefined, "x", -5, 0, NaN, Infinity]) expect(cleanJailUntil(bad, T0)).toBeUndefined();
  });

  it("words the sentence", () => {
    expect(minutesLabel(1)).toBe("1 minute");
    expect(minutesLabel(5)).toBe("5 minutes");
    expect(minutesLabel(60)).toBe("1 hour");
    expect(minutesLabel(90)).toBe("1 hour 30 minutes");
    expect(jailedText(5, false)).toBe("You've been sent to jail for 5 minutes.");
    expect(jailedText(5, true)).toMatch(/sheriff locks you in the cell for 5 minutes/);
  });
});

describe("the cell", () => {
  const map = getMap("int_police");
  const grid = buildCollision(map);
  const cell = map.spawns[CELL_SPAWN]!;
  const out = map.spawns[RELEASE_SPAWN]!;
  const door = map.exits[0]!;

  it("puts the cell spawn inside the cell and the release spot outside it", () => {
    expect(jailPlacement(true, cell, POLICE_CELL)).toBeNull();
    expect(jailPlacement(false, out, POLICE_CELL)).toBeNull();
    expect(jailPlacement(true, out, POLICE_CELL)).toBe("cell");
    expect(jailPlacement(false, cell, POLICE_CELL)).toBe("release");
    expect(jailPlacement(true, map.spawns.default!, POLICE_CELL)).toBe("cell");
  });

  it("is sealed: nobody walks in or out through the bars", () => {
    expect(findPath(grid, cell, { x: door.x + 0.5, y: door.y + 0.5 })).toBeNull();
    expect(findPath(grid, map.spawns.default!, cell)).toBeNull();
    // ...but the release spot is a short walk from the way out.
    expect(findPath(grid, out, { x: door.x + 0.5, y: door.y + 0.5 })).not.toBeNull();
  });

  it("lets visitors stand right by the bars to talk to whoever is inside", () => {
    const front = { x: cell.x, y: POLICE_CELL.y + POLICE_CELL.h + 1.5 };
    expect(findPath(grid, map.spawns.default!, front)).not.toBeNull();
    expect(Math.abs(front.y - cell.y)).toBeLessThan(4);
  });
});

describe("the jail yard", () => {
  const yard = getMap("jail");
  const quarry = getMap("quarry");

  it("lies south of the quarry, joined by matching exits both ways", () => {
    const down = quarry.exits.find((e) => e.to === "jail")!;
    expect(down).toMatchObject(JAIL_EXIT);
    expect(down.y).toBe(quarry.height - 1);
    expect(down.spawn).toBe("from_quarry");
    expect(yard.spawns.from_quarry).toBeDefined();
    const up = yard.exits.find((e) => e.to === "quarry")!;
    expect(up).toMatchObject(NORTH_EXIT);
    expect(up.y).toBe(0);
    expect(up.spawn).toBe("from_jail");
    expect(quarry.spawns.from_jail).toBeDefined();
  });

  it("walks from the quarry road to the station door", () => {
    const grid = buildCollision(yard);
    const door = yard.exits.find((e) => e.to === "int_police")!;
    expect(findPath(grid, yard.spawns.from_quarry!, { x: door.x + 0.5, y: door.y + 0.5 })).not.toBeNull();
    expect(exitAt(yard, door.x + 0.5, door.y + 0.5)?.spawn).toBe("from_jail");
    const qgrid = buildCollision(quarry);
    expect(findPath(qgrid, quarry.spawns.default!, { x: JAIL_EXIT.x + 0.5, y: JAIL_EXIT.y + 0.5 })).not.toBeNull();
  });

  it("is a travel stop with no monsters", () => {
    expect(TRAVEL_ZONES).toContain("jail");
    expect(yard.monsters).toEqual([]);
  });
});

describe("the sheriff's patience", () => {
  it("warns three times, jails on the fourth insult and starts again from zero", () => {
    let strikes = 0;
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = nextInsult(strikes);
      seen.push(r.jail ? "jail" : `warn${r.warning}`);
      strikes = r.strikes;
    }
    expect(seen).toEqual(["warn1", "warn2", "warn3", "jail", "warn1", "warn2", "warn3", "jail"]);
    expect(nextInsult(99)).toEqual({ strikes: 0, warning: 0, jail: true });
    expect(nextInsult(-4)).toEqual({ strikes: 1, warning: 1, jail: false });
    expect(cleanStrikes(2)).toBe(2);
    for (const bad of [undefined, -1, 1.5, "2"]) expect(cleanStrikes(bad)).toBe(0);
    expect(cleanStrikes(50)).toBe(3);
  });

  it("the word list catches insults aimed at him and lets everything else go", () => {
    for (const t of ["you idiot", "idiot!", "Sheriff, you're useless", "shut up", "you suck", "you are a clown", "worst sheriff ever"]) expect(ruleInsult(t), t).toBe(true);
    for (const t of ["hello sheriff", "where is the quarry?", "this rock is stupid and heavy to carry", "can I visit my friend in the cell", "I'm a fool for strawberries today honestly", ""])
      expect(ruleInsult(t), t).toBe(false);
  });

  it("only a confident 'insult' from Jev counts", () => {
    expect(interpretInsult({ verdict: { choice: "insult", confidence: 0.9 } })).toBe(true);
    expect(interpretInsult({ verdict: { choice: "insult", confidence: 0.5 } })).toBe(false);
    expect(interpretInsult({ verdict: { choice: "insult" } })).toBe(false);
    expect(interpretInsult({ verdict: { choice: "not_insult", confidence: 1 } })).toBe(false);
    expect(interpretInsult({ verdict: { choice: "jail_them", confidence: 1 } })).toBeNull();
    expect(interpretInsult(null)).toBeNull();
    expect(interpretInsult({})).toBeNull();
  });

  it("asks Jev only to classify, caps the player's text, and falls back to the word list", async () => {
    const req = buildInsultRequest({ playerName: "Ann", text: "x".repeat(5000) });
    expect(String((req.state as any).playerMessage).length).toBeLessThanOrEqual(500);
    expect(Object.keys(req.questions)).toEqual(["verdict"]);
    const says = (answers: unknown): JevClient => ({ systemOne: async () => ({ answers }) });
    const broken: JevClient = { systemOne: async () => { throw new Error("down"); } };
    expect(await isInsult({ playerName: "Ann", text: "you're lovely" }, says({ verdict: { choice: "insult", confidence: 0.95 } }))).toBe(true);
    expect(await isInsult({ playerName: "Ann", text: "you idiot" }, says({ verdict: { choice: "not_insult", confidence: 0.9 } }))).toBe(false);
    expect(await isInsult({ playerName: "Ann", text: "you idiot" }, broken)).toBe(true);
    expect(await isInsult({ playerName: "Ann", text: "hello" }, broken)).toBe(false);
    expect(await isInsult({ playerName: "Ann", text: "you idiot" }, null)).toBe(true);
  });

  it("speaks his warnings and the arrest in his own words", () => {
    expect(warningLine(1, "Ann")).toMatch(/Ann/);
    expect(warningLine(3, "Ann")).toMatch(/one more|next one/i);
    expect(arrestLine("Ann")).toMatch(/cell/i);
  });
});

describe("the sheriff", () => {
  it("is in the catalog and bible, lives in the police station and is always there", () => {
    const s = getNpc("sheriff")!;
    expect(s.zone).toBe("int_police");
    expect(s.name).toBe("Hollis");
    expect(NPC_IDS).toContain("sheriff");
    expect(NPC_BIBLE.sheriff.routine.home).toBe("police");
    expect(NPC_TIPS.sheriff.length).toBeGreaterThanOrEqual(6);
    expect(getMap("int_police").npcs.map((n) => n.npcId)).toEqual(["sheriff"]);
    for (let h = 0; h < 24; h++) expect(npcPresent("sheriff", "int_police", h)).toBe(true);
    const days = Object.values(NPC_BIRTHDAYS).map((b) => `${b.season}-${b.day}`);
    expect(new Set(days).size).toBe(days.length);
  });
});
