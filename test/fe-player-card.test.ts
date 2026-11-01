// Client side of the player card and mutes: right-click hit test, card buttons/rows/placement, and
// the mute filter that hides zone chat, bubbles, world chat and emotes.
import { describe, expect, it } from "vitest";
import { playerHit, tileDistance } from "../src/client/game/player-hit";
import { hitScore, profileFor } from "../src/client/render/entityProfile";
import {
  CARD_LEAVE_TILES,
  cardButtons,
  friendButton,
  joinedLabel,
  placeCard,
  presenceLine,
  shouldCloseForDistance,
  statRows,
} from "../src/client/ui/player-card-logic";
import { MuteSet } from "../src/client/ui/mute-logic";
import type { PlayerCard } from "../src/shared/players";
import { userIdOfEntity } from "../src/shared/players";
import type { EntityState } from "../src/shared/types";

const ent = (id: string, kind: EntityState["kind"], x: number, y: number, name = "Bob"): EntityState => ({
  id,
  kind,
  name,
  sprite: kind === "player" ? "player_1" : "slime",
  x,
  y,
  facing: "down",
  moving: false,
});

/** Same rule as EntityLayer.entityAt: best hitScore wins. */
function entityAt(states: EntityState[], tile: { x: number; y: number }): string | null {
  let best: string | null = null;
  let score = Infinity;
  for (const s of states) {
    const v = hitScore(s, profileFor(s.sprite), tile);
    if (v >= 0 && v < score) {
      score = v;
      best = s.id;
    }
  }
  return best;
}

const fullCard = (over: Partial<PlayerCard> = {}): PlayerCard => ({
  userId: "bob",
  name: "Bob",
  self: false,
  guest: false,
  minimal: false,
  online: true,
  zone: "village",
  joined: "2026-03-04",
  homeDay: 12,
  stats: { cropsHarvested: 1234, monstersDefeated: 5, oresMined: 0 },
  friendship: "none",
  muted: false,
  ...over,
});

