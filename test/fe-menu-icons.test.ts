import { describe, expect, it } from "vitest";
import { MENU_ICONS, MENU_ICON_PALETTE, MENU_ICON_SIZE, menuIconUrl, pixelIconSvg } from "../src/client/ui/menu-icons";

const names = Object.keys(MENU_ICONS) as (keyof typeof MENU_ICONS)[];

describe("menu icons", () => {
  it("has an icon for every top-menu button and audio control", () => {
    for (const n of ["bag", "goals", "friends", "hearts", "map", "options", "signout", "sound", "muted", "music", "sfx"]) {
      expect(names).toContain(n);
    }
  });

  it.each(names)("%s is a 16x16 grid of palette keys with an outline", (name) => {
    const grid = MENU_ICONS[name];
    expect(grid).toHaveLength(MENU_ICON_SIZE);
    for (const row of grid) {
      expect(row).toHaveLength(MENU_ICON_SIZE);
      for (const c of row) expect(c === "." || c in MENU_ICON_PALETTE).toBe(true);
    }
    const flat = grid.join("");
    expect(flat.includes("k")).toBe(true);
    // Drawn, not a blank tile: at least a fifth of the cells are painted.
    expect(flat.replace(/\./g, "").length).toBeGreaterThan(256 / 5);
  });

  it("builds crisp SVG with one path per colour", () => {
    const svg = pixelIconSvg(["k.r", "rrk"], { k: "#000000", r: "#ff0000" });
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('viewBox="0 0 3 2"');
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('<path fill="#ff0000" d="M2 0h1v1h-1zM0 1h2v1h-2z"/>');
  });

  it("skips unknown keys and transparent cells", () => {
    expect(pixelIconSvg(["..", ".x"], { k: "#000" })).not.toContain("<path");
  });

  it("returns a cached data URL", () => {
    const url = menuIconUrl("bag");
    expect(url.startsWith("data:image/svg+xml")).toBe(true);
    expect(menuIconUrl("bag")).toBe(url);
  });
});
