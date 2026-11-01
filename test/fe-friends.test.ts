import { afterEach, describe, expect, it, vi } from "vitest";
import { addNameError, badgeText, inviteCommand, whisperPrefill, zoneLabel } from "../src/client/ui/friends-logic";
import { emitSocial, onSocial } from "../src/client/social-events";
import { friendsApi } from "../src/client/ui/friends-api";
import { shortcutFor } from "../src/client/ui/hud-logic";
import { FRIEND_NAME_HINT } from "../src/shared/friends";

describe("friends panel helpers", () => {
  it("labels zones only for online friends", () => {
    expect(zoneLabel(false, "village")).toBe("Offline");
    expect(zoneLabel(true, null)).toBe("Online");
    expect(zoneLabel(true, "caves")).toBe("Caves");
    expect(zoneLabel(true, "home")).toBe("At home");
    expect(zoneLabel(true, "lighthouse")).toBe("Lighthouse");
  });
  it("validates the add-friend name like the server", () => {
    expect(addNameError("")).toMatch(/Type/);
    expect(addNameError("ab")).toBe(FRIEND_NAME_HINT);
    expect(addNameError("no spaces")).toBe(FRIEND_NAME_HINT);
    expect(addNameError("  Bob_1 ")).toBeNull();
  });
  it("badge text", () => {
    expect(badgeText(0)).toBe("");
    expect(badgeText(3)).toBe("3");
    expect(badgeText(150)).toBe("99+");
    expect(badgeText(Number.NaN)).toBe("");
  });
  it("chat commands for whisper and invite", () => {
    expect(whisperPrefill("Bob")).toBe("/w Bob ");
    expect(inviteCommand("Bob")).toBe("/invite Bob");
  });
  it("O toggles friends, not while typing", () => {
    expect(shortcutFor({ key: "o" }, false)).toBe("friends");
    expect(shortcutFor({ key: "O" }, false)).toBe("friends");
    expect(shortcutFor({ key: "o" }, true)).toBeNull();
    expect(shortcutFor({ key: "o", ctrlKey: true }, false)).toBeNull();
  });
});

describe("social event bus", () => {
  it("routes by type and to * listeners, and unsubscribes", () => {
    const got: string[] = [];
    const off = onSocial("friendRequest", (p) => got.push(`req:${String(p.fromName)}`));
    const offAll = onSocial("*", (p) => got.push(`all:${p.t}`));
    emitSocial({ t: "friendRequest", fromId: "a", fromName: "Ann" });
    emitSocial({ t: "chat" });
    off();
    emitSocial({ t: "friendRequest", fromName: "Ann" });
    offAll();
    emitSocial({ t: "friendRequest" });
    expect(got).toEqual(["req:Ann", "all:friendRequest", "all:chat", "all:friendRequest"]);
  });
  it("ignores junk and survives a throwing handler", () => {
    const seen: unknown[] = [];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = onSocial("x", () => {
      throw new Error("boom");
    });
    const b = onSocial("x", (p) => seen.push(p));
    for (const junk of [null, 1, "x", {}, { t: 3 }, { t: "*" }]) emitSocial(junk);
    emitSocial({ t: "x" });
    a();
    b();
    err.mockRestore();
    expect(seen).toEqual([{ t: "x" }]);
  });
});

describe("friends API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends JSON and returns data", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "requested", user: { userId: "b", name: "Bob" } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await friendsApi.request("Bob");
    expect(r).toEqual({ ok: true, data: { status: "requested", user: { userId: "b", name: "Bob" } } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/friends/request");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "Bob" }));
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });
  it("encodes ids in DELETE paths", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await friendsApi.remove("a/b");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/friends/a%2Fb");
  });
  it("turns errors into messages and never throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "No player named Zed." }), { status: 404 })));
    expect(await friendsApi.request("Zed")).toEqual({ ok: false, status: 404, error: "No player named Zed." });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 500 })));
    expect(await friendsApi.list()).toEqual({ ok: false, status: 500, error: "Something went wrong (500)." });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("offline");
    }));
    expect(await friendsApi.list()).toMatchObject({ ok: false, status: 0 });
  });
});
