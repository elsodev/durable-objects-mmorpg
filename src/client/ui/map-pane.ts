// Map tab of the game menu: today's world date and the places of the valley, with where you are.
import { formatWorldDate, worldDate } from "../../shared/calendar";
import type { ZoneId } from "../../shared/types";
import { mapRows } from "./map-pane-logic";

export interface MapPane {
  el: HTMLElement;
  show(): void;
  hide(): void;
  /** Redraw (zone changed). */
  refresh(): void;
}

export function createMapPane(opts: { zone(): ZoneId | null; now?(): number }): MapPane {
  const el = document.createElement("div");
  el.id = "map-pane";
  el.className = "map-pane";
  el.hidden = true;

  function render(): void {
    const now = opts.now ? opts.now() : Date.now();
    const date = document.createElement("p");
    date.className = "map-date";
    date.textContent = formatWorldDate(worldDate(now));
    const list = document.createElement("ul");
    list.className = "map-list";
    for (const r of mapRows(opts.zone())) {
      const li = document.createElement("li");
      li.className = `map-row map-row-${r.id}${r.here ? " is-here" : ""}`;
      const name = document.createElement("span");
      name.className = "map-name";
      name.textContent = r.name;
      const desc = document.createElement("span");
      desc.className = "map-desc";
      desc.textContent = r.desc;
      li.appendChild(name);
      if (r.here) {
        const here = document.createElement("span");
        here.className = "map-here";
        here.textContent = r.inside ? `You are here (${r.inside})` : "You are here";
        li.appendChild(here);
      }
      li.appendChild(desc);
      list.appendChild(li);
    }
    el.replaceChildren(date, list);
  }

  return {
    el,
    show() {
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
