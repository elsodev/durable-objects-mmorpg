import { describe, expect, it } from "vitest";
import { createRooms, wsRequest } from "./do-harness";
import { H_ADMIN, H_GUEST, H_SESSION, H_SPAWN, H_USER_ID, H_USER_NAME, H_ZONE } from "../src/worker/env";
import { CLOSE_REMOVED, REMOVED_TEXT } from "../src/shared/admin";

async function connect(r: ReturnType<typeof createRooms>, userId: string, headers: Record<string, string>) {
  const res = await r.room(userId).fetch(
    wsRequest("http://localhost:8787/ws/home", {
      [H_USER_ID]: userId,
      [H_USER_NAME]: userId,
      [H_ZONE]: "home",
      [H_SPAWN]: "default",
      [H_GUEST]: "0",
      [H_SESSION]: `s-${userId}`,
      ...headers,
    }),
  );
  expect(res.status).toBe(101);
  return r.ctx(userId).sockets.at(-1)!;
}

describe("admins in a HomeRoom", () => {
  it("draws the halo flag only when the Worker said admin", async () => {
    const r = createRooms();
    const et = await connect(r, "et", { [H_ADMIN]: "1" });
    const me = et.last("welcome").entities.find((e: any) => e.id === "p:et");
    expect(me.admin).toBe(true);
    const bob = await connect(r, "bob", {});
    expect(bob.last("welcome").entities.find((e: any) => e.id === "p:bob").admin).toBeUndefined();
  });

  it("a guest's admin header is ignored", async () => {
    const r = createRooms();
    const g = await connect(r, "gus", { [H_ADMIN]: "1", [H_GUEST]: "1" });
    expect(g.last("welcome").entities.find((e: any) => e.id === "p:gus").admin).toBeUndefined();
  });

  it("removeUser closes the owner's socket with the removed code and ignores other users", async () => {
    const r = createRooms();
    const ws = await connect(r, "bob", {});
    expect(await r.room("bob").removeUser("someone-else", REMOVED_TEXT)).toBe(0);
    expect(ws.closed).toBeNull();
    expect(await r.room("bob").removeUser("bob", REMOVED_TEXT)).toBe(1);
    expect(ws.closed).toEqual({ code: CLOSE_REMOVED, reason: REMOVED_TEXT });
    expect(ws.of("notice").some((n: any) => n.text === REMOVED_TEXT)).toBe(true);
  });
});
