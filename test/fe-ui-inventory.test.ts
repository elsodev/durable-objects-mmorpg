import { describe, expect, it } from "vitest";
import { fallbackIcon, iconFor, iconLetter, kindColor, setIconSource } from "../src/client/ui/icons";
import { formatCoins, tooltipInfo } from "../src/client/ui/inventory-format";

function decode(url: string): string {
  return decodeURIComponent(url.slice(url.indexOf(",") + 1));
}

describe("icons", () => {
  it("falls back to a lettered svg tile tinted by kind", () => {
    const url = iconFor("turnip");
    expect(url.startsWith("data:image/svg+xml")).toBe(true);
    const svg = decode(url);
    expect(svg).toContain(">T</text>");
    expect(svg).toContain(kindColor("turnip"));
    expect(kindColor("turnip")).not.toBe(kindColor("hoe"));
  });

  it("handles unknown items and escapes markup", () => {
    expect(iconLetter("zzz_unknown")).toBe("Z");
    expect(iconLetter("<&>")).toBe("?");
    expect(decode(fallbackIcon("<script>"))).not.toContain("<script>");
  });

  it("caches fallbacks", () => {
    expect(fallbackIcon("carrot")).toBe(fallbackIcon("carrot"));
  });

  it("uses the installed source, falling back on empty or throwing", () => {
    setIconSource((id) => (id === "hoe" ? "art://hoe" : id === "bad" ? (() => { throw new Error("x"); })() : ""));
    expect(iconFor("hoe")).toBe("art://hoe");
    expect(iconFor("turnip")).toBe(fallbackIcon("turnip"));
    expect(iconFor("bad")).toBe(fallbackIcon("bad"));
  });
});

describe("inventory helpers", () => {
  it("builds tooltip info from the catalog", () => {
    const t = tooltipInfo({ item: "seed_turnip", qty: 5 });
    expect(t.name).toBe("Turnip Seeds");
    expect(t.desc).toMatch(/turnip/i);
    expect(t.price).toBe("Sells for 5 coins");
    expect(tooltipInfo({ item: "hoe", qty: 1 }).price).toBe("Can't be sold");
    expect(tooltipInfo({ item: "mystery", qty: 1 }).name).toBe("mystery");
  });

  it("formats coins", () => {
    expect(formatCoins(1234.7)).toBe("1,234");
    expect(formatCoins(-3)).toBe("0");
  });
});
