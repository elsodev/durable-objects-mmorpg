import { describe, expect, it } from "vitest";
import { arrowAt, createNameFlash, itemTipText, itemTitle, placeTip, pressMoved, type Timers } from "../src/client/ui/item-tip-logic";
import { getItem, ITEMS } from "../src/shared/items";

describe("item tooltip text", () => {
  it("names the item, with the count only for a stack", () => {
    expect(itemTitle("seed_turnip", 10)).toBe("Turnip Seeds ×10");
    expect(itemTitle("hoe", 1)).toBe("Hoe");
    expect(itemTitle("mystery", 3)).toBe("mystery ×3");
  });

  it("labels tools", () => {
    const t = itemTipText("hoe", 1);
    expect(t.detail).toBe("Tool");
    expect(t.desc).toBe(getItem("hoe")?.desc ?? null);
  });

  it("gives seeds their crop and days instead of the flavour text", () => {
    const seed = getItem("seed_turnip")!;
    const crop = getItem(seed.grows!.crop)!.name;
    const t = itemTipText("seed_turnip", 4);
    expect(t.detail).toBe(`Grows ${crop} in ${seed.grows!.days} days`);
    expect(t.desc).toBeNull();
  });

  it("mentions regrowth", () => {
    const seed = Object.values(ITEMS).find((d) => d.grows?.regrow)!;
    expect(seed).toBeDefined();
    expect(itemTipText(seed.id, 1).detail).toMatch(/, then every \d+ days?$/);
  });

  it("shows the sell value, singular for one coin", () => {
    const turnip = getItem("turnip")!;
    expect(itemTipText("turnip", 1).detail).toBe(`Sells for ${turnip.sell} coins`);
    expect(itemTipText("stone", 1).detail).toBe(`Sells for ${getItem("stone")!.sell} coin${getItem("stone")!.sell === 1 ? "" : "s"}`);
  });

  it("has no extra lines for an unknown item", () => {
    expect(itemTipText("mystery", 1)).toEqual({ title: "mystery", desc: null, detail: null });
  });
});

describe("tooltip placement", () => {
  const view = { width: 400, height: 800 };
  const tip = { width: 160, height: 60 };

  it("centres above the anchor", () => {
    const p = placeTip({ left: 180, top: 700, width: 40, height: 40 }, tip, view, 8, 8);
    expect(p).toEqual({ left: 120, top: 632, side: "above" });
  });

  it("slides inside the left and right edges", () => {
    expect(placeTip({ left: 0, top: 700, width: 40, height: 40 }, tip, view, 8, 8).left).toBe(8);
    expect(placeTip({ left: 380, top: 700, width: 20, height: 40 }, tip, view, 8, 8).left).toBe(400 - 8 - 160);
  });

  it("flips below when there's no room on top, and stays on screen", () => {
    const p = placeTip({ left: 100, top: 20, width: 40, height: 40 }, tip, view, 8, 8);
    expect(p.side).toBe("below");
    expect(p.top).toBe(68);
    const tall = placeTip({ left: 100, top: 20, width: 40, height: 780 }, tip, view, 8, 8);
    expect(tall.top).toBe(800 - 8 - 60);
  });

  it("pins to the margin when the tip is wider than the screen", () => {
    expect(placeTip({ left: 10, top: 500, width: 40, height: 40 }, { width: 500, height: 40 }, view).left).toBe(8);
  });

  it("aims the pointer at the anchor but off the corners", () => {
    expect(arrowAt(80, 160)).toBe(80);
    expect(arrowAt(-30, 160)).toBe(12);
    expect(arrowAt(400, 160)).toBe(148);
  });

  it("a small wobble is still a long-press", () => {
    expect(pressMoved(3, 4)).toBe(false);
    expect(pressMoved(9, 9)).toBe(true);
  });
});

describe("name flash", () => {
  function fakeTimers() {
    let now = 0;
    let next = 1;
    const queue = new Map<number, { at: number; fn: () => void }>();
    const timers: Timers = {
      set(fn, ms) {
        const id = next++;
        queue.set(id, { at: now + ms, fn });
        return id;
      },
      clear(h) {
        queue.delete(h as number);
      },
    };
    const advance = (ms: number) => {
      const end = now + ms;
      for (;;) {
        const due = [...queue.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        queue.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    };
    return { timers, advance, pending: () => queue.size };
  }

  function setup() {
    const log: string[] = [];
    const t = fakeTimers();
    const flash = createNameFlash(
      { show: (s) => log.push(`show ${s}`), fade: () => log.push("fade"), hide: () => log.push("hide") },
      t.timers,
      2000,
      300,
    );
    return { log, flash, ...t };
  }

  it("shows for two seconds, then fades and hides", () => {
    const { log, flash, advance, pending } = setup();
    flash.flash("Hoe");
    expect(log).toEqual(["show Hoe"]);
    advance(1999);
    expect(log).toEqual(["show Hoe"]);
    advance(1);
    expect(log).toEqual(["show Hoe", "fade"]);
    advance(300);
    expect(log).toEqual(["show Hoe", "fade", "hide"]);
    expect(pending()).toBe(0);
  });

  it("a new pick restarts the timer, even mid-fade", () => {
    const { log, flash, advance } = setup();
    flash.flash("Hoe");
    advance(1500);
    flash.flash("Axe");
    advance(1900);
    expect(log).toEqual(["show Hoe", "show Axe"]);
    advance(100);
    expect(log.at(-1)).toBe("fade");
    advance(100);
    flash.flash("Hoe");
    advance(1000);
    expect(log.slice(-2)).toEqual(["fade", "show Hoe"]);
    advance(1300);
    expect(log.slice(-2)).toEqual(["fade", "hide"]);
  });

  it("an empty slot clears it at once", () => {
    const { log, flash, advance, pending } = setup();
    flash.flash("Hoe");
    flash.flash(null);
    expect(log).toEqual(["show Hoe", "hide"]);
    expect(pending()).toBe(0);
    advance(5000);
    expect(log).toEqual(["show Hoe", "hide"]);
  });
});
