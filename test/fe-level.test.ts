import { describe, expect, it } from "vitest";
import { barSteps, fillOf, gainText, levelTitle, xpText } from "../src/client/ui/level-badge-logic";
import { LEVELUP_LIFE, levelUpFrame, levelUpLines, SIGN_FROM } from "../src/client/render/levelup-fx-logic";
import { KILL_FLOAT_DELAY_MS, KILL_FLOAT_DROP, LEVELUP_HEAR_TILES, levelUpHeard, xpFloat } from "../src/client/game/level-fx-logic";
import { createLevelFx } from "../src/client/game/level-fx";
import { cardLevel } from "../src/client/ui/player-card-logic";
import { playerHit } from "../src/client/game/player-hit";
import { LEVEL_CAP } from "../src/shared/leveling";

describe("level badge logic", () => {
  it("words the XP and the tooltip, and shows the cap", () => {
    expect(xpText({ level: 3, xp: 1200, next: 1450 })).toBe("1,200 / 1,450 XP");
    expect(xpText({ level: LEVEL_CAP, xp: 0, next: 0 })).toBe("Max level");
    expect(levelTitle({ level: 3, xp: 45, next: 145 })).toMatch(/^Level 3: 100 XP to level 4\./);
    expect(levelTitle({ level: LEVEL_CAP, xp: 0, next: 0 })).toBe(`Level ${LEVEL_CAP} (max)`);
    expect(gainText(8)).toBe("+8 XP");
    expect(gainText(0)).toBeNull();
    expect(gainText(undefined)).toBeNull();
  });

  it("fills to the right fraction", () => {
    expect(fillOf({ level: 2, xp: 38, next: 76 })).toBe(0.5);
    expect(fillOf({ level: LEVEL_CAP, xp: 0, next: 0 })).toBe(1);
    expect(fillOf({ level: 2, xp: 500, next: 76 })).toBe(1);
  });

  it("slides on a gain, runs to full and refills on a level-up, snaps when first shown or reduced", () => {
    const a = { level: 2, xp: 10, next: 76 };
    const b = { level: 2, xp: 48, next: 76 };
    const up = { level: 3, xp: 29, next: 145 };
    expect(barSteps(null, a, false)).toEqual([{ to: 10 / 76, animate: false }]);
    expect(barSteps(a, b, false)).toEqual([{ to: 48 / 76, animate: true }]);
    expect(barSteps(b, up, false)).toEqual([
      { to: 1, animate: true },
      { to: 0, animate: false },
      { to: 0.2, animate: true },
    ]);
    expect(barSteps(b, up, true)).toEqual([{ to: 0.2, animate: false }]);
    // The jail penalty drops the bar in one move.
    expect(barSteps(b, { level: 2, xp: 0, next: 76 }, false)).toEqual([{ to: 0, animate: true }]);
  });
});

describe("level-up burst timeline", () => {
  it("the sign rises off the head and fades out by the end", () => {
    const start = levelUpFrame(0.05, false);
    const mid = levelUpFrame(0.5, false);
    const late = levelUpFrame(0.9, false);
    const end = levelUpFrame(1, false);
    expect(mid.sign.dy).toBeLessThan(start.sign.dy);
    expect(late.sign.dy).toBeLessThan(mid.sign.dy);
    expect(mid.sign.alpha).toBe(1);
    expect(late.sign.alpha).toBeLessThan(1);
    expect(end.sign.alpha).toBe(0);
    expect(start.rings[0]!.alpha).toBeGreaterThan(0);
    expect(end.rings.every((r) => r.alpha === 0)).toBe(true);
    expect(LEVELUP_LIFE).toBeGreaterThan(1.5);
  });

  it("reduced motion keeps the sign still and drops the rings", () => {
    const f = levelUpFrame(0.5, true);
    expect(f.rings).toEqual([]);
    expect(f.sign).toEqual({ dy: SIGN_FROM, alpha: 1, scale: 1 });
  });

  it("names the new level", () => {
    expect(levelUpLines(7)).toEqual(["LEVEL UP!", "Lv 7"]);
    expect(levelUpLines(Number.NaN)).toEqual(["LEVEL UP!", "Lv 1"]);
  });
});

