import { describe, expect, it } from "vitest";
import { IDLE_TIMEOUT_MS, isPing } from "../src/worker/game/net";

describe("idle sockets can't keep a home awake", () => {
  it("pings are not input; anything else is", () => {
    expect(isPing(JSON.stringify({ t: "ping", at: 123456 }))).toBe(true);
    expect(isPing(JSON.stringify({ t: "move", dx: 1, dy: 0 }))).toBe(false);
    expect(isPing(JSON.stringify({ t: "chat", text: 'say "t":"ping" '.repeat(8) }))).toBe(false);
  });

  it("the idle limit is minutes, not hours", () => {
    expect(IDLE_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * 60_000);
    expect(IDLE_TIMEOUT_MS).toBeLessThanOrEqual(60 * 60_000);
  });
});
