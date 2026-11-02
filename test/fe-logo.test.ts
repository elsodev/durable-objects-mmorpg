import { describe, expect, it } from "vitest";
import { LOGO_PALETTE, buildLogo } from "../src/client/ui/logo-pixels";

describe("Mossbrook logo pixels", () => {
  const logo = buildLogo();

  it("fits the start card at 2x on a 360 px phone", () => {
    // Card content is 360 - 2 * 16 (screen padding) - 2 * 14 (card padding) = 300 px.
    expect(logo.w * 2).toBeLessThanOrEqual(300);
    expect(logo.px.length).toBe(logo.w * logo.h);
  });

  it("uses only palette colours and leaves the border clear for the halo", () => {
    for (const v of logo.px) expect(v).toBeLessThan(LOGO_PALETTE.length);
    for (let x = 0; x < logo.w; x++) {
      expect(logo.px[x]).not.toBe(1);
      expect(logo.px[(logo.h - 1) * logo.w + x]).not.toBe(1);
    }
  });

  it("is deterministic", () => {
    expect(Array.from(buildLogo().px)).toEqual(Array.from(logo.px));
  });

  it("draws both halves of the name: moss greens and brook blues", () => {
    const used = new Set(logo.px);
    expect(used.has(7)).toBe(true);
    expect(used.has(12)).toBe(true);
  });
});
