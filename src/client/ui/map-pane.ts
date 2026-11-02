// Map tab of the game menu: today's world date and a pixel-art picture of the island with a pin
// for each place. Pick a pin to read about it, then fast-travel there.
import { formatWorldDate, worldDate } from "../../shared/calendar";
import type { ZoneId } from "../../shared/types";
import { ISLAND, mapRows, travelRefusal, type MapRow, type TravelId } from "./map-pane-logic";

export interface MapPane {
  el: HTMLElement;
  show(): void;
  hide(): void;
  /** Redraw (zone changed). */
  refresh(): void;
}

export interface MapPaneOpts {
  zone(): ZoneId | null;
  now?(): number;
  /** Fast travel; without it the pane only shows the map. */
  travel?(to: TravelId): void;
}

export function createMapPane(opts: MapPaneOpts): MapPane {
  const el = document.createElement("div");
  el.id = "map-pane";
  el.className = "map-pane";
  el.hidden = true;
  let selected: TravelId | null = null;
  let lastTravel = -Infinity;
  const clock = (): number => (opts.now ? opts.now() : Date.now());

  function pinButton(r: MapRow): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `map-pin map-pin-${r.id}${r.here ? " is-here" : ""}${r.id === selected ? " is-selected" : ""}`;
    b.style.left = `${r.pin.x}%`;
    b.style.top = `${r.pin.y}%`;
    b.setAttribute("aria-label", r.here ? `${r.name} (you are here)` : r.name);
    b.setAttribute("aria-pressed", String(r.id === selected));
    const icon = document.createElement("span");
    icon.className = "map-pin-icon";
    const label = document.createElement("span");
    label.className = "map-pin-label";
    label.textContent = r.name;
    b.appendChild(icon);
    b.appendChild(label);
    b.addEventListener("click", () => {
      selected = r.id;
      render();
      el.querySelector<HTMLButtonElement>(`.map-pin-${r.id}`)?.focus({ preventScroll: true });
    });
    b.addEventListener("dblclick", () => travel(r.id));
    return b;
  }

  function travel(to: TravelId): void {
    if (!opts.travel) return;
    const now = clock();
    if (travelRefusal(to, opts.zone(), now, lastTravel)) return;
    lastTravel = now;
    opts.travel(to);
  }

  function card(r: MapRow): HTMLElement {
    const box = document.createElement("div");
    box.className = `map-card${r.here ? " is-here" : ""}`;
    const text = document.createElement("div");
    text.className = "map-card-text";
    const head = document.createElement("div");
    head.className = "map-card-head";
    const name = document.createElement("span");
    name.className = "map-name";
    name.textContent = r.name;
    head.appendChild(name);
    if (r.here) {
      const here = document.createElement("span");
      here.className = "map-here";
      here.textContent = r.inside ? `You are here (${r.inside})` : "You are here";
      head.appendChild(here);
    }
    const desc = document.createElement("p");
    desc.className = "map-desc";
    desc.textContent = r.desc;
    text.appendChild(head);
    text.appendChild(desc);
    box.appendChild(text);
    // Where you already are needs no button: the card says "You are here".
    if (opts.travel && travelRefusal(r.id, opts.zone(), Infinity, -Infinity) === null) {
      const go = document.createElement("button");
      go.type = "button";
      go.className = "dm-btn dm-btn-primary map-travel";
      go.textContent = "Travel";
      go.addEventListener("click", () => travel(r.id));
      box.appendChild(go);
    }
    return box;
  }

  function render(): void {
    const rows = mapRows(opts.zone());
    if (!selected || !rows.some((r) => r.id === selected)) selected = rows.find((r) => r.here)?.id ?? "village";
    const date = document.createElement("p");
    date.className = "map-date";
    date.textContent = formatWorldDate(worldDate(clock()));
    const island = document.createElement("div");
    island.className = "map-island";
    island.style.aspectRatio = `${ISLAND.w} / ${ISLAND.h}`;
    const img = document.createElement("img");
    img.className = "map-island-art";
    img.src = ISLAND.src;
    img.alt = "Map of the island: your farm in the west, the village in the middle, the river running south to the dock, and the quarry cliffs and cave in the east.";
    img.draggable = false;
    island.appendChild(img);
    // Pins from north to south, so a southern label draws over a northern pin.
    for (const r of [...rows].sort((a, b) => a.pin.y - b.pin.y)) island.appendChild(pinButton(r));
    const chosen = rows.find((r) => r.id === selected)!;
    el.replaceChildren(date, island, card(chosen));
  }

  return {
    el,
    show() {
      selected = null;
      render();
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
    refresh() {
      if (!el.hidden) render();
    },
  };
}
