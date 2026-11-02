import { describe, expect, it } from "vitest";
import { isFootStrike, strideFrame, strideRate } from "../src/client/render/dash-logic";

// Footsteps sound on the walk frames where a foot lands, so their rhythm follows the art.
function stepTimes(pace: "dash" | "tired" | undefined, ms: number, fps = 9, frames = 9): number[] {
  const out: number[] = [];
  let stride = 0;
  let last = -1;
  for (let t = 0; t < ms; t += 16) {
    stride += (16 * fps * strideRate(pace)) / 1000;
    const f = strideFrame(stride, frames, pace);
    if (f !== last && isFootStrike(f, frames)) out.push(t);
    last = f;
  }
  return out;
}

describe("footsteps follow the walk cycle", () => {
  it("two steps per walk cycle, faster when dashing, slower when tired", () => {
    const walk = stepTimes(undefined, 6000).length;
    const dash = stepTimes("dash", 6000).length;
    const tired = stepTimes("tired", 6000).length;
    expect(walk).toBeGreaterThanOrEqual(11);
    expect(walk).toBeLessThanOrEqual(13);
    expect(dash).toBeGreaterThan(walk * 1.5);
    expect(tired).toBeLessThan(walk * 0.6);
  });
});
