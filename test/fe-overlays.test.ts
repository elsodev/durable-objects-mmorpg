import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import {
  animateStatus,
  bubbleAlpha,
  createOverlays,
  sanitizeText,
  showHpBar,
  tagColor,
  TAG_COLORS,
  wrapText,
} from "../src/client/render/overlays";
import type { Layers } from "../src/client/contracts";

describe("wrapText", () => {
  it("wraps on word boundaries within 28 chars", () => {
    const lines = wrapText("The river is running high today, mind the stepping stones near the mill");
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) expect(Array.from(l).length).toBeLessThanOrEqual(28);
    expect(lines[0]).toBe("The river is running high");
  });
  it("hard-splits long words", () => {
    expect(wrapText("a".repeat(60), 28, 5)).toEqual(["a".repeat(28), "a".repeat(28), "aaaa"]);
  });
  it("caps at 3 lines with an ellipsis", () => {
    const lines = wrapText("word ".repeat(80));
    expect(lines).toHaveLength(3);
    expect(lines[2].endsWith("…")).toBe(true);
    expect(Array.from(lines[2]).length).toBeLessThanOrEqual(28);
  });
  it("returns nothing for blank input", () => {
    expect(wrapText("   \n\t ")).toEqual([]);
  });
});

describe("sanitizeText", () => {
  it("removes control chars and collapses whitespace", () => {
    expect(sanitizeText("hi\u0000\n\n there‮")).toBe("hi there");
  });
  it("caps length", () => {
    expect(sanitizeText("x".repeat(500), 10)).toBe("x".repeat(10));
  });
});

describe("bubbleAlpha", () => {
  it("is opaque, then fades, then gone", () => {
    expect(bubbleAlpha(0)).toBe(1);
    expect(bubbleAlpha(4000)).toBe(1);
    expect(bubbleAlpha(4700)).toBeCloseTo(0.5, 5);
    expect(bubbleAlpha(5000)).toBe(0);
  });
});

describe("animateStatus", () => {
  it("cycles dots", () => {
    expect(animateStatus("...", 0)).toBe(".");
    expect(animateStatus("...", 350)).toBe("..");
    expect(animateStatus("...", 700)).toBe("...");
    expect(animateStatus("thinking…", 1050)).toBe("thinking.");
  });
  it("leaves other statuses alone", () => {
    expect(animateStatus("busy", 123)).toBe("busy");
  });
});

describe("tags and hp", () => {
  it("colors you, players, npcs differently", () => {
    expect(tagColor({ id: "p:1", kind: "player" }, "p:1")).toBe(TAG_COLORS.you);
    expect(tagColor({ id: "p:2", kind: "player" }, "p:1")).toBe(TAG_COLORS.player);
    expect(tagColor({ id: "n:smith", kind: "npc" }, "p:1")).toBe(TAG_COLORS.npc);
  });
  it("shows hp for monsters and for you only when hurt", () => {
    expect(showHpBar({ id: "m:1", kind: "monster", hp: 5, maxHp: 5 }, "p:1")).toBe(true);
    expect(showHpBar({ id: "p:1", kind: "player", hp: 10, maxHp: 10 }, "p:1")).toBe(false);
    expect(showHpBar({ id: "p:1", kind: "player", hp: 7, maxHp: 10 }, "p:1")).toBe(true);
    expect(showHpBar({ id: "p:2", kind: "player", hp: 7, maxHp: 10 }, "p:1")).toBe(false);
    expect(showHpBar({ id: "m:1", kind: "monster" }, "p:1")).toBe(false);
  });
});

describe("createOverlays (scene graph)", () => {
  it("creates and removes per-entity views", () => {
    const overlay = new Container();
    const layers = { overlay } as unknown as Layers;
    const o = createOverlays(layers);
    expect(overlay.children).toHaveLength(2);
    const [tags, bubbles] = overlay.children as Container[];
    const e = { id: "n:smith", kind: "npc" as const, name: "Bram", sprite: "smith", x: 1, y: 1, facing: "down" as const, moving: false };
    try {
      o.say("n:smith", "Hello there");
      o.sync([e], () => ({ x: 100, y: 50 }), "p:1");
    } catch (err) {
      // Text measurement needs a canvas; skip this check in a DOM-less test runner.
      if (String(err).match(/canvas|document|OffscreenCanvas|getContext/i)) return;
      throw err;
    }
    expect(tags.children).toHaveLength(1);
    expect(bubbles.children[0].visible).toBe(true);
    o.sync([], () => null, "p:1");
    expect(tags.children).toHaveLength(0);
    o.destroy();
    expect(overlay.children).toHaveLength(0);
  });
});
