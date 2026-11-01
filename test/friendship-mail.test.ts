import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectOwner, createRooms, type Rooms } from "./do-harness";

const T0 = Date.UTC(2026, 10, 1, 9);
let r: Rooms;
beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  r = createRooms();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("villager gifts by mail", () => {
  it("puts furniture that didn't fit into a mailbox parcel with a letter, and tells the owner if home", async () => {
    const ws = await connectOwner(r, "alice", "Alice");
    const room = r.room("alice") as any;
    expect(await room.mailGift("alice", "Rue", ["barrel", "turnip", "candle"])).toBe(true);
    expect(room.mail.parcels).toEqual([
      { item: "barrel", qty: 1 },
      { item: "candle", qty: 1 },
    ]);
    expect(room.mail.notes.at(-1).text).toMatch(/^Rue wanted you to have this.*Barrel, Candle/);
    expect(ws.last("mail").parcels).toHaveLength(2);
    // Nothing placeable: nothing posted.
    expect(await room.mailGift("alice", "Rue", ["turnip"])).toBe(false);
  });

  it("only takes gifts for the home's owner", async () => {
    await connectOwner(r, "alice", "Alice");
    const room = r.room("alice") as any;
    await expect(room.mailGift("mallory", "Rue", ["barrel"])).rejects.toThrow();
    expect(room.mail.parcels).toEqual([]);
  });
});
