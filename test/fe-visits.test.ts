import { describe, expect, it, vi } from "vitest";
import { homeCommandRequest, mergeInvites } from "../src/client/ui/visits-logic";
import { runHomeCommand } from "../src/client/ui/visits-api";
import { probeUrl, wsUrl } from "../src/client/net/url";
import { parseHomeCommand } from "../src/shared/visits";

const T0 = 1_700_000_000_000;

describe("home visit client helpers", () => {
  it("parses home commands", () => {
    expect(parseHomeCommand("/invite Basil")).toEqual({ cmd: "invite", name: "Basil" });
    expect(parseHomeCommand("/KICK  basil ")).toEqual({ cmd: "kick", name: "basil" });
    expect(parseHomeCommand("/uninvite")).toEqual({ cmd: "uninvite", name: "" });
    expect(parseHomeCommand("/invitee x")).toBeNull();
    expect(parseHomeCommand("hello /invite x")).toBeNull();
    expect(homeCommandRequest("invite", "Basil")).toEqual({ ok: true, path: "/api/home/invite", body: { name: "Basil" } });
    expect(homeCommandRequest("kick", "")).toMatchObject({ ok: false });
  });

  it("merges invites: dedupes by sender, drops expired and malformed ones", () => {
    const q = mergeInvites(
      [{ fromId: "a", fromName: "A", expiresAt: T0 + 5 }],
      [
        { fromId: "a", fromName: "A", expiresAt: T0 + 50 },
        { fromId: "b", fromName: "B", expiresAt: T0 - 1 },
        { fromId: "<x>", fromName: "X", expiresAt: T0 + 50 },
        { t: "invite" },
      ],
      T0,
    );
    expect(q).toEqual([{ fromId: "a", fromName: "A", expiresAt: T0 + 50 }]);
  });

  it("visit sockets use /ws/visit/<ownerId> and never carry a spawn", () => {
    const loc = { protocol: "https:", host: "a.b" };
    expect(wsUrl(loc, "home", "default", "alice")).toBe("wss://a.b/ws/visit/alice");
    expect(probeUrl(loc, "home", "alice")).toBe("https://a.b/ws/visit/alice");
    expect(wsUrl(loc, "village", "from_home")).toBe("wss://a.b/ws/village?spawn=from_home");
  });

  it("runs /invite over HTTP and reports the result", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ status: "invited", user: { userId: "basil", name: "Basil" }, expiresAt: 1 }), { status: 201 });
    });
    const notes: string[] = [];
    await runHomeCommand("invite", "basil", (t) => notes.push(t));
    await runHomeCommand("kick", "", (t) => notes.push(t));
    vi.unstubAllGlobals();
    expect(calls).toEqual([{ url: "/api/home/invite", body: JSON.stringify({ name: "basil" }) }]);
    expect(notes[0]).toMatch(/Invited Basil/);
    expect(notes[1]).toMatch(/Usage: \/kick name/);
  });
});
