// Client side of the house: mailbox flag/panel logic and door hints on the home maps.
import { describe, expect, it } from "vitest";
import { ago, expiresIn, flagUp, requestKey } from "../src/client/ui/mailbox-logic";
import { doorHintAt } from "../src/client/render/door-hint";
import { getMap } from "../src/shared/maps";

const T0 = 1_700_000_000_000;
const HOME_OUT = getMap("home");
const HOME_IN = getMap("home_in");
const door = HOME_OUT.exits.find((e) => e.map === "home_in")!;
const doorIn = HOME_IN.exits[0]!;

describe("mailbox and house doors (client)", () => {
  it("client flag logic", () => {
    const req = { userId: "u1", name: "Ann", at: 5 };
    expect(flagUp(0, [req], new Set())).toBe(true);
    expect(flagUp(0, [req], new Set([requestKey(req)]))).toBe(false);
    expect(flagUp(1, [], new Set())).toBe(true);
    expect(ago(T0 - 90_000, T0)).toBe("1m ago");
    expect(expiresIn(T0 + 240_000, T0)).toBe("expires in 4m");
    expect(expiresIn(T0, T0)).toBe("expired");
  });
  it("door hints name the house and the yard", () => {
    expect(doorHintAt(HOME_OUT, { x: door.x + 0.5, y: door.y + 1.5 })?.text).toBe("Enter House");
    expect(doorHintAt(HOME_IN, { x: doorIn.x + 0.5, y: doorIn.y - 0.5 })?.text).toBe("Exit to Yard");
  });
});
