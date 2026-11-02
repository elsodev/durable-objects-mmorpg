import { describe, expect, it } from "vitest";
import { animalButtons, animalStatus, speciesLabel } from "../src/client/ui/animals-logic";
import { ANIMAL_POSE_MS, animalPoseFrame, profileFor } from "../src/client/render/entityProfile";
import { animalLoveSfx } from "../src/client/audio/audio-logic";
import type { AnimalView } from "../src/shared/animals";
import catalog from "../src/client/public/assets/lpc/catalog.json";
import audio from "../src/client/public/assets/audio/audio.json";

// No @types/node in this repo: load the one Node built-in this test uses, untyped.
const proc = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process;
const { existsSync } = proc.getBuiltinModule("node:fs") as { existsSync(p: string): boolean };

const view = (o: Partial<AnimalView>): AnimalView => ({
  entity: "a:mochi",
  name: "Mochi",
  species: "cat",
  hearts: 2,
  maxHearts: 5,
  pts: 40,
  pettedToday: false,
  fedToday: false,
  ...o,
});

describe("animal card", () => {
  it("shows Adopt only when the village animal is ready, and no Feed or Adopt for hens", () => {
    expect(animalButtons(view({}))).toEqual({ pet: true, feed: true, adopt: false });
    expect(animalButtons(view({ canAdopt: true }))).toEqual({ pet: true, feed: true, adopt: true });
    expect(animalButtons(view({ canAdopt: true, yours: true })).adopt).toBe(false);
    expect(animalButtons(view({ species: "chicken" }))).toEqual({ pet: true, feed: false, adopt: false });
  });

  it("says what today's care was and what comes next", () => {
    expect(animalStatus(view({ pettedToday: true, fedToday: true }))).toBe("Already petted and fed today.");
    expect(animalStatus(view({ canAdopt: true }))).toContain("would love a home");
    expect(animalStatus(view({ yours: true }))).toMatch(/^Your pet\./);
    expect(speciesLabel(view({ species: "dog" }))).toBe("Dog");
  });
});

describe("animal art and sound", () => {
  it("loops poses at their own pace and ignores other acts", () => {
    expect(animalPoseFrame("rest", 0, 4)).toBe(0);
    expect(animalPoseFrame("rest", ANIMAL_POSE_MS.rest! * 5, 4)).toBe(1);
    expect(animalPoseFrame("scratch", ANIMAL_POSE_MS.scratch! * 3, 4)).toBe(3);
    expect(animalPoseFrame("hoe", 0, 4)).toBe(-1);
    expect(profileFor("dog_golden").head).toBeGreaterThan(profileFor("cat_ginger").head);
  });

  it("every animal sheet exists and declares its poses within the sheet", () => {
    const animals = (catalog as { animals: Record<string, { file: string; frameH: number; animations: Record<string, Record<string, { row: number; frames: number }>> }> }).animals;
    expect(Object.keys(animals).sort()).toEqual(["cat_ginger", "cat_grey", "chicken_brown", "chicken_white", "dog_golden", "dog_patch"]);
    for (const [k, e] of Object.entries(animals)) {
      expect(existsSync(`src/client/public/assets/lpc/${e.file}`), k).toBe(true);
      for (const pose of ["walk", "rest", "nap", "love"]) expect(Object.keys(e.animations[pose]!).sort(), `${k} ${pose}`).toEqual(["down", "left", "right", "up"]);
      const rows = Math.max(...Object.values(e.animations).flatMap((d) => Object.values(d).map((r) => r.row)));
      expect(rows, k).toBeLessThan(k.startsWith("chicken") ? 14 : 18);
    }
    expect(animals.cat_ginger!.animations.scratch).toBeDefined();
    expect(animals.cat_ginger!.animations.play).toBeDefined();
    expect(animals.dog_patch!.animations.sniff).toBeDefined();
  });

  it("dogs bark, cats purr and hens cluck, from sounds in the manifest", () => {
    expect(animalLoveSfx("dog_patch")).toBe("dog_bark");
    expect(animalLoveSfx("cat_grey")).toBe("cat_purr");
    expect(animalLoveSfx("chicken_brown")).toBe("hen_cluck");
    expect(animalLoveSfx("slime")).toBeNull();
    const sfx = (audio as { sfx: Record<string, { files: string[] }> }).sfx;
    for (const k of ["dog_bark", "cat_purr", "cat_meow", "hen_cluck"]) {
      expect(sfx[k], k).toBeDefined();
      for (const f of sfx[k]!.files) expect(existsSync(`src/client/public/assets/audio/${f}`), f).toBe(true);
    }
  });
});
