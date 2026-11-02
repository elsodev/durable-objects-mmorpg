// "Enter Town Hall" plate over a building door while you stand near it (and "Exit to Village"
// inside, by the way out; "Enter House" / "Exit to Yard" at home; an exit's own label, such as
// the cave passages' "← Depth 3: ..."). The text comes from shared map data only.
import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { TILE, type Layers } from "../contracts";
import { doorFor, outsideOf } from "../../shared/maps/interiors/doors";
import { isInteriorZone, type MapData, type Vec2 } from "../../shared/types";

/** How close (tiles, feet to the door tile's edge) you must be to see the hint. */
export const HINT_RANGE = 1.75;

export interface DoorHint {
  text: string;
  /** Tile coords of the plate's bottom centre (top edge of the door tile). */
  x: number;
  y: number;
  /**
   * A passage off the top edge of the map: there is no room above it, so the plate hangs below
   * the passage instead, with `y` its top edge (clear of the player walking up to it).
   */
  below?: boolean;
}

/** Pure: the hint for a position, or null. */
export function doorHintAt(map: MapData, pos: Vec2): DoorHint | null {
  let best: DoorHint | null = null;
  let bestD = HINT_RANGE;
  for (const e of map.exits) {
    let text: string | null = null;
    if (e.label) text = e.label;
    else if (e.map) text = e.map === "home_in" ? "Enter House" : "Exit to Yard";
    else if (isInteriorZone(e.to)) text = `Enter ${doorFor(e.to).name}`;
    else if (isInteriorZone(map.zone) && e.to === outsideOf(doorFor(map.zone))) text = e.to === "jail" ? "Exit to Jail Yard" : "Exit to Village";
    // The cave mouth is a doorway in the quarry's cliff, and the tunnel's end leads back out.
    else if (map.zone === "quarry" && e.to === "caves") text = "Enter the Caves";
    else if (map.zone === "caves" && e.to === "quarry") text = "Exit to Quarry";
    if (!text) continue;
    const dx = Math.max(e.x - pos.x, 0, pos.x - (e.x + e.w));
    const dy = Math.max(e.y - pos.y, 0, pos.y - (e.y + e.h));
    const d = Math.hypot(dx, dy);
    if (d <= bestD) {
      bestD = d;
      best = e.y === 0 && !e.map ? { text, x: e.x + e.w / 2, y: e.y + e.h + 2.1, below: true } : { text, x: e.x + e.w / 2, y: e.y };
    }
  }
  return best;
}

const STYLE = new TextStyle({
  fontFamily: "'Pixelify Sans', 'Press Start 2P', ui-monospace, monospace",
  fontSize: 14,
  fontWeight: "600",
  fill: 0xfff6dc,
});

export interface DoorHintLayer {
  update(map: MapData, you: Vec2 | null): void;
  destroy(): void;
}

export function createDoorHint(layers: Layers): DoorHintLayer {
  const root = new Container({ label: "door-hint" });
  root.eventMode = "none";
  root.visible = false;
  const bg = new Graphics();
  const label = new Text({ text: "", style: STYLE, resolution: 2 });
  root.addChild(bg, label);
  layers.overlay.addChild(root);
  let shown = "";

  return {
    update(map, you) {
      const hint = you ? doorHintAt(map, you) : null;
      root.visible = !!hint;
      if (!hint) return;
      if (hint.text !== shown) {
        shown = hint.text;
        label.text = hint.text;
        const w = Math.ceil(label.width) + 16;
        const h = Math.ceil(label.height) + 8;
        bg.clear().roundRect(0, 0, w, h, 5).fill({ color: 0x2a1c14, alpha: 0.85 }).stroke({ color: 0xe6b84a, width: 2 });
        label.position.set(8, 4);
      }
      // Above the door, clear of the player's own name tag; kept inside the map, so a passage at
      // the map's side edge doesn't push half the plate off screen.
      const x = Math.min(Math.max(hint.x * TILE - root.width / 2, 2), map.width * TILE - root.width - 2);
      const y = hint.below ? hint.y * TILE : hint.y * TILE - TILE * 0.9 - root.height;
      root.position.set(Math.round(x), Math.round(y));
    },
    destroy() {
      if (!root.destroyed) root.destroy({ children: true });
    },
  };
}