describe("level fx", () => {
  const base = { t: "xp" as const, level: 2, xp: 5, next: 76 };

  it("floats kill XP where the monster fell, a beat after the hit; sales over your head", () => {
    expect(xpFloat({ ...base, gain: 8, reason: "kill", at: { x: 10, y: 4 } }, null)).toEqual({
      at: { x: 10, y: 4 + KILL_FLOAT_DROP },
      text: "+8 XP",
      delayMs: KILL_FLOAT_DELAY_MS,
    });
    expect(xpFloat({ ...base, gain: 30, reason: "sell" }, { x: 3, y: 3 })).toMatchObject({ text: "+30 XP", delayMs: 0 });
    expect(xpFloat(base, { x: 3, y: 3 })).toBeNull();
    expect(xpFloat({ ...base, reason: "jail", lost: 40 }, { x: 3, y: 3 })).toBeNull();
    expect(xpFloat({ ...base, gain: 8, reason: "kill" }, { x: 3, y: 3 })).toBeNull();
  });

  it("your own level-up always chimes, someone else's only nearby", () => {
    expect(levelUpHeard(true, { x: 100, y: 100 }, { x: 0, y: 0 })).toBe(true);
    expect(levelUpHeard(false, { x: LEVELUP_HEAR_TILES - 1, y: 0 }, { x: 0, y: 0 })).toBe(true);
    expect(levelUpHeard(false, { x: LEVELUP_HEAR_TILES + 1, y: 0 }, { x: 0, y: 0 })).toBe(false);
    expect(levelUpHeard(false, { x: 0, y: 0 }, null)).toBe(false);
  });

  it("updates the HUD, floats the gain and plays the burst over whoever levelled", () => {
    const calls: string[] = [];
    let followed: (() => unknown) | null = null;
    const world: any = {
      effects: {
        floatText: (_at: unknown, text: string, kind: string) => calls.push(`float ${text} ${kind}`),
        levelUp: (follow: () => unknown, level: number) => {
          followed = follow;
          calls.push(`burst ${level}`);
        },
      },
    };
    let other: { x: number; y: number } | undefined = { x: 5, y: 2 };
    const fx = createLevelFx({
      world: () => world,
      hud: { setLevel: (v, gain) => calls.push(`hud ${v.level} ${v.xp}/${v.next} ${gain ?? "-"}`) },
      youId: () => "p:me",
      you: () => ({ id: "p:me", kind: "player", name: "Me", sprite: "a", x: 1, y: 1, facing: "down", moving: false }),
      drawnAt: () => other,
      playSfx: (k) => calls.push(`sfx ${k}`),
      reducedMotion: () => false,
      later: (fn) => fn(),
    });
    fx.onXp({ ...base, gain: 8, reason: "kill", at: { x: 4, y: 4 } });
    fx.onLevelUp({ t: "levelUp", id: "p:other", level: 3 });
    expect(calls).toEqual(["hud 2 5/76 8", "float +8 XP xp", "burst 3", "sfx level_up"]);
    // The burst follows them, and stops once they are gone.
    expect(followed!()).toEqual({ x: 5, y: 2 });
    other = undefined;
    expect(followed!()).toBeNull();
  });
});

describe("level on the player card", () => {
  it("prefers the card's number, falls back to the world's, else shows none", () => {
    expect(cardLevel({ level: 3 }, { level: 9 } as any)).toBe("Lv 9");
    expect(cardLevel({ level: 3 }, null)).toBe("Lv 3");
    expect(cardLevel({}, {} as any)).toBeNull();
    expect(cardLevel(null, null)).toBeNull();
  });

  it("the right-click hit carries the level the world shows", () => {
    expect(playerHit("p:u1", { kind: "player", name: "Ann", level: 4 }, null)).toMatchObject({ level: 4 });
    expect(playerHit("p:u1", { kind: "player", name: "Ann" }, null)?.level).toBeUndefined();
  });
});
