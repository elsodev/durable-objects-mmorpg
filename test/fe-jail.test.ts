import { describe, expect, it } from "vitest";
import { jailTimerText, localUntil } from "../src/client/ui/jail-timer-logic";
import { cardButtons } from "../src/client/ui/player-card-logic";
import { slashSuggestions, type SlashContext } from "../src/client/ui/slash-commands";
import { mapRows } from "../src/client/ui/map-pane-logic";

const T0 = Date.UTC(2026, 10, 2, 12);

describe("jail countdown", () => {
  it("shows the time left, then nothing once free", () => {
    expect(jailTimerText(T0 + 272_000, T0)).toBe("Released in 4:32");
    expect(jailTimerText(T0 + 5 * 60_000, T0)).toBe("Released in 5:00");
    expect(jailTimerText(T0, T0)).toBeNull();
    expect(jailTimerText(null, T0)).toBeNull();
  });

  it("moves the server's end onto this browser's clock", () => {
    // The browser runs 2 s behind the server: the sentence ends 2 s earlier on the local clock.
    expect(localUntil(T0 + 60_000, T0, T0 - 2000)).toBe(T0 + 58_000);
    expect(localUntil(null, T0, T0)).toBeNull();
  });
});

describe("Send to Jail on the player card", () => {
  const ctx = { viewerGuest: false, homeOwner: false };
  it("is offered to admins only, never on admins, guests or yourself", () => {
    expect(cardButtons({ self: false }, null, { ...ctx, admin: true })).toContain("jail");
    expect(cardButtons({ self: false }, null, ctx)).not.toContain("jail");
    expect(cardButtons({ self: false, admin: true }, null, { ...ctx, admin: true })).not.toContain("jail");
    expect(cardButtons({ self: true }, null, { ...ctx, admin: true })).toEqual([]);
    const guest = { guest: true } as Parameters<typeof cardButtons>[1];
    expect(cardButtons({ self: false }, guest, { ...ctx, admin: true })).toEqual(["mute", "kick"]);
  });

  it("lists /jail and /unjail for admins only", () => {
    const c: SlashContext = { atHome: false, homeOwner: false, guest: false, devTools: false };
    expect(slashSuggestions("/jai", { ...c, admin: true }).map((s) => s.label)).toEqual(["/jail"]);
    expect(slashSuggestions("/jai", c)).toEqual([]);
    expect(slashSuggestions("/unj", { ...c, admin: true })[0]!.label).toBe("/unjail");
  });
});

describe("the map", () => {
  it("has a Town Jail stop, and the station counts as the jail yard", () => {
    expect(mapRows("jail").find((r) => r.here)).toMatchObject({ id: "jail", name: "Town Jail" });
    expect(mapRows("int_police").find((r) => r.here)).toMatchObject({ id: "jail", inside: "the police station" });
    expect(mapRows("int_inn").find((r) => r.here)?.id).toBe("village");
  });
});
