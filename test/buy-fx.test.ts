import { describe, expect, it } from "vitest";
import { BUY_FX_WAIT_MS, spentOnBuy } from "../src/client/ui/buy-fx-logic";

describe("shop buy feedback", () => {
  const pending = { total: 60, coinsBefore: 200, at: 1000 };
  it("shows the coins actually taken once the server's new wallet arrives", () => {
    expect(spentOnBuy(pending, 140, 1200)).toBe(60);
  });
  it("stays quiet on a reject (wallet unchanged) or with nothing pending", () => {
    expect(spentOnBuy(pending, 200, 1200)).toBe(0);
    expect(spentOnBuy(null, 100, 1200)).toBe(0);
  });
  it("ignores a late wallet change that must be from something else", () => {
    expect(spentOnBuy(pending, 140, 1000 + BUY_FX_WAIT_MS + 1)).toBe(0);
  });
  it("ignores coins going up", () => {
    expect(spentOnBuy(pending, 260, 1100)).toBe(0);
  });
});
