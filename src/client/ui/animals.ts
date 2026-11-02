// The animal card: opens when you click a cat, dog or hen. Name, hearts with you, today's care and
// the Pet / Feed / Adopt buttons. Feed offers the item selected in your hotbar. Every text goes in
// with textContent only (names come from the server's fixed list, but stay text anyway).
import { ANIMAL_CARE_REACH, type AnimalView } from "../../shared/animals";
import { animalButtons, animalStatus, speciesLabel } from "./animals-logic";
import "./styles/animals.css";

const RANGE_CHECK_MS = 400;
/** Close the card once you are further than the server accepts care from. */
const CLOSE_RANGE = ANIMAL_CARE_REACH;

export interface AnimalCardOpts {
  pet(entity: string): void;
  feed(entity: string): void;
  adopt(entity: string): void;
  /** Name of the selected item when this species eats it, else null (Feed then asks for food). */
  feedItem(species: AnimalView["species"]): string | null;
  distance(entity: string): number | null;
}

export interface AnimalCard {
  /** A fresh view from the server; `open` (you clicked the animal or adopted it) shows the card. */
  show(view: AnimalView, open: boolean): void;
  close(): void;
  isOpen(): boolean;
  /** The hotbar selection changed: relabel Feed. */
  refresh(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function put(parent: Node, ...kids: Node[]): void {
  for (const k of kids) parent.appendChild(k);
}

export function createAnimalCard(root: HTMLElement, opts: AnimalCardOpts): AnimalCard {
  const win = el("section", "dm-panel animal-card");
  win.id = "animal-card";
  win.hidden = true;
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-labelledby", "animal-card-name");

  const head = el("header", "animal-card-head");
  const name = el("h2", "animal-card-name");
  name.id = "animal-card-name";
  const kind = el("span", "animal-card-kind dm-muted");
  const close = el("button", "dm-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => api.close());
  put(head, name, kind, close);

  const hearts = el("div", "bond-hearts animal-card-hearts");
  hearts.id = "animal-card-hearts";
  const blurb = el("p", "animal-card-blurb");
  const status = el("p", "animal-card-status dm-muted");
  const buttons = el("div", "animal-card-buttons");
  const pet = el("button", "dm-btn", "Pet");
  pet.id = "animal-pet";
  const feed = el("button", "dm-btn", "Feed");
  feed.id = "animal-feed";
  const adopt = el("button", "dm-btn dm-btn-primary animal-card-adopt", "Adopt");
  adopt.id = "animal-adopt";
  for (const b of [pet, feed, adopt]) b.type = "button";
  put(buttons, pet, feed, adopt);
  put(win, head, hearts, blurb, status, buttons);
  root.appendChild(win);

  let view: AnimalView | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  pet.addEventListener("click", () => view && opts.pet(view.entity));
  feed.addEventListener("click", () => view && opts.feed(view.entity));
  adopt.addEventListener("click", () => view && opts.adopt(view.entity));

  function render(v: AnimalView): void {
    name.textContent = v.name || "Hen";
    kind.textContent = speciesLabel(v);
    hearts.replaceChildren(
      ...Array.from({ length: v.maxHearts }, (_, i) => el("span", `bond-heart ${i < v.hearts ? "full" : "empty"}`)),
    );
    hearts.setAttribute("aria-label", `${v.hearts} of ${v.maxHearts} hearts`);
    blurb.textContent = v.blurb ?? "";
    blurb.hidden = !v.blurb;
    status.textContent = animalStatus(v);
    const b = animalButtons(v);
    feed.hidden = !b.feed;
    adopt.hidden = !b.adopt;
    adopt.textContent = `Adopt ${v.name}`;
    relabelFeed();
  }

  function relabelFeed(): void {
    const item = view ? opts.feedItem(view.species) : null;
    feed.textContent = item ? `Feed ${item}` : "Feed (select food)";
    feed.disabled = !item;
  }

  const api: AnimalCard = {
    show(v, open) {
      const same = view?.entity === v.entity;
      if (!open && (win.hidden || !same)) return;
      view = v;
      render(v);
      if (!win.hidden) return;
      win.hidden = false;
      timer = setInterval(() => {
        const d = view ? opts.distance(view.entity) : null;
        if (d === null || d > CLOSE_RANGE) api.close();
      }, RANGE_CHECK_MS);
    },
    close() {
      win.hidden = true;
      view = null;
      if (timer) clearInterval(timer);
      timer = null;
    },
    isOpen: () => !win.hidden,
    refresh() {
      if (view) relabelFeed();
    },
  };
  return api;
}
