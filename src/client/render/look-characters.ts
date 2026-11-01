// Plugs the look compositor into the entity layer: players whose EntityState carries a `look`
// get CharacterArt sliced from their composited sheet; everyone else keeps the catalog sprite.
// Both get action(name) (tool swings, harvest, hurt) from lazily composited action sheets.
import { Rectangle, Texture } from "pixi.js";
import type { ActionArt, CharacterArt } from "../contracts";
import type { LookCompositor } from "../art/compositor";
import { lookKey, LruCache, rowFrames, type ActionPlan, type Actor, type LookManifest, type LookRow } from "../art/look-logic";
import { validateLook } from "../../shared/look";
import type { Facing, Look } from "../../shared/types";
import { characterFor, type CharacterResolver } from "./entities";

const FACINGS: Facing[] = ["up", "left", "down", "right"];

function buildAction(m: LookManifest, canvas: HTMLCanvasElement, plan: ActionPlan): ActionArt {
  const source = Texture.from(canvas).source;
  source.scaleMode = "nearest";
  const fs = plan.spec.frameSize;
  const frames = {} as Record<Facing, Texture[]>;
  FACINGS.forEach((f, r) => {
    frames[f] = plan.spec.frames.map((_, j) => new Texture({ source, frame: new Rectangle(j * fs, r * fs, fs, fs) }));
  });
  const off = (fs - m.frameW) / 2;
  return { frames, ms: plan.spec.ms, hold: plan.spec.hold, anchor: { x: (m.anchor[0] + off) / fs, y: (m.anchor[1] + off) / fs } };
}

/** CharacterArt.action for a look or a catalog character: built from the compositor's lazily loaded action sheets. */
function lookActions(comp: LookCompositor, m: LookManifest, who: Actor): (name: string) => ActionArt | null {
  const made = new Map<string, ActionArt>();
  return (name) => {
    const hit = made.get(name);
    if (hit) return hit;
    const sheet = comp.action(who, name);
    if (!sheet) return null;
    const art = buildAction(m, sheet.canvas, sheet.plan);
    made.set(name, art);
    return art;
  };
}

function buildArt(m: LookManifest, canvas: HTMLCanvasElement): CharacterArt {
  const source = Texture.from(canvas).source;
  source.scaleMode = "nearest";
  const slice = (r: LookRow): Texture[] =>
    rowFrames(m, r).map(([x, y, w, h]) => new Texture({ source, frame: new Rectangle(x, y, w, h) }));
  const walk = {} as Record<Facing, Texture[]>;
  const idle = {} as Record<Facing, Texture>;
  for (const f of FACINGS) {
    walk[f] = slice(m.walk[f]);
    idle[f] = walk[f][0]!;
  }
  const art: CharacterArt = { walk, idle, anchor: { x: m.anchor[0] / m.frameW, y: m.anchor[1] / m.frameH } };
  if (m.slash) {
    const attack = {} as Record<Facing, Texture[]>;
    for (const f of FACINGS) attack[f] = slice(m.slash[f]);
    art.attack = attack;
  }
  return art;
}

/** CharacterResolver for createEntityLayer: composited look for players, catalog sprite otherwise. */
export function lookResolver(comp: LookCompositor, fallback: CharacterResolver = characterFor): CharacterResolver {
  const cache = new LruCache<CharacterArt>(32);
  /** Catalog sprites with action sheets: a copy of the catalog art plus action(), per sprite id. */
  const fixed = new Map<string, { from: CharacterArt; art: CharacterArt }>();
  const withActions = (base: CharacterArt, sprite: string, m: LookManifest): CharacterArt => {
    if (!Object.hasOwn(m.characters, sprite)) return base;
    const hit = fixed.get(sprite);
    if (hit && hit.from === base) return hit.art;
    const made: CharacterArt = { ...base, action: lookActions(comp, m, { sprite }) };
    fixed.set(sprite, { from: base, art: made });
    return made;
  };
  return (art, state) => {
    const look: Look | null = state.kind === "player" ? validateLook(state.look) : null;
    const m = comp.manifest();
    if (!m) return fallback(art, state);
    if (!look) return withActions(fallback(art, state), state.sprite, m);
    const key = lookKey(look);
    const hit = cache.get(key);
    if (hit) return hit;
    const canvas = comp.sheet(look);
    if (!canvas) return withActions(fallback(art, state), state.sprite, m);
    const made = buildArt(m, canvas);
    made.action = lookActions(comp, m, look);
    cache.set(key, made);
    return made;
  };
}