describe("right-click hit test", () => {
  const world = [ent("p:bob", "player", 10.5, 10.9), ent("n:mara", "npc", 14.5, 10.9, "Mara"), ent("p:me", "player", 20.5, 10.9, "Me")];
  const lookup = (id: string | null) => world.find((e) => e.id === id);

  it("finds the player whose sprite is under the pointer, not just the tile at their feet", () => {
    const head = { x: 10.5, y: 10.9 - 1.2 }; // a tile above the feet: still their sprite
    const id = entityAt(world, head);
    expect(playerHit(id, lookup(id), "p:me")).toEqual({ entityId: "p:bob", userId: "bob", name: "Bob", self: false });
  });

  it("ignores NPCs, monsters and empty ground", () => {
    const npc = entityAt(world, { x: 14.5, y: 10.5 });
    expect(npc).toBe("n:mara");
    expect(playerHit(npc, lookup(npc), "p:me")).toBeNull();
    expect(playerHit(entityAt(world, { x: 3, y: 3 }), undefined, "p:me")).toBeNull();
    expect(playerHit("m:1", { kind: "monster", name: "Slime" }, "p:me")).toBeNull();
  });

  it("flags your own sprite as self", () => {
    const id = entityAt(world, { x: 20.5, y: 10.5 });
    expect(playerHit(id, lookup(id), "p:me")).toMatchObject({ userId: "me", self: true });
  });

  it("only player entity ids map to user ids", () => {
    expect(userIdOfEntity("p:abc")).toBe("abc");
    expect(userIdOfEntity("n:abc")).toBeNull();
    expect(userIdOfEntity("p:")).toBeNull();
  });

  it("closes the card when the player walks away or leaves view", () => {
    expect(tileDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(shouldCloseForDistance(2)).toBe(false);
    expect(shouldCloseForDistance(CARD_LEAVE_TILES + 0.1)).toBe(true);
    expect(shouldCloseForDistance(null)).toBe(true);
  });
});

describe("player card", () => {
  const ctx = { viewerGuest: false, homeOwner: false };

  it("your own card has no action buttons", () => {
    expect(cardButtons({ self: true }, fullCard({ self: true, friendship: "self" }), ctx)).toEqual([]);
  });

  it("offers Invite home only to an owner at home", () => {
    expect(cardButtons({ self: false }, fullCard(), ctx)).toEqual(["friend", "whisper", "mute"]);
    expect(cardButtons({ self: false }, fullCard(), { ...ctx, homeOwner: true })).toEqual(["friend", "whisper", "invite", "mute"]);
  });

  it("guests see no buttons; a guest can only be muted", () => {
    expect(cardButtons({ self: false }, fullCard(), { ...ctx, viewerGuest: true })).toEqual([]);
    expect(cardButtons({ self: false }, fullCard({ guest: true, minimal: true }), ctx)).toEqual(["mute"]);
  });

  it("labels the friend button by relation", () => {
    expect(friendButton("none")).toMatchObject({ label: "Add friend", action: "add", disabled: false });
    expect(friendButton("outgoing")).toMatchObject({ label: "Request sent", disabled: true });
    expect(friendButton("friends")).toMatchObject({ label: "Friends ✓", action: "remove" });
    expect(friendButton("incoming").action).toBe("accept");
  });

  it("lists stats, and none on minimal cards", () => {
    const rows = Object.fromEntries(statRows(fullCard()));
    expect(rows).toMatchObject({
      Joined: "Mar 4, 2026",
      "Home day": "12",
      "Crops harvested": "1,234",
      "Monsters defeated": "5",
      "Ores mined": "0",
      Friendship: "Not friends yet",
    });
    expect(statRows(fullCard({ minimal: true }))).toEqual([]);
    expect(statRows(null)).toEqual([]);
    expect(joinedLabel(null)).toBe("—");
  });

  it("presence line", () => {
    expect(presenceLine(fullCard())).toBe("Village");
    expect(presenceLine(fullCard({ zone: null }))).toBe("Online");
    expect(presenceLine(fullCard({ online: false, zone: null }))).toBe("Offline");
    expect(presenceLine(fullCard({ minimal: true, guest: true }))).toBe("Guest");
  });

  it("stays on screen near the cursor", () => {
    expect(placeCard(100, 100, 240, 200, 1280, 720)).toEqual({ left: 112, top: 112 });
    const corner = placeCard(1270, 710, 240, 200, 1280, 720);
    expect(corner.left + 240).toBeLessThanOrEqual(1272);
    expect(corner.top + 200).toBeLessThanOrEqual(712);
    expect(placeCard(5, 5, 400, 200, 300, 300).left).toBe(8);
  });
});

describe("mute filter", () => {
  const m = MuteSet.from([{ userId: "bob", name: "Bob" }]);

  it("hides zone chat, bubbles and emotes by entity id", () => {
    expect(m.hidesEntity("p:bob")).toBe(true);
    expect(m.hidesEntity("p:carol")).toBe(false);
    // NPC lines and system lines are never muted.
    expect(m.hidesEntity("n:bob")).toBe(false);
    expect(m.hidesEntity("")).toBe(false);
  });

  it("hides world chat and whispers by name, ignoring case", () => {
    expect(m.hasName("bob")).toBe(true);
    expect(m.hasName("BOB")).toBe(true);
    expect(m.hasName("Bobby")).toBe(false);
    expect(m.hasName("")).toBe(false);
  });

  it("unmute shows them again; /unmute finds the id by name", () => {
    const s = MuteSet.from([
      { userId: "bob", name: "Bob" },
      { userId: "gus", name: "Gus" },
    ]);
    expect(s.idByName("gus")).toBe("gus");
    s.remove("bob");
    expect(s.hidesEntity("p:bob")).toBe(false);
    expect(s.hasName("Bob")).toBe(false);
    expect(s.size).toBe(1);
  });
});
