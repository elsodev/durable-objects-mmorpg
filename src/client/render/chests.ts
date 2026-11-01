// Cave treasure chests: closed or open (as YOU see them: each player opens each chest once),
// with a short lid animation and a glint when one is opened. Server truth comes in ChestView lists.
import { Sprite, Ticker } from "pixi.js";
import { SCALE, TILE, type Art, type Layers } from "../contracts";
import type { ChestView } from "../../shared/chests";
import type { Vec2 } from "../../shared/types";

/** ms per lid frame (closed -> ajar -> open). */
export const LID_FRAME_MS = 110;

/** Lid frame for an animation `t` ms after opening: 0 closed, 1 ajar, 2 open. */
export function lidFrame(t: number): 0 | 1 | 2 {
  if (t < LID_FRAME_MS) return 0;
  return t < LID_FRAME_MS * 2 ? 1 : 2;
}

/** The chest a player standing at `p` and facing tile `ahead` means: on that tile, else next to them. */
export function chestFor(list: readonly ChestView[], p: Vec2, ahead: Vec2, reach: number): ChestView | null {
  const onAhead = list.find((c) => c.x === ahead.x && c.y === ahead.y);
  if (onAhead) return onAhead;
  let best: ChestView | null = null;
  let bd = reach;
  for (const c of list) {
    const d = Math.hypot(p.x - (c.x + 0.5), p.y - (c.y + 0.5));
    if (d <= bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

export interface ChestLayer {
  set(list: readonly ChestView[]): void;
  /** Plays the lid opening on a chest (it then stays open). */
  open(id: string): void;
  list(): readonly ChestView[];
  at(tile: Vec2): ChestView | null;
  destroy(): void;
}

export function createChestLayer(art: Art, layers: Layers): ChestLayer {
  const look = art.prop("cave_chest");
  const frames = look.frames && look.frames.length >= 3 ? look.frames : [look.texture, look.texture, look.texture];
  const sprites = new Map<string, Sprite>();
  const anims = new Map<string, number>();
  let chests: ChestView[] = [];

  const show = (s: Sprite, frame: 0 | 1 | 2) => {
    s.texture = frames[frame]!;
  };

  const tick = (t: Ticker) => {
    for (const [id, elapsed] of anims) {
      const s = sprites.get(id);
      const now = elapsed + t.deltaMS;
      if (!s) {
        anims.delete(id);
        continue;
      }
      show(s, lidFrame(now));
      if (lidFrame(now) === 2) anims.delete(id);
      else anims.set(id, now);
    }
  };
  Ticker.shared.add(tick);

  const api: ChestLayer = {
    set(list) {
      chests = list.map((c) => ({ ...c }));
      const keep = new Set(chests.map((c) => c.id));
      for (const [id, s] of sprites) {
        if (keep.has(id)) continue;
        s.destroy();
        sprites.delete(id);
      }
      for (const c of chests) {
        let s = sprites.get(c.id);
        if (!s) {
          s = new Sprite(frames[0]!);
          s.anchor.set(look.anchor.x, look.anchor.y);
          s.scale.set(SCALE);
          layers.sorted.addChild(s);
          sprites.set(c.id, s);
        }
        s.position.set((c.x + 0.5) * TILE, (c.y + 0.9) * TILE);
        s.zIndex = (c.y + 0.9) * TILE;
        if (!anims.has(c.id)) show(s, c.opened ? 2 : 0);
      }
    },
    open(id) {
      const c = chests.find((x) => x.id === id);
      if (!c) return;
      c.opened = true;
      anims.set(id, 0);
    },
    list: () => chests,
    at(tile) {
      return chests.find((c) => c.x === Math.floor(tile.x) && c.y === Math.floor(tile.y)) ?? null;
    },
    destroy() {
      Ticker.shared.remove(tick);
      for (const s of sprites.values()) s.destroy();
      sprites.clear();
      anims.clear();
    },
  };
  return api;
}
