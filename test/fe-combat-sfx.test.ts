import { describe, expect, it } from "vitest";
import { AGGRO_COOLDOWN_MS, createCombatSfx } from "../src/client/game/combat-sfx";
import type { EntityState } from "../src/shared/types";

const mon = (over: Partial<EntityState> = {}): EntityState =>
  ({ id: "m:1", kind: "monster", name: "Slime", sprite: "slime", x: 10, y: 10, facing: "down", moving: false, hp: 10, maxHp: 10, ...over }) as EntityState;
const me = (over: Partial<EntityState> = {}): EntityState =>
  ({ id: "p:me", kind: "player", name: "Me", sprite: "player_1", x: 7, y: 10, facing: "right", moving: false, hp: 10, maxHp: 10, ...over }) as EntityState;

function setup() {
  const played: string[] = [];
  // rand = 0.99 keeps idle noises far apart so they don't interfere.
  const sfx = createCombatSfx((k) => played.push(k), () => 0.99);
  return { played, sfx };
}

describe("combat sfx", () => {
  it("plays hit + monster hurt on an hp drop and the death sound once", () => {
    const { played, sfx } = setup();
    sfx.onTick([mon(), me()], [], "p:me", 0);
    sfx.onTick([mon({ hp: 6 })], [], "p:me", 100);
    expect(played).toEqual(["sword_hit", "slime_hurt"]);
    played.length = 0;
    sfx.onTick([mon({ hp: 0 })], [], "p:me", 200);
    sfx.onTick([], ["m:1"], "p:me", 300);
    expect(played).toEqual(["slime_die"]);
  });

  it("treats a monster removed right after a hit as dead, but not one that just left", () => {
    const { played, sfx } = setup();
    sfx.onTick([mon(), mon({ id: "m:2", sprite: "bat" })], [], "p:me", 0);
    sfx.onTick([mon({ hp: 3 })], [], "p:me", 100);
    played.length = 0;
    sfx.onTick([], ["m:1", "m:2"], "p:me", 500);
    expect(played).toEqual(["slime_die"]);
  });

  it("player hurt plays the nearest monster's attack, and faint at 0 hp", () => {
    const { played, sfx } = setup();
    sfx.onTick([me()], [], "p:me", 0);
    sfx.frame([mon({ x: 8 })], { x: 7, y: 10 }, 0);
    played.length = 0;
    sfx.onTick([me({ hp: 7 })], [], "p:me", 100);
    expect(played).toEqual(["player_hurt", "slime_attack"]);
    played.length = 0;
    sfx.onTick([me({ hp: 0 })], [], "p:me", 200);
    expect(played[0]).toBe("player_faint");
  });

  it("aggro plays when a nearby monster starts approaching, throttled per monster", () => {
    const { played, sfx } = setup();
    const you = { x: 0, y: 0 };
    sfx.frame([mon({ x: 4, y: 0 })], you, 0);
    played.length = 0;
    sfx.frame([mon({ x: 3.8, y: 0, moving: true })], you, 100);
    expect(played).toEqual(["slime_aggro"]);
    sfx.frame([mon({ x: 3.8, y: 0, moving: false })], you, 200);
    sfx.frame([mon({ x: 3.6, y: 0, moving: true })], you, 300);
    expect(played).toEqual(["slime_aggro"]);
    sfx.frame([mon({ x: 3.6, y: 0, moving: false })], you, AGGRO_COOLDOWN_MS + 400);
    sfx.frame([mon({ x: 3.4, y: 0, moving: true })], you, AGGRO_COOLDOWN_MS + 500);
    expect(played.filter((k) => k === "slime_aggro")).toHaveLength(2);
  });

  it("a swing with nothing there is a miss", () => {
    const { played, sfx } = setup();
    sfx.swing({ x: 3, y: 3 }, [mon()]);
    sfx.swing({ x: 10, y: 10 }, [mon()]);
    expect(played).toEqual(["sword_miss", "tool_sword"]);
  });
});
