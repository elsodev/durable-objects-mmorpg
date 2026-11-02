import { describe, expect, it } from "vitest";
import catalog from "../src/client/public/assets/lpc/catalog.json";
import {
  breathAt,
  CHEER,
  cheerLift,
  DANCE,
  danceAt,
  HIP_Y,
  LIE,
  MEDITATE,
  MOTE_LIFE_MS,
  moteAt,
  noteAt,
  puddleAt,
  puddleOffset,
  SIT_GROUND,
  sparkleAt,
  streamPlacement,
  THINK,
  thinkFrame,
  WAVE_STEP_MS,
  waveFrame,
  ZZZ_LIFE_MS,
  zzzAt,
} from "../src/client/render/pose-logic";
import { SLASH_COMMANDS } from "../src/client/ui/slash-commands";
import { CHEER_MS, PEE_MS, POSE_COMMANDS, PUDDLE_MS } from "../src/shared/poses";

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

describe("ground poses", () => {
  const custom = async () =>
    (await import("../src/client/public/assets/lpc/custom/custom.json")).default as {
      actions: Record<string, { frames: string[]; hold?: boolean }>;
      characters: Record<string, { missing: string[] }>;
    };

  it("sits on the ground with every look's own sit frame, the tag at the seated head", async () => {
    const c = await custom();
    expect(c.actions.sit_ground).toMatchObject({ frames: ["sit,0"], hold: true });
    expect(c.actions.wave!.frames).toEqual(["slash,4", "slash,5"]);
    expect(c.actions.think!.frames).toEqual(["thrust,7"]);
    for (const ch of Object.values(c.characters)) for (const a of ["sit_ground", "wave", "think"]) expect(ch.missing).not.toContain(a);
    for (const f of ["up", "left", "down", "right"] as const) {
      expect(SIT_GROUND.head[f]).toBeLessThan(50);
      expect(SIT_GROUND.head[f]).toBeGreaterThan(30);
    }
  });

  it("waves back and forth", () => {
    expect(waveFrame(0)).toBe(0);
    expect(waveFrame(WAVE_STEP_MS)).toBe(1);
    expect(waveFrame(WAVE_STEP_MS * 2)).toBe(0);
    expect(waveFrame(-5)).toBe(0);
  });

  it("cheers in hops that land between, with sparkles around the head", () => {
    expect(cheerLift(0)).toBe(0);
    expect(cheerLift(CHEER.hopMs * 0.35)).toBe(CHEER.hopHeight);
    expect(cheerLift(CHEER.hopMs * 0.85)).toBe(0);
    expect(cheerLift(-1)).toBe(0);
    for (let i = 0; i < CHEER.sparkles.length; i++) {
      const s = sparkleAt(0, i)!;
      // Beside the upper body, clear of the name tag above the head.
      expect(s.y).toBeLessThan(-20);
      expect(s.y).toBeGreaterThan(-48);
      expect(Math.abs(s.x)).toBeGreaterThanOrEqual(15);
    }
    expect(sparkleAt(CHEER.sparkleLifeMs, 0)).toBeNull();
    expect(CHEER_MS).toBeGreaterThan(CHEER.hopMs * 3);
  });

  it("dances side to side on the beat with step frames, never past the sheet", () => {
    const facings = [0, 1, 2, 3].map((b) => danceAt(b * DANCE.beatMs, 9).facing);
    expect(facings).toEqual(["left", "down", "right", "down"]);
    expect(danceAt(0, 9).frame).not.toBe(danceAt(DANCE.beatMs, 9).frame);
    expect(danceAt(0, 1).frame).toBe(0);
    expect(danceAt(0, 9).lift).toBe(0);
    expect(danceAt(DANCE.beatMs * 0.75, 9).lift).toBe(1);
  });

  it("notes rise on alternating sides and fade", () => {
    const a = noteAt(0, 0)!;
    const b = noteAt(0, 1)!;
    expect(Math.sign(a.x)).toBe(-Math.sign(b.x));
    const late = noteAt(DANCE.noteLifeMs * 0.9, 0)!;
    expect(late.y).toBeLessThan(a.y);
    expect(late.alpha).toBeLessThan(1);
    expect(noteAt(DANCE.noteLifeMs, 0)).toBeNull();
  });

  it("fills the thought bubble one dot at a time, then holds three", () => {
    expect(thinkFrame(0)).toBe(0);
    expect(thinkFrame(THINK.dotMs)).toBe(1);
    expect(thinkFrame(THINK.dotMs * 2)).toBe(2);
    expect(thinkFrame(THINK.loopMs - 1)).toBe(2);
    expect(thinkFrame(THINK.loopMs)).toBe(0);
    // Above the name tag (standing head 50), not over the face.
    expect(THINK.bubble.y).toBeLessThan(-50);
  });

  it("has catalog art for the props", () => {
    const props = catalog.props as unknown as Record<string, { file: string; frames?: unknown[] }>;
    expect(props.fx_think!.frames).toHaveLength(3);
    expect(props.fx_note!.frames).toHaveLength(2);
    expect(props.fx_sparkle!.frames).toHaveLength(3);
  });

  it("lists every pose in the slash suggestions, aliases matching the parser", () => {
    for (const [word, pose] of Object.entries(POSE_COMMANDS)) {
      const cmd = SLASH_COMMANDS.find((c) => c.name === word || c.aliases.includes(word));
      expect(cmd, word).toBeTruthy();
      expect(POSE_COMMANDS[cmd!.name], word).toBe(pose);
    }
    for (const name of ["sit", "wave", "cheer", "dance", "think"]) {
      const cmd = SLASH_COMMANDS.find((c) => c.name === name)!;
      expect(cmd.description.length).toBeGreaterThan(5);
      expect(cmd.args).toBe("");
    }
  });

  it("offers every pose but /piss to a visitor", () => {
    const visiting = { atHome: true, homeOwner: false, guest: false, devTools: false };
    const village = { atHome: false, homeOwner: false, guest: true, devTools: false };
    const usable = (ctx: typeof visiting) => SLASH_COMMANDS.filter((c) => c.available(ctx)).map((c) => c.name);
    for (const n of ["sit", "sleep", "meditate", "wave", "cheer", "dance", "think"]) {
      expect(usable(visiting)).toContain(n);
      expect(usable(village)).toContain(n);
    }
    expect(usable(visiting)).not.toContain("piss");
    expect(usable(village)).toContain("piss");
  });
});
