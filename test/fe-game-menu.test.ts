import { describe, expect, it } from "vitest";
import { CAVE_DEPTH_ZONES } from "../src/shared/types";
import { MENU_TABS, menuStep, restoreTab, type MenuState } from "../src/client/ui/game-menu-logic";
import { shortcutFor } from "../src/client/ui/hud-logic";
import { buildingName, isTravelId, ISLAND, mapRows, TRAVEL_COOLDOWN_MS, travelRefusal } from "../src/client/ui/map-pane-logic";
import { rowMarkers } from "../src/client/ui/bonds-logic";
import type { BondView } from "../src/shared/hearts";

const closed: MenuState = { open: false, tab: "bag" };

describe("game menu state", () => {
  it("has the five tabs in order", () => {
    expect([...MENU_TABS]).toEqual(["bag", "hearts", "friends", "map", "options"]);
  });

  it("a hotkey opens on its tab with the drawer sound, closes on a second press", () => {
    const a = menuStep(closed, { k: "toggle", tab: "hearts" });
    expect(a).toEqual({ state: { open: true, tab: "hearts" }, sound: "open" });
    const b = menuStep(a.state, { k: "toggle", tab: "hearts" });
    expect(b).toEqual({ state: { open: false, tab: "hearts" }, sound: "close" });
  });

  it("another tab's hotkey while open switches with the tab sound", () => {
    const open: MenuState = { open: true, tab: "bag" };
    expect(menuStep(open, { k: "toggle", tab: "map" })).toEqual({ state: { open: true, tab: "map" }, sound: "tab" });
    expect(menuStep(open, { k: "select", tab: "friends" })).toEqual({ state: { open: true, tab: "friends" }, sound: "tab" });
  });

  it("no-ops make no sound and keep the same state object", () => {
    const open: MenuState = { open: true, tab: "bag" };
    expect(menuStep(open, { k: "select", tab: "bag" }).state).toBe(open);
    expect(menuStep(open, { k: "select", tab: "bag" }).sound).toBeNull();
    expect(menuStep(closed, { k: "close" }).state).toBe(closed);
    expect(menuStep(closed, { k: "select", tab: "map" }).state).toBe(closed);
    expect(menuStep(closed, { k: "cycle", dir: 1 }).state).toBe(closed);
  });

  it("open remembers the last tab; cycle wraps", () => {
    expect(menuStep({ open: false, tab: "map" }, { k: "open" }).state).toEqual({ open: true, tab: "map" });
    expect(menuStep({ open: true, tab: "options" }, { k: "cycle", dir: 1 }).state.tab).toBe("bag");
    expect(menuStep({ open: true, tab: "bag" }, { k: "cycle", dir: -1 }).state.tab).toBe("options");
  });

  it("restores a stored tab, else the bag", () => {
    expect(restoreTab("friends")).toBe("friends");
    expect(restoreTab("nope")).toBe("bag");
    expect(restoreTab(null)).toBe("bag");
  });

  it("keeps the I and H hotkeys and adds M for the map", () => {
    expect(shortcutFor({ key: "i" }, false)).toBe("inventory");
    expect(shortcutFor({ key: "h" }, false)).toBe("bonds");
    expect(shortcutFor({ key: "M" }, false)).toBe("map");
    expect(shortcutFor({ key: "m" }, true)).toBeNull();
  });
});

describe("map tab", () => {
  it("marks where you are; buildings count as the village", () => {
    expect(mapRows("riverside").find((r) => r.here)?.id).toBe("riverside");
    expect(mapRows("quarry").find((r) => r.here)?.id).toBe("quarry");
    const inn = mapRows("int_inn").find((r) => r.here)!;
    expect(inn.id).toBe("village");
    expect(inn.inside).toBe("the inn");
    expect(buildingName("int_house_tess")).toBe("Tess's house");
    expect(mapRows(null).some((r) => r.here)).toBe(false);
  });

  it("puts every pin on the island picture, apart enough to click", () => {
    const rows = mapRows("village");
    for (const r of rows) {
      expect(r.pin.x).toBeGreaterThan(5);
      expect(r.pin.x).toBeLessThan(95);
      expect(r.pin.y).toBeGreaterThan(10);
      expect(r.pin.y).toBeLessThan(95);
    }
    for (const a of rows)
      for (const b of rows) if (a !== b) expect(Math.hypot((a.pin.x - b.pin.x) * ISLAND.w, (a.pin.y - b.pin.y) * ISLAND.h) / 100).toBeGreaterThan(14);
  });

  it("fast travel: anywhere but where you are, once per cooldown", () => {
    expect(travelRefusal("caves", "village", 10_000, 0)).toBeNull();
    expect(travelRefusal("village", "village", 10_000, 0)).toBe("You are already here.");
    expect(travelRefusal("village", "int_inn", 10_000, 0)).toBeNull();
    expect(travelRefusal("home", "village", 1000, 0)).toBe("Just a moment.");
    expect(travelRefusal("home", "village", TRAVEL_COOLDOWN_MS, 0)).toBeNull();
    expect(travelRefusal("home", null, 10_000, 0)).not.toBeNull();
    expect(isTravelId("quarry")).toBe(true);
    expect(isTravelId("int_inn")).toBe(false);
  });
});

describe("relationship row markers", () => {
  const v = (o: Partial<BondView>): BondView => ({ npc: "rue", name: "Rue", hearts: 3, into: 0, need: 10, talkLeft: 50, pending: 0, ...o });
  it("talked today, gifts this week, birthday", () => {
    const m = rowMarkers(v({ talkedToday: true, giftsToday: 1, giftsWeek: 1, birthday: "Summer 17", birthdayToday: false }));
    expect(m.map((x) => [x.key, x.on])).toEqual([
      ["talked", true],
      ["gift", true],
      ["birthday", false],
    ]);
    expect(m[1]!.text).toContain("1/2");
    expect(m[2]!.text).toContain("Summer 17");
    const today = rowMarkers(v({ birthday: "Summer 17", birthdayToday: true }));
    expect(today[2]!.on).toBe(true);
    expect(today[0]!.on).toBe(false);
    expect(rowMarkers(v({})).length).toBe(2);
  });
});

describe("map tab in the deeper caves", () => {
  it("pins every cave level on the caves, naming the depth", () => {
    for (const z of CAVE_DEPTH_ZONES) {
      const here = mapRows(z).filter((r) => r.here);
      expect(here.map((r) => r.id)).toEqual(["caves"]);
      expect(here[0]!.inside).toBe(`depth ${z.split("_")[1]}`);
    }
  });

  it("fast travel only goes to the cave entrance, never a deeper floor", () => {
    for (const z of CAVE_DEPTH_ZONES) expect(isTravelId(z)).toBe(false);
    // From a deep floor, travelling to the caves is allowed (it takes you to the entrance).
    expect(travelRefusal("caves", "caves_4_top", 10_000, 0)).toBeNull();
  });
});
