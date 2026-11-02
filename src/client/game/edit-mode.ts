// House edit mode: the owner rearranges their house without walking about. Click or tap a piece
// to select it, Shift-click (or "Select several") or drag a box for more, drag to move them
// together, R to turn, Del to pick up, and the bag tray to place new pieces one after another.
// The session hands it the canvas and asks it first about clicks, keys and the camera while it
// is on; it sends the usual moveObject / place / pickup messages, or moveObjects / pickupObjects
// for several pieces at once. The rules live in edit-logic.ts, the drawing in render/edit-view.ts.
import type { Art, InputAction, Layers } from "../contracts";
import { TILE } from "../contracts";
import { canPlace, footprint, MAX_ARRANGE, type ArrangeMove } from "../../shared/engine";
import { getItem, stepRotation } from "../../shared/items";
import type { ClientMsg } from "../../shared/protocol";
import type { FarmTile, Inventory, MapData, PlacedObject, Vec2 } from "../../shared/types";
import { createEditView, type EditGhost, type EditView } from "../render/edit-view";
import { wallLift } from "../render/farm";
import { snapTopLeft } from "../render/buildmode-logic";
import type { EditUi } from "../ui/edit-ui";
import { dragGhosts, heldGhost, pendingGhosts, toolbarState, type HeldPiece } from "./edit-scene";
import {
  boxBetween,
  boxSelect,
  checkMoves,
  clampFocus,
  edgeScroll,
  groupMoves,
  isNoop,
  nearestFree,
  PAN_SPEED,
  pieceAt,
  shapeOf,
  snapDelta,
  toolbarSpot,
  toggleSelect,
  trayEntries,
  turnMoves,
  unionRect,
  type PieceShape,
  type Rotation,
} from "./edit-logic";

export interface EditModeDeps {
  canvas: HTMLCanvasElement;
  art: Art;
  layers: Layers;
  ui: EditUi;
  screenToTile(sx: number, sy: number): Vec2;
  tileToScreen(x: number, y: number): Vec2;
  viewport(): { w: number; h: number };
  map(): MapData | null;
  objects(): PlacedObject[];
  farm(): FarmTile[];
  occupied(): Vec2[];
  inventory(): Inventory;
  /** Where you stand (the camera starts there). */
  you(): Vec2 | null;
  /** True in your own house: the Edit button shows and edit mode may start. */
  available(): boolean;
  send(msg: ClientMsg): void;
  notice(text: string, kind?: "info" | "error"): void;
  sfx(key: string): void;
  /** Fade placed pieces that are being dragged. */
  dim(ids: ReadonlySet<string>): void;
  /** Edit mode turned on or off (stop walking, let the wheel turn pieces). */
  changed(on: boolean): void;
}

export interface EditMode {
  active(): boolean;
  toggle(): void;
  exit(): void;
  /** Game keys while editing (rotate, cancel); every other action is swallowed. */
  action(a: InputAction): void;
  /** Held movement keys pan the view while editing. */
  pan(dir: { dx: number; dy: number }): void;
  /** Camera centre while editing (tiles), else null. */
  focus(): Vec2 | null;
  /** Each frame: pan, edge scroll, redraw. */
  update(dtMs: number): void;
  /** Objects, the bag or where you are changed. */
  refresh(): void;
  /** The server refused a request this mode sent. */
  rejected(req: string | undefined): void;
  /** A furniture slot picked in the bag while editing: hold it to place. */
  hold(slot: number | null): void;
  /** Selected pieces (or the held one) back into the bag. */
  pickUp(): void;
  /** "Select several": taps add to the selection and a finger drag draws a box. */
  setMulti(on: boolean): void;
  destroy(): void;
}

/** Pointer travel (px) before a press becomes a drag; fingers wobble more than a mouse. */
const DRAG_PX = { mouse: 5, touch: 10 };
/** A move unanswered this long stops drawing its ghosts (the objects message wins anyway). */
const PENDING_MS = 3000;
/** How far (tiles) to look for a free spot for a piece taken from the tray. */
const FREE_RADIUS = 6;

type Gesture =
  | { kind: "press"; id: string; start: Vec2; screen: Vec2; add: boolean; touch: boolean }
  | { kind: "drag"; ids: string[]; start: Vec2; delta: Vec2 }
  | { kind: "box"; start: Vec2; end: Vec2; screen: Vec2; base: string[]; add: boolean }
  | { kind: "pan"; screen: Vec2; from: Vec2 }
  | { kind: "place" };

