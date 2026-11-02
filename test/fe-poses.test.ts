import { describe, expect, it } from "vitest";
import catalog from "../src/client/public/assets/lpc/catalog.json";
import { breathAt, HIP_Y, LIE, MEDITATE, MOTE_LIFE_MS, moteAt, puddleAt, puddleOffset, streamPlacement, ZZZ_LIFE_MS, zzzAt } from "../src/client/render/pose-logic";
import { SLASH_COMMANDS } from "../src/client/ui/slash-commands";
import { PEE_MS, PUDDLE_MS } from "../src/shared/poses";

describe("pose drawing", () => {
  it("lays the body on its tile, head west, with the quilt over the body and pillow under the head", () => {
    expect(LIE.rotation).toBeCloseTo(-Math.PI / 2);
    expect(LIE.pillow.x).toBeLessThan(LIE.quilt.x);
    expect(LIE.zzz.y).toBeLessThan(LIE.body.y);
  });

  it("Z's rise and fade, then go", () => {
    const a = zzzAt(0, 0)!;
    const b = zzzAt(ZZZ_LIFE_MS * 0.9, 0)!;
    expect(b.dy).toBeLessThan(a.dy);
    expect(b.alpha).toBeLessThan(a.alpha);
    expect(b.frame).toBeGreaterThanOrEqual(a.frame);
    expect(zzzAt(ZZZ_LIFE_MS, 0)).toBeNull();
  });

  it("puts the stream in front for left, right and down, hides it facing up, and the puddle where it lands", () => {
    expect(streamPlacement("up")).toBeNull();
    expect(streamPlacement("left")!.flip).toBe(true);
    expect(streamPlacement("right")!.flip).toBe(false);
    expect(puddleOffset("right").x).toBeGreaterThan(0);
    expect(puddleOffset("left").x).toBeLessThan(0);
    expect(puddleOffset("down").y).toBeGreaterThan(puddleOffset("up").y);
  });

  it("grows the puddle while peeing, then lets it dry up", () => {
    expect(puddleAt(0)!.frame).toBe(0);
    expect(puddleAt(PEE_MS)!.frame).toBe(2);
    expect(puddleAt(PEE_MS + PUDDLE_MS - 100)!.alpha).toBeLessThan(0.2);
    expect(puddleAt(PEE_MS + PUDDLE_MS)).toBeNull();
  });

  it("has catalog art for every piece", () => {
    const props = (catalog as unknown as { props: Record<string, { file: string; frames?: unknown[] }> }).props;
    for (const k of ["fx_quilt", "fx_pillow", "fx_zzz", "fx_pee_side", "fx_pee_front", "fx_puddle"]) expect(props[k], k).toBeTruthy();
    for (const k of ["fx_zzz", "fx_pee_side", "fx_pee_front", "fx_puddle"]) expect(props[k]!.frames).toHaveLength(3);
  });

  it("lists /sleep and /piss in the slash suggestions", () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(names).toContain("sleep");
    expect(names).toContain("piss");
  });
});

describe("meditating", () => {
  it("uses every look's cross-legged sit frame", async () => {
    const custom = (await import("../src/client/public/assets/lpc/custom/custom.json")).default as {
      actions: Record<string, { frames: string[]; hold?: boolean }>;
      characters: Record<string, { missing: string[] }>;
    };
    expect(custom.actions.meditate).toMatchObject({ frames: ["sit,1"], hold: true });
    for (const c of Object.values(custom.characters)) expect(c.missing).not.toContain("meditate");
  });

  it("breathes slowly and drops the name tag to the seated head", () => {
    const lo = breathAt(0);
    const hi = breathAt(MEDITATE.breathMs / 2);
    expect(hi.glow).toBeGreaterThan(lo.glow);
    expect(breathAt(MEDITATE.breathMs).glow).toBeCloseTo(lo.glow);
    expect(MEDITATE.head).toBeLessThan(50);
  });

  it("motes drift up, fade in and out, and stay near the body", () => {
    const a = moteAt(MOTE_LIFE_MS * 0.2, 3)!;
    const b = moteAt(MOTE_LIFE_MS * 0.9, 3)!;
    expect(b.y).toBeLessThan(a.y);
    expect(b.alpha).toBeLessThan(a.alpha);
    expect(moteAt(MOTE_LIFE_MS, 3)).toBeNull();
    for (let i = 0; i < 10; i++) expect(Math.abs(moteAt(0, i)!.x)).toBeLessThanOrEqual(MEDITATE.mote.halfWidth + 2);
  });

  it("has its art and a slash command", () => {
    const props = catalog.props as Record<string, unknown>;
    expect(props.fx_calm_glow).toBeTruthy();
    expect(props.fx_mote).toBeTruthy();
    expect(SLASH_COMMANDS.some((c) => c.name === "meditate")).toBe(true);
  });
});

describe("pee stream", () => {
  it("starts at the hips, not the chest or face", () => {
    for (const f of ["left", "right", "down"] as const) expect(streamPlacement(f)!.y).toBeGreaterThanOrEqual(HIP_Y);
    expect(HIP_Y).toBeGreaterThan(-22);
  });
});

describe("meditation motes", () => {
  it("never rise over the face", () => {
    for (let i = 0; i < 12; i++) expect(Math.abs(moteAt(0, i)!.x)).toBeGreaterThanOrEqual(6);
  });
});
