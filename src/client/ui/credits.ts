// Credits dialog: art and audio attributions read from the CREDITS markdown files that ship in
// /assets. Opened from the start screen and the HUD menu. Everything is rendered with textContent.
import { CREDIT_FILES, allAuthors, parseCredits, type CreditDoc, type CreditEntry } from "./credits-logic";
import { uiSound } from "./sound";
import "./styles/credits.css";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function add(parent: Node, ...kids: Node[]): void {
  for (const k of kids) parent.appendChild(k);
}

let docsPending: Promise<(CreditDoc | null)[]> | null = null;
function loadDocs(): Promise<(CreditDoc | null)[]> {
  docsPending ??= Promise.all(
    CREDIT_FILES.map(async (path) => {
      try {
        const res = await fetch(path);
        if (!res.ok) return null;
        return parseCredits(await res.text());
      } catch {
        return null;
      }
    }),
  );
  return docsPending;
}

function entryItem(e: CreditEntry): HTMLLIElement {
  const li = el("li", "credits-entry");
  add(li, el("span", "credits-name", e.name));
  if (e.authors.length) add(li, el("span", "credits-authors", ` by ${e.authors.join(", ")}`));
  if (e.licenses.length) add(li, el("span", "credits-license", e.licenses.join(" · ")));
  if (e.shareAlike) {
    const sa = el("span", "credits-sa", "Share-alike");
    sa.title = "Licensed CC-BY-SA: adaptations of this file must keep the same licence";
    add(li, sa);
  }
  return li;
}

function render(body: HTMLElement, docs: (CreditDoc | null)[]): void {
  while (body.firstChild) body.removeChild(body.firstChild);
  const loaded = docs.filter((d): d is CreditDoc => d !== null);

  const notices = loaded.flatMap((d) => d.groups.flatMap((g) => g.notices));
  if (notices.length) {
    add(body, el("h3", "credits-h", "Required attributions"));
    const box = el("div", "credits-notices");
    for (const n of notices) add(box, el("p", "credits-notice", n));
    add(body, box);
  }

  const authors = allAuthors(loaded);
  if (authors.length) {
    add(body, el("h3", "credits-h", "Artists and composers"));
    add(body, el("p", "credits-artists", authors.join(", ")));
  }

  for (const d of loaded) {
    add(body, el("h3", "credits-h", d.title));
    if (d.summary) add(body, el("p", "dm-muted credits-summary", d.summary));
    for (const g of d.groups) {
      if (!g.entries.length) continue;
      if (g.title !== d.title) add(body, el("h4", "credits-group", g.title));
      const ul = el("ul", "credits-list");
      for (const e of g.entries) add(ul, entryItem(e));
      add(body, ul);
    }
  }

  if (loaded.length < docs.length) add(body, el("p", "dm-muted", "Some credit files couldn't be loaded. Try again later."));

}

let openDialog: { close(): void } | null = null;

/** Open the credits dialog (once at a time). Returns a function that closes it. */
export function openCredits(): () => void {
  if (openDialog) return openDialog.close;
  uiSound("open");
  const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const backdrop = el("div", "dm-dialog credits-dialog");
  const panel = el("div", "dm-panel credits-panel");
  panel.id = "credits-dialog";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "credits-title");
  const title = el("h2", "dm-title", "Credits");
  title.id = "credits-title";
  const closeBtn = el("button", "dm-close", "×");
  closeBtn.type = "button";
  closeBtn.id = "credits-close";
  closeBtn.setAttribute("aria-label", "Close credits");
  const header = el("div", "dm-panel-header");
  add(header, title, closeBtn);
  const body = el("div", "credits-body");
  body.tabIndex = 0;
  add(
    body,
    el("p", "credits-intro", "DurableMMO is built with free art and sound shared by these creators. Thank you!"),
    el("p", "dm-muted", "Loading credits…"),
  );
  add(panel, header, body);
  add(backdrop, panel);
  document.body.appendChild(backdrop);

  const close = (): void => {
    if (!backdrop.isConnected) return;
    uiSound("close");
    backdrop.remove();
    document.removeEventListener("keydown", onKey, true);
    openDialog = null;
    prevFocus?.focus();
  };
  // Capture phase so game and HUD shortcuts don't fire while the dialog is open.
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
    ev.stopPropagation();
  };
  document.addEventListener("keydown", onKey, true);
  closeBtn.addEventListener("pointerenter", () => uiSound("hover"));
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) close();
  });
  // Keep clicks inside the dialog from reaching the game canvas handlers.
  panel.addEventListener("click", (ev) => ev.stopPropagation());
  closeBtn.focus();

  void loadDocs().then((docs) => {
    if (!backdrop.isConnected) return;
    const intro = body.firstChild;
    render(body, docs);
    if (intro) body.insertBefore(intro, body.firstChild);
  });

  openDialog = { close };
  return close;
}