let reqCounter = 0;
const nextReq = () => `e${Date.now().toString(36)}${(reqCounter++).toString(36)}`;

export function createEditMode(d: EditModeDeps): EditMode {
  let on = false;
  let view: EditView | null = null;
  let selection: string[] = [];
  let hover: string | null = null;
  let gesture: Gesture | null = null;
  let multi = false;
  let focusAt: Vec2 = { x: 0, y: 0 };
  let panDir = { dx: 0, dy: 0 };
  /** Last pointer position on the canvas (px), for edge scrolling and the hover ghost. */
  let pointer: { screen: Vec2; inside: boolean } | null = null;
  /** A piece from the bag being placed: its slot, item, turn and where the ghost is. */
  let held: HeldPiece | null = null;
  /** Moves sent and not yet answered: drawn as ghosts so nothing jumps back meanwhile. */
  let pending: { req: string; moves: ArrangeMove[]; at: number } | null = null;
  let toolbarKey = "";
  let toolbarSize = { w: 0, h: 0 };

  const objs = () => d.objects();
  const byId = () => new Map(objs().map((o) => [o.id, o]));
  /** The placed pieces with these ids, in that order (gone ones left out). */
  const pick = (ids: readonly string[]) => {
    const map = byId();
    return ids.map((id) => map.get(id)).filter((o): o is PlacedObject => !!o);
  };
  const world = () => ({ map: d.map(), objects: objs(), farm: d.farm(), occupied: d.occupied() });

  function shapes(): PieceShape[] {
    const map = d.map();
    return objs().map((o) => {
      const look = d.art.furniture(o.item, o.rotation);
      return shapeOf(o, {
        w: look.texture.width,
        h: look.texture.height,
        ax: look.anchor.x,
        ay: look.anchor.y,
        lift: wallLift(o, map),
      });
    });
  }

  function local(e: PointerEvent): Vec2 {
    const r = d.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  const tileOf = (p: Vec2) => d.screenToTile(p.x, p.y);

  // ------------------------------------------------------------------ enter / leave

  function enter(): void {
    if (on) return;
    if (!d.available()) {
      d.notice("You can rearrange furniture inside your own house.", "error");
      return;
    }
    on = true;
    view = createEditView(d.art, d.layers);
    const me = d.you();
    const map = d.map();
    focusAt = me ?? (map ? { x: map.width / 2, y: map.height / 2 } : { x: 0, y: 0 });
    d.ui.setActive(true);
    d.changed(true);
    refresh();
  }

  function exit(): void {
    if (!on) return;
    on = false;
    selection = [];
    hover = null;
    gesture = null;
    held = null;
    pending = null;
    panDir = { dx: 0, dy: 0 };
    d.dim(new Set());
    if (view && !viewGone()) view.destroy();
    view = null;
    d.ui.setToolbar(null);
    d.ui.setActive(false);
    d.changed(false);
  }

  /** The world's layers may have been cleared under us (a new map): the view went with them. */
  function viewGone(): boolean {
    return !d.layers.overlay.children.some((c) => c.label === "editmode");
  }

  // ------------------------------------------------------------------ actions

  function rotate(dir: 1 | -1): void {
    if (held) {
      const next = stepRotation(held.item, held.rotation, dir);
      if (next === held.rotation) return d.notice("This piece only goes one way round.");
      held.rotation = next;
      d.sfx("ui_tab");
      return;
    }
    const pieces = pick(selection);
    if (pieces.length === 0) return d.notice("Select a piece to turn it.");
    const { moves, turned } = turnMoves(pieces, dir);
    if (turned === 0) return d.notice(pieces.length > 1 ? "None of these turn." : "This piece only goes one way round.");
    // Only the pieces that turn go to the server; the rest stay put (and still block).
    sendMoves(moves.filter((m, i) => m.rotation !== pieces[i]!.rotation));
  }

  function sendMoves(moves: ArrangeMove[]): void {
    const res = checkMoves(world(), moves);
    if (!res.ok) {
      d.notice(res.reason, "error");
      d.sfx("error");
      return;
    }
    const req = nextReq();
    pending = { req, moves, at: performance.now() };
    if (moves.length === 1) {
      const m = moves[0]!;
      d.send({ t: "moveObject", id: m.id, x: m.x, y: m.y, rotation: m.rotation, req });
    } else d.send({ t: "moveObjects", moves, req });
    d.sfx("place");
  }

  function pickUp(): void {
    if (held) return hold(null);
    const ids = pick(selection).map((o) => o.id);
    if (ids.length === 0) return d.notice("Select a piece to pick it up.");
    const req = nextReq();
    if (ids.length === 1) d.send({ t: "pickup", id: ids[0]!, req });
    else d.send({ t: "pickupObjects", ids, req });
    d.sfx("pickup");
  }

  function hold(slot: number | null): void {
    if (!on) enter();
    if (!on) return;
    selection = [];
    if (slot === null) {
      held = null;
      refresh();
      return;
    }
    const s = d.inventory().slots[slot];
    const def = s ? getItem(s.item) : undefined;
    if (!s || !def || def.kind !== "furniture") return;
    const rotation = (def.rotations?.[0] ?? 0) as Rotation;
    held = { slot, item: s.item, rotation, at: null };
    // Start where it fits near the middle of the view; the pointer takes it from there.
    const map = d.map();
    if (map) {
      const fp = footprint(s.item, rotation);
      const spot = nearestFree({ x: focusAt.x - fp.w / 2, y: focusAt.y - fp.h / 2 }, FREE_RADIUS, (x, y) =>
        canPlace(map, objs(), d.farm(), s.item, x, y, rotation, { occupied: d.occupied() }).ok,
      );
      held.at = spot ?? { x: Math.floor(focusAt.x), y: Math.floor(focusAt.y) };
    }
    refresh();
  }

  function placeHeld(): void {
    if (!held || !held.at) return;
    const map = d.map();
    const s = d.inventory().slots[held.slot];
    if (!map || !s || s.item !== held.item) {
      held = null;
      refresh();
      return d.notice("You don't have that any more.");
    }
    const ok = canPlace(map, objs(), d.farm(), held.item, held.at.x, held.at.y, held.rotation, { occupied: d.occupied() });
    if (!ok.ok) {
      d.notice(ok.reason, "error");
      d.sfx("error");
      return;
    }
    d.send({ t: "place", slot: held.slot, x: held.at.x, y: held.at.y, rotation: held.rotation, req: nextReq() });
    d.sfx("place");
  }

  /** Esc: put back what you hold, else drop the selection, else leave edit mode. */
  function cancel(): void {
    if (gesture) {
      gesture = null;
      d.dim(new Set());
    } else if (held) hold(null);
    else if (selection.length > 0) selection = [];
    else exit();
  }

  // ------------------------------------------------------------------ pointer

  function heldAt(tile: Vec2): Vec2 | null {
    return held ? snapTopLeft(held.item, held.rotation, tile) : null;
  }

  function onDown(e: PointerEvent): void {
    if (!on || e.isPrimary === false) return;
    const screen = local(e);
    pointer = { screen, inside: true };
    if (e.button === 2) return cancel();
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      d.canvas.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events have no capture; the drag still works inside the canvas
    }
    const tile = tileOf(screen);
    const touch = e.pointerType !== "mouse";
    if (held) {
      held.at = heldAt(tile);
      gesture = { kind: "place" };
      return;
    }
    const add = e.shiftKey || multi;
    const id = pieceAt(shapes(), tile);
    if (id) gesture = { kind: "press", id, start: tile, screen, add, touch };
    else if (touch && !multi) gesture = { kind: "pan", screen, from: { ...focusAt } };
    else gesture = { kind: "box", start: tile, end: tile, screen, base: add ? [...selection] : [], add };
  }

  /** Re-runs the gesture for the pointer at `screen` (also after the view scrolled under it). */
  function track(screen: Vec2): void {
    const tile = tileOf(screen);
    const g = gesture;
    if (!g) {
      if (held) held.at = heldAt(tile);
      return;
    }
    switch (g.kind) {
      case "press": {
        const far = Math.hypot(screen.x - g.screen.x, screen.y - g.screen.y) > (g.touch ? DRAG_PX.touch : DRAG_PX.mouse);
        if (!far) return;
        // Dragging a selected piece takes the whole selection along; any other piece goes alone
        // (or joins, with Shift).
        const ids = selection.includes(g.id) ? [...selection] : g.add ? [...selection, g.id].slice(0, MAX_ARRANGE) : [g.id];
        selection = ids;
        gesture = { kind: "drag", ids, start: g.start, delta: { x: 0, y: 0 } };
        d.dim(new Set(ids));
        return track(screen);
      }
      case "drag":
        g.delta = snapDelta(g.start, tile);
        return;
      case "box": {
        g.end = tile;
        selection = [...new Set([...g.base, ...boxSelect(shapes(), boxBetween(g.start, g.end))])].slice(0, MAX_ARRANGE);
        return;
      }
      case "pan": {
        focusAt = clampFocus(
          { x: g.from.x - (screen.x - g.screen.x) / TILE, y: g.from.y - (screen.y - g.screen.y) / TILE },
          d.map() ?? { width: 0, height: 0 },
          viewTiles(),
        );
        return;
      }
      case "place":
        if (held) held.at = heldAt(tile);
        return;
    }
  }

  function onMove(e: PointerEvent): void {
    if (!on || e.isPrimary === false) return;
    const screen = local(e);
    pointer = { screen, inside: true };
    if (!gesture && e.pointerType === "mouse") hover = pieceAt(shapes(), tileOf(screen));
    track(screen);
  }

  function onUp(e: PointerEvent): void {
    if (!on || e.isPrimary === false) return;
    const g = gesture;
    gesture = null;
    if (e.pointerType !== "mouse") pointer = null;
    if (!g) return;
    switch (g.kind) {
      case "press":
        selection = toggleSelect(selection, g.id, g.add);
        d.sfx("ui_tab");
        return;
      case "drag": {
        d.dim(new Set());
        const pieces = pick(g.ids);
        const moves = groupMoves(pieces, g.delta);
        if (pieces.length > 0 && !isNoop(pieces, moves)) sendMoves(moves);
        return;
      }
      case "box": {
        const s = boxBetween(d.tileToScreen(g.start.x, g.start.y), d.tileToScreen(g.end.x, g.end.y));
        if (s.w < DRAG_PX.mouse && s.h < DRAG_PX.mouse && !g.add) selection = [];
        return;
      }
      case "place":
        return placeHeld();
      case "pan":
        return;
    }
  }

  function onCancel(): void {
    gesture = null;
    d.dim(new Set());
  }

  function onLeave(e: PointerEvent): void {
    if (e.pointerType === "mouse" && !gesture) {
      hover = null;
      pointer = null;
    }
  }

  // ------------------------------------------------------------------ keys

  function onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    // T only means something in your own house (elsewhere it stays free for other things).
    if (e.code === "KeyT" && (on || d.available())) {
      e.preventDefault();
      return toggle();
    }
    if (!on) return;
    if (e.code === "Delete" || e.code === "Backspace") {
      e.preventDefault();
      pickUp();
    }
  }

  function toggle(): void {
    if (on) exit();
    else enter();
  }

  // ------------------------------------------------------------------ drawing

  function viewTiles(): { w: number; h: number } {
    const v = d.viewport();
    return { w: v.w / TILE, h: v.h / TILE };
  }

  function ghosts(): EditGhost[] {
    const g = gesture;
    const out: EditGhost[] = [];
    if (g?.kind === "drag") out.push(...dragGhosts(world(), pick(g.ids), g.delta));
    else if (pending && performance.now() - pending.at < PENDING_MS) out.push(...pendingGhosts(objs(), pending.moves));
    const h = held ? heldGhost(world(), held) : null;
    if (h) out.push(h);
    return out;
  }

  function placeToolbar(sel: PieceShape[]): void {
    const g = gesture;
    const busy = g?.kind === "drag" || g?.kind === "box" || g?.kind === "pan";
    const state = toolbarState(held?.at ? held : null, pick(sel.map((s) => s.id)));
    const rect = unionRect(sel.map((s) => s.art));
    if (!state || busy || (!state.holding && !rect)) {
      d.ui.setToolbar(null);
      return;
    }
    const key = `${state.count}|${state.holding}|${state.canTurn}|${state.name ?? ""}`;
    if (key !== toolbarKey) {
      toolbarKey = key;
      toolbarSize = d.ui.toolbarSize(state);
    }
    // A held piece's toolbar docks above the tray (the UI ignores the spot), so it doesn't chase the ghost.
    if (state.holding || !rect) return d.ui.setToolbar({ x: 0, y: 0 }, state);
    const a = d.tileToScreen(rect.x, rect.y);
    const b = d.tileToScreen(rect.x + rect.w, rect.y + rect.h);
    const v = d.viewport();
    // A selection panned out of view takes its toolbar with it.
    if (b.x < 0 || b.y < 0 || a.x > v.w || a.y > v.h) return d.ui.setToolbar(null);
    d.ui.setToolbar(toolbarSpot({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, toolbarSize, v, 8), state);
  }

  function draw(): void {
    if (!on || !view) return;
    const all = shapes();
    const sel = all.filter((s) => selection.includes(s.id));
    const g = gesture;
    const dragging = g?.kind === "drag";
    const hoverShape = !dragging && hover && !selection.includes(hover) ? (all.find((s) => s.id === hover) ?? null) : null;
    view.draw(
      {
        hover: hoverShape?.art ?? null,
        selected: dragging ? [] : sel.map((s) => ({ art: s.art, foot: s.foot })),
        ghosts: ghosts(),
        box: g?.kind === "box" ? boxBetween(g.start, g.end) : null,
      },
      d.map(),
    );
    placeToolbar(dragging ? [] : sel);
    d.canvas.style.cursor = dragging ? "grabbing" : hover || held ? "grab" : "";
  }

  function refresh(): void {
    d.ui.setAvailable(d.available());
    if (on && !d.available()) return exit();
    if (!on) return;
    const ids = new Set(objs().map((o) => o.id));
    selection = selection.filter((id) => ids.has(id));
    if (hover && !ids.has(hover)) hover = null;
    // The answer to a move came in as objects: drop its ghosts.
    if (pending && pending.moves.every((m) => {
      const o = objs().find((x) => x.id === m.id);
      return !o || (o.x === m.x && o.y === m.y && o.rotation === m.rotation);
    })) pending = null;
    // The last of a stack just went down: nothing left to hold.
    if (held) {
      const s = d.inventory().slots[held.slot];
      if (!s || s.item !== held.item) held = null;
    }
    const map = d.map();
    const indoor = !!map?.floorArea && map.ambient === "indoor";
    d.ui.setTray(trayEntries(d.inventory(), indoor), held?.slot ?? null);
  }

  // ------------------------------------------------------------------ wiring

  d.canvas.addEventListener("pointerdown", onDown);
  d.canvas.addEventListener("pointermove", onMove);
  d.canvas.addEventListener("pointerup", onUp);
  d.canvas.addEventListener("pointercancel", onCancel);
  d.canvas.addEventListener("pointerleave", onLeave);
  window.addEventListener("keydown", onKey);

  const api: EditMode = {
    active: () => on,
    toggle,
    exit,
    action(a) {
      if (a === "rotate" || a === "rotateBack") rotate(a === "rotate" ? 1 : -1);
      else if (a === "cancel") cancel();
    },
    pan(dir) {
      panDir = dir;
    },
    focus: () => (on ? focusAt : null),
    update(dtMs) {
      if (!on) return;
      const map = d.map();
      const dt = Math.min(dtMs, 100) / 1000;
      let mx = panDir.dx;
      let my = panDir.dy;
      const g = gesture;
      if (pointer && (g?.kind === "drag" || g?.kind === "box" || g?.kind === "place")) {
        const e = edgeScroll(pointer.screen, d.viewport());
        mx += e.x;
        my += e.y;
      }
      if ((mx || my) && map) {
        focusAt = clampFocus({ x: focusAt.x + Math.sign(mx) * PAN_SPEED * dt, y: focusAt.y + Math.sign(my) * PAN_SPEED * dt }, map, viewTiles());
        if (pointer && g && g.kind !== "pan") track(pointer.screen);
      }
      draw();
    },
    refresh,
    rejected(req) {
      if (pending && (!req || pending.req === req)) pending = null;
    },
    hold,
    pickUp,
    setMulti(v) {
      multi = v;
      d.ui.setMulti(v);
    },
    destroy() {
      exit();
      d.canvas.removeEventListener("pointerdown", onDown);
      d.canvas.removeEventListener("pointermove", onMove);
      d.canvas.removeEventListener("pointerup", onUp);
      d.canvas.removeEventListener("pointercancel", onCancel);
      d.canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKey);
    },
  };
  return api;
}

