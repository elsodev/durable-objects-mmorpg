// The red flag on the home mailbox: raised while there is unread mail (invites, friend requests,
// letters, parcels), folded down otherwise. Drawn in the sorted layer just in front of the box.
import { Graphics } from "pixi.js";
import { TILE, type Layers } from "../contracts";
import type { MapData } from "../../shared/types";

export interface MailboxFlag {
  set(up: boolean): void;
  isUp(): boolean;
  destroy(): void;
}

const RED = 0xd8402c;
const RED_DARK = 0x8e2a1e;
const STICK = 0x3a2a24;

export function createMailboxFlag(layers: Layers, map: MapData): MailboxFlag {
  const box = map.props.find((p) => p.id === "mailbox");
  const g = new Graphics();
  g.label = "mailbox-flag";
  g.eventMode = "none";
  let up = false;
  const draw = () => {
    if (!box) return;
    // Tile units relative to the mailbox feet (bottom-left of its 1x1 footprint).
    const t = (v: number) => Math.round(v * TILE);
    g.clear();
    if (up) {
      g.rect(t(0.86), -t(1.62), t(0.06), t(0.82)).fill(STICK);
      g.rect(t(0.92), -t(1.62), t(0.28), t(0.18)).fill(RED).stroke({ color: RED_DARK, width: 2 });
    } else {
      g.rect(t(0.86), -t(0.86), t(0.36), t(0.08)).fill(RED).stroke({ color: RED_DARK, width: 2 });
    }
    g.position.set(box.x * TILE, (box.y + 1) * TILE);
    g.zIndex = (box.y + 1) * TILE + 1;
  };
  draw();
  layers.sorted.addChild(g);
  return {
    set(next) {
      if (next === up) return;
      up = next;
      draw();
    },
    isUp: () => up,
    destroy() {
      if (!g.destroyed) g.destroy();
    },
  };
}
