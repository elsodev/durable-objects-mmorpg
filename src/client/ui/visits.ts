// Home visits UI: the invite card (Accept / Decline), the "Visiting X's home" banner with Leave,
// and the owner's visitor list with Kick buttons. DOM only; every text goes through textContent.
import type { InviteNotice, VisitorEntry } from "../../shared/visits";
import { uiSound } from "./sound";
import { inviteText, mergeInvites, visitorsTitle } from "./visits-logic";
import "./styles/visits.css";

export interface VisitsUiOpts {
  accept(invite: InviteNotice): void;
  decline(invite: InviteNotice): void;
  kick(visitor: VisitorEntry): void;
  leave(): void;
  now(): number;
}

export interface VisitsUi {
  /** Invites from the socket ({t:"invites"}) or the social push ({t:"invite"}); untrusted shapes are dropped. */
  addInvites(list: readonly unknown[]): void;
  removeInvite(fromId: string): void;
  /** Owner at home: who is visiting. Hidden while empty. */
  setVisitors(list: readonly VisitorEntry[], max: number): void;
  /** You are visiting `ownerName` (null: you're not visiting). */
  setVisiting(ownerName: string | null): void;
  /** Leaving home hides the owner's visitor list. */
  setAtHome(atHome: boolean): void;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(text: string, className: string, onClick: () => void, id?: string): HTMLButtonElement {
  const b = el("button", className, text);
  b.type = "button";
  if (id) b.id = id;
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    uiSound("click");
    onClick();
  });
  return b;
}

export function createVisitsUi(root: HTMLElement, opts: VisitsUiOpts): VisitsUi {
  const layer = el("div", "hud-layer visits-layer");
  root.appendChild(layer);

  // ---- invite card
  let queue: InviteNotice[] = [];
  const card = el("div", "dm-panel visit-invite");
  card.id = "visit-invite";
  card.setAttribute("role", "dialog");
  card.hidden = true;
  const cardText = el("p", "visit-invite-text");
  const actions = el("div", "visit-invite-actions");
  const take = (fn: (n: InviteNotice) => void) => () => {
    const n = queue.shift();
    render();
    if (n) fn(n);
  };
  actions.appendChild(btn("Accept", "dm-btn", take(opts.accept), "visit-accept"));
  actions.appendChild(btn("Decline", "dm-btn dm-btn-small", take(opts.decline), "visit-decline"));
  card.appendChild(cardText);
  card.appendChild(actions);
  layer.appendChild(card);

  function render(): void {
    queue = mergeInvites(queue, [], opts.now());
    const n = queue[0];
    card.hidden = !n;
    if (n) cardText.textContent = queue.length > 1 ? `${inviteText(n)} (+${queue.length - 1} more)` : inviteText(n);
  }
  const prune = setInterval(render, 5000);

  // ---- visiting banner
  const banner = el("div", "dm-panel visit-banner");
  banner.id = "visit-banner";
  banner.hidden = true;
  const bannerText = el("span", "visit-banner-text");
  banner.appendChild(bannerText);
  banner.appendChild(btn("Leave", "dm-btn dm-btn-small", () => opts.leave(), "visit-leave"));
  layer.appendChild(banner);

  // ---- owner's visitor list
  const listPanel = el("div", "dm-panel visit-list");
  listPanel.id = "visit-list";
  listPanel.hidden = true;
  const listTitle = el("div", "dm-title");
  const list = el("ul");
  listPanel.appendChild(listTitle);
  listPanel.appendChild(list);
  layer.appendChild(listPanel);
  let visitors: VisitorEntry[] = [];
  let atHome = false;

  function renderList(max: number): void {
    list.replaceChildren();
    for (const v of visitors) {
      const li = el("li");
      li.appendChild(el("span", "visit-name", v.name));
      li.appendChild(btn("Kick", "dm-btn dm-btn-small", () => opts.kick(v)));
      list.appendChild(li);
    }
    listTitle.textContent = visitorsTitle(visitors.length, max);
    listPanel.hidden = !atHome || visitors.length === 0;
  }
  let lastMax = 10;

  return {
    addInvites(incoming) {
      queue = mergeInvites(queue, incoming, opts.now());
      const shown = !card.hidden;
      render();
      if (!shown && !card.hidden) uiSound("confirm");
    },
    removeInvite(fromId) {
      queue = queue.filter((n) => n.fromId !== fromId);
      render();
    },
    setVisitors(next, max) {
      visitors = next.map((v) => ({ userId: String(v.userId), name: String(v.name).slice(0, 24) }));
      lastMax = max;
      renderList(max);
    },
    setVisiting(ownerName) {
      banner.hidden = ownerName === null;
      bannerText.textContent = ownerName === null ? "" : `Visiting ${ownerName}'s home`;
    },
    setAtHome(home) {
      atHome = home;
      if (!home) visitors = [];
      renderList(lastMax);
    },
    destroy() {
      clearInterval(prune);
      layer.remove();
    },
  };
}
