import { describe, expect, it } from "vitest";
import { sanitizeName, stripIdentityHeaders } from "../src/worker/http/util";
import { isSafeFileKey, readCapped, sniffImage } from "../src/worker/http/sniff";
import { parseWsZone, zoneAllowed } from "../src/worker/http/zone-route";
import { GUEST_IDLE_MS, isIdleGuest, parseDbDate } from "../src/worker/cron";
import { devToolsEnabled } from "../src/worker/env";

function streamOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(new Uint8Array(ch));
      c.close();
    },
  });
}

describe("ws routing", () => {
  it("parses only known zones", () => {
    expect(parseWsZone("/ws/village")).toBe("village");
    expect(parseWsZone("/ws/home/")).toBe("home");
    expect(parseWsZone("/ws/castle")).toBeNull();
    expect(parseWsZone("/ws/village/x")).toBeNull();
    expect(parseWsZone("/ws/constructor")).toBeNull();
  });
  it("lets guests only into home", () => {
    expect(zoneAllowed("home", true)).toBe(true);
    for (const z of ["village", "riverside", "caves", "quarry"] as const) {
      expect(zoneAllowed(z, true)).toBe(false);
      expect(zoneAllowed(z, false)).toBe(true);
    }
  });
  it("strips client identity headers", () => {
    const h = new Headers({ "X-DMMO-User-Id": "evil", "x-dmmo-guest": "0", cookie: "a=b", upgrade: "websocket" });
    const out = stripIdentityHeaders(h);
    expect(out.get("x-dmmo-user-id")).toBeNull();
    expect(out.get("x-dmmo-guest")).toBeNull();
    expect(out.get("cookie")).toBe("a=b");
    expect(out.get("upgrade")).toBe("websocket");
  });
});

describe("sanitizeName", () => {
  it("cleans and caps names", () => {
    expect(sanitizeName("  Old   Tom ")).toBe("Old Tom");
    expect(sanitizeName("a\u0000b‮c")).toBe("abc");
    expect(sanitizeName("x".repeat(100))).toHaveLength(24);
    expect(sanitizeName("   ")).toBe("Farmer");
    expect(sanitizeName(42, "Guest")).toBe("Guest");
  });
});

describe("uploads", () => {
  it("sniffs PNG and WebP only", () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe("image/png");
    const webp = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];
    expect(sniffImage(new Uint8Array(webp))?.ext).toBe("webp");
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
  it("caps body size", async () => {
    expect(await readCapped(streamOf([1, 2], [3]), 3)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await readCapped(streamOf([1, 2], [3, 4]), 3)).toBeNull();
  });
  it("accepts only safe file keys", () => {
    expect(isSafeFileKey("lpc/catalog.json")).toBe(true);
    expect(isSafeFileKey("uploads/abc/1234-5678.png")).toBe(true);
    for (const k of ["", "../x", "a/../b", "a//b", "/a", ".hidden", "a b.png", "a\\b"]) expect(isSafeFileKey(k)).toBe(false);
  });
});

describe("guest cleanup", () => {
  const now = Date.UTC(2026, 10, 1);
  it("parses D1 date formats", () => {
    expect(parseDbDate("2026-10-01T00:00:00.000Z")).toBe(Date.UTC(2026, 9, 1));
    expect(parseDbDate("2026-10-01 00:00:00")).toBe(Date.UTC(2026, 9, 1));
    expect(parseDbDate(Date.UTC(2026, 9, 1))).toBe(Date.UTC(2026, 9, 1));
    expect(parseDbDate(Date.UTC(2026, 9, 1) / 1000)).toBe(Date.UTC(2026, 9, 1));
    expect(parseDbDate("garbage")).toBeNull();
  });
  it("uses the latest activity and fails safe on unknown dates", () => {
    const old = new Date(now - GUEST_IDLE_MS - 1000).toISOString();
    const recent = new Date(now - 1000).toISOString();
    expect(isIdleGuest([old], now)).toBe(true);
    expect(isIdleGuest([old, recent], now)).toBe(false);
    expect(isIdleGuest([old, "???"], now)).toBe(false);
  });
});

describe("devToolsEnabled", () => {
  it("needs DEV_TOOLS on AND scripted NPCs (the local env), so production never gets test commands", () => {
    expect(devToolsEnabled({ DEV_TOOLS: "on", NPC_AI_MODE: "off" })).toBe(true);
    expect(devToolsEnabled({ DEV_TOOLS: "on", NPC_AI_MODE: "on" })).toBe(false);
    expect(devToolsEnabled({ DEV_TOOLS: "on" })).toBe(false);
    expect(devToolsEnabled({ NPC_AI_MODE: "off" })).toBe(false);
  });
});
