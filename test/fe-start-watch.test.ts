import { afterEach, describe, expect, it, vi } from "vitest";
import { START_TIMEOUT_MS, startStatusText, watchStart } from "../src/client/game/start-watch";

/** Just enough DOM for watchStart (tests run in node). */
function fakeDom() {
  const made: { id: string; textContent: string; removed: boolean; style: object; setAttribute(): void; remove(): void }[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const el = { id: "", textContent: "", removed: false, style: {}, setAttribute() {}, remove() { el.removed = true; } };
      made.push(el);
      return el;
    },
  });
  const root = { children: [] as unknown[], appendChild(c: unknown) { this.children.push(c); } };
  return { made, root };
}

describe("start-up watchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("says what it's waiting on, and logs it, when start-up takes too long", () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { made, root } = fakeDom();
    const w = watchStart(root as never);
    vi.advanceTimersByTime(START_TIMEOUT_MS - 1);
    expect(made).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(made[0]!.id).toBe("dmmo-start-status");
    expect(made[0]!.textContent).toBe(startStatusText("renderer"));
    expect(err).toHaveBeenCalledOnce();
    w.stage("connection");
    expect(made[0]!.textContent).toBe(startStatusText("connection"));
    w.done();
    expect(made[0]!.removed).toBe(true);
  });

  it("shows nothing when the game is ready in time", () => {
    vi.useFakeTimers();
    const { made, root } = fakeDom();
    const w = watchStart(root as never);
    w.stage("connection");
    w.done();
    vi.advanceTimersByTime(START_TIMEOUT_MS * 2);
    expect(made).toHaveLength(0);
  });
});
