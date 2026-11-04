// window.__dmmo test hook (see contracts.ts, used by the Playwright e2e). `zone` is a live getter.
import type { ClientMsg } from "../../shared/protocol";
import type { EntityState, Inventory, ZoneId } from "../../shared/types";

export interface DebugSource {
  renderer: "webgpu" | "webgl";
  zone(): ZoneId | null;
  you(): EntityState | null;
  entities(): EntityState[];
  inventory(): Inventory;
  send(msg: ClientMsg): void;
  moveTo(x: number, y: number): void;
  /** Tile coords -> canvas pixel coords (for tests that click on things). */
  tileToScreen?(x: number, y: number): { x: number; y: number };
  /** Rocks of the current zone that are not broken (for tests that mine). */
  rocks?(): { id: string; x: number; y: number; ore: string }[];
  /** Props of the current map (trees, wells, beds...) for tests that aim tools at them. */
  props?(): { id?: string; type: string; x: number; y: number; w: number; h: number }[];
  /** Movement netcode: your corrections so far and how far behind others are drawn (ms). */
  net?(): NetDebug;
}

export interface NetDebug {
  corrections: number;
  visible: number;
  snaps: number;
  maxErr: number;
  renderDelay: number;
}

export interface DmmoDebug {
  readonly renderer: "webgpu" | "webgl";
  readonly zone: ZoneId | null;
  you(): EntityState | null;
  entities(): EntityState[];
  inventory(): Inventory;
  send(msg: ClientMsg): void;
  moveTo(x: number, y: number): void;
  teleportTo(x: number, y: number): void;
  tileToScreen?(x: number, y: number): { x: number; y: number };
  rocks?(): { id: string; x: number; y: number; ore: string }[];
  props?(): { id?: string; type: string; x: number; y: number; w: number; h: number }[];
  net?(): NetDebug;
}

declare global {
  interface Window {
    __dmmo?: DmmoDebug;
  }
}

export function installDebug(src: DebugSource | null): void {
  if (!src) {
    delete window.__dmmo;
    return;
  }
  const api = {
    renderer: src.renderer,
    you: src.you,
    entities: src.entities,
    inventory: src.inventory,
    send: src.send,
    moveTo: src.moveTo,
    teleportTo: src.moveTo,
    tileToScreen: src.tileToScreen,
    rocks: src.rocks,
    props: src.props,
    net: src.net,
  } as DmmoDebug;
  Object.defineProperty(api, "zone", { get: src.zone, enumerable: true });
  window.__dmmo = api;
}
