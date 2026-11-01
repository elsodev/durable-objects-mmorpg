// What a humanoid placeholder wears. NPC sprite keys get hand-picked outfits; anything else
// (player_1..4, unknown keys) is derived from a hash of the key, so it is stable across loads.
import { hashStr, pick, rng, type Rgb } from "../palette";

export type HairStyle = "short" | "long" | "spiky" | "bald" | "bun" | "ponytail" | "bob" | "fringe";
export type Outfit = "tunic" | "dress" | "robe" | "apron" | "overalls" | "vest" | "coat";
export type Hat = "none" | "brim" | "helmet" | "cap" | "straw";

export interface Look {
  skin: Rgb;
  hair: Rgb;
  hairStyle: HairStyle;
  shirt: Rgb;
  pants: Rgb;
  shoes: Rgb;
  outfit: Outfit;
  /** Apron, vest, overall or coat-trim colour. */
  accent: Rgb;
  hat: Hat;
  hatColor: Rgb;
  beard: Rgb | null;
  small: boolean;
}

export const SKINS = [0xf2c9a0, 0xe0ac7e, 0xc68a5e, 0x9a6440, 0x6e4530, 0xf6d6b8] as const;
export const HAIRS = [0x3a2a20, 0x6b3f22, 0xa8642e, 0xd8b062, 0x2a2a34, 0xb8402c, 0xe8e0d0, 0x8a5a3a] as const;
export const SHIRTS = [0x3d6fb3, 0x3f8f5a, 0xb8483a, 0xd29a3a, 0x7a4f9e, 0x2f8f8f, 0xc86a8a, 0x5a6a7a] as const;
export const PANTS = [0x4a3a5a, 0x5a4632, 0x3a4a6a, 0x4f5a3a, 0x6a5a4a] as const;

const NPC_LOOKS: Record<string, Partial<Look>> = {
  villager_old: {
    skin: 0xf0c8a2, hair: 0xe8e2d6, hairStyle: "bald", beard: 0xe8e2d6,
    shirt: 0x2f3f7a, pants: 0x3a3a46, outfit: "coat", accent: 0xd8c27a,
  },
  villager_woman: {
    skin: 0xf2c9a0, hair: 0x6b3f22, hairStyle: "long", shirt: 0xe8d6ae, pants: 0x8a6a4a,
    outfit: "apron", accent: 0xf6efe0,
  },
  smith: {
    skin: 0x6e4530, hair: 0x241c1c, hairStyle: "short", beard: 0x241c1c, shirt: 0x6a6a72,
    pants: 0x3e342c, outfit: "apron", accent: 0x7a4a2a,
  },
  villager_woman2: {
    skin: 0xf6d6b8, hair: 0xb8402c, hairStyle: "ponytail", shirt: 0x3f7a4a, pants: 0x2f5a3a,
    outfit: "dress", accent: 0xe8d6ae,
  },
  kid: {
    skin: 0xe0ac7e, hair: 0xc8482c, hairStyle: "spiky", shirt: 0x3d7fc3, pants: 0x5a4632,
    outfit: "tunic", small: true,
  },
  fisher: {
    skin: 0xc68a5e, hair: 0x8a5a3a, hairStyle: "short", beard: 0x8a5a3a, shirt: 0xd8c8a0,
    pants: 0x3a4a6a, outfit: "vest", accent: 0x4f6a3a, hat: "straw", hatColor: 0xd8b860,
  },
  monk: {
    skin: 0xe0ac7e, hair: 0x3a2a20, hairStyle: "bald", shirt: 0xc8742a, pants: 0xc8742a,
    outfit: "robe", accent: 0x8a3a2a,
  },
  villager_woman3: {
    skin: 0xf2c9a0, hair: 0x1e1e2a, hairStyle: "bob", shirt: 0x8a2f4a, pants: 0x5a2a3a,
    outfit: "dress", accent: 0xf0e0c8,
  },
  miner: {
    skin: 0xe0ac7e, hair: 0xa8642e, hairStyle: "short", beard: 0xa8642e, shirt: 0x8a3a2a,
    pants: 0x5a4632, outfit: "overalls", accent: 0x4a5a7a, hat: "helmet", hatColor: 0xe0b030,
  },
  explorer: {
    skin: 0xc68a5e, hair: 0x6b3f22, hairStyle: "short", shirt: 0xb8a070, pants: 0x6a5a3a,
    outfit: "vest", accent: 0x7a5a32, hat: "brim", hatColor: 0x8a6438,
  },
};

const STYLES: HairStyle[] = ["short", "long", "spiky", "bun", "ponytail", "bob", "fringe"];

export function lookFor(key: string): Look {
  const r = rng(hashStr(key));
  const n = () => Math.floor(r() * 1e6);
  const base: Look = {
    skin: pick(SKINS, n()),
    hair: pick(HAIRS, n()),
    hairStyle: pick(STYLES, n()),
    shirt: pick(SHIRTS, n()),
    pants: pick(PANTS, n()),
    shoes: 0x3a2a22,
    outfit: pick(["tunic", "tunic", "vest", "coat"] as const, n()),
    accent: pick(SHIRTS, n()),
    hat: "none",
    hatColor: 0x6a4a2a,
    beard: null,
    small: false,
  };
  // Players: four clearly different silhouettes first, then hash for the rest.
  const player = /^player_(\d+)$/.exec(key);
  if (player) {
    const i = (Number(player[1]) - 1 + 400) % 4;
    const presets: Partial<Look>[] = [
      { hairStyle: "short", hair: 0x6b3f22, shirt: 0x3d6fb3, pants: 0x4a3a5a, outfit: "tunic" },
      { hairStyle: "long", hair: 0xd8b062, shirt: 0x3f8f5a, pants: 0x5a4632, outfit: "vest", accent: 0x8a5a32 },
      { hairStyle: "spiky", hair: 0x2a2a34, shirt: 0xb8483a, pants: 0x3a4a6a, outfit: "tunic", skin: 0xc68a5e },
      { hairStyle: "ponytail", hair: 0xb8402c, shirt: 0x7a4f9e, pants: 0x4f5a3a, outfit: "coat", accent: 0xd8c27a },
    ];
    return { ...base, ...presets[i] };
  }
  return { ...base, ...(Object.hasOwn(NPC_LOOKS, key) ? NPC_LOOKS[key] : {}) };
}
