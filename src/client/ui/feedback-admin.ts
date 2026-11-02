// Admin review of player feedback (#feedback-review): newest first, filter by status, load more,
// mark seen / resolved, and view a screenshot (admin-only route). Every report string is
// untrusted player text: textContent only. The server re-checks admin rights on every call.
import { FEEDBACK_STATUSES, screenshotUrl, type FeedbackItem, type FeedbackStatus } from "../../shared/feedback";
import { timeAgo } from "../../shared/notices";
import { listFeedback, setFeedbackStatus } from "./feedback-api";
import { metaLine } from "./feedback-form-logic";
import { uiSound } from "./sound";

export interface FeedbackReview {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Closes the screenshot viewer if it is up; true when it was. */
  closeTop(): boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function add(parent: Node, ...kids: Node[]): void {
  for (const k of kids) parent.appendChild(k);
}

function btn(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", `dm-btn dm-btn-small ${className}`.trim(), text);
  b.type = "button";
  b.addEventListener("pointerenter", () => uiSound("hover"));
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (b.disabled) return;
    uiSound("click");
    onClick();
  });
  return b;
}

const CATEGORY_LABEL = { bug: "Bug", idea: "Idea", other: "Other" } as const;
const STATUS_LABEL: Record<FeedbackStatus, string> = { new: "New", seen: "Seen", resolved: "Resolved" };

export function createFeedbackReview(root: HTMLElement, opts: { onClose?(): void } = {}): FeedbackReview {
  const backdrop = el("div", "dm-dialog fb-review-backdrop");
  backdrop.hidden = true;
  const panel = el("div", "dm-panel fb-review");
  panel.id = "feedback-review";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Player feedback");
  const head = el("div", "dm-panel-header");
  const filter = el("select", "dm-input fb-review-filter");
  filter.id = "feedback-review-filter";
  filter.setAttribute("aria-label", "Show");
  for (const v of ["", ...FEEDBACK_STATUSES]) {
    const o = el("option", "", v ? STATUS_LABEL[v as FeedbackStatus] : "All");
    o.value = v;
    filter.appendChild(o);
  }
  filter.value = "new";
  filter.addEventListener("change", () => void reload());
  const closeBtn = btn("✕", "dm-close", () => close());
  closeBtn.classList.remove("dm-btn", "dm-btn-small");
  closeBtn.setAttribute("aria-label", "Close");
  const right = el("div", "fb-review-head-right");
  add(right, filter, closeBtn);
  add(head, el("span", "dm-title", "Player feedback"), right);
  const list = el("div", "fb-review-list");
  list.id = "feedback-review-list";
  const status = el("p", "dm-muted fb-review-status");
  const more = btn("Load more", "fb-review-more", () => void load());
  more.id = "feedback-review-more";
  add(panel, head, list, status, more);
  backdrop.appendChild(panel);
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });

  // Screenshot viewer: a plain <img> from the admin-only route (never inserted as markup).
  const viewer = el("div", "dm-dialog fb-viewer");
  viewer.id = "feedback-viewer";
  viewer.hidden = true;
  const viewerPanel = el("div", "dm-panel fb-viewer-panel");
  const viewerImg = el("img", "fb-viewer-img");
  viewerImg.alt = "Screenshot sent with the report";
  viewerImg.referrerPolicy = "no-referrer";
  const viewerClose = btn("Close", "", () => closeViewer());
  add(viewerPanel, viewerImg, viewerClose);
  viewer.appendChild(viewerPanel);
  viewer.addEventListener("pointerdown", (e) => {
    if (e.target === viewer) closeViewer();
  });
  add(root, backdrop, viewer);

  let next: string | null = null;
  let loading = false;
  let gen = 0;

  function closeViewer(): void {
    viewer.hidden = true;
    viewerImg.removeAttribute("src");
  }

  function row(f: FeedbackItem): HTMLElement {
    const item = el("article", `fb-item is-${f.status}`);
    item.dataset.id = f.id;
    const top = el("div", "fb-item-top");
    const cat = el("span", `fb-cat fb-cat-${f.category}`, CATEGORY_LABEL[f.category]);
    const who = el("span", "fb-item-who", f.guest ? `${f.userName} (guest)` : f.userName);
    const when = el("time", "fb-item-when", timeAgo(f.createdAt, Date.now()));
    when.dateTime = new Date(f.createdAt).toISOString();
    when.title = new Date(f.createdAt).toLocaleString();
    const badge = el("span", `fb-status fb-status-${f.status}`, STATUS_LABEL[f.status]);
    add(top, cat, who, when, badge);
    const msg = el("p", "fb-item-msg", f.message);
    const meta = el("p", "fb-item-meta dm-muted", metaLine(f));
    if (f.userAgent) meta.title = f.userAgent;
    const actions = el("div", "fb-item-actions");
    if (f.hasScreenshot) {
      const shot = btn("Screenshot", "fb-item-shot", () => {
        viewerImg.src = screenshotUrl(f.id);
        viewer.hidden = false;
      });
      actions.appendChild(shot);
    }
    const spacer = el("span", "fb-spacer");
    actions.appendChild(spacer);
    const mark = (to: FeedbackStatus, label: string): HTMLButtonElement => {
      const b = btn(label, to === "resolved" ? "dm-btn-primary" : "", async () => {
        b.disabled = true;
        const r = await setFeedbackStatus(f.id, to);
        if (!r.ok) {
          b.disabled = false;
          status.textContent = r.error;
          return;
        }
        f.status = to;
        item.replaceWith(row(f));
      });
      b.dataset.status = to;
      return b;
    };
    if (f.status === "new") actions.appendChild(mark("seen", "Mark seen"));
    if (f.status !== "resolved") actions.appendChild(mark("resolved", "Resolve"));
    else actions.appendChild(mark("new", "Reopen"));
    add(item, top, msg);
    if (meta.textContent) item.appendChild(meta);
    item.appendChild(actions);
    return item;
  }

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    const mine = gen;
    more.disabled = true;
    status.textContent = "Loading…";
    const r = await listFeedback(next, (filter.value || null) as FeedbackStatus | null);
    loading = false;
    if (mine !== gen) return;
    if (!r.ok) {
      status.textContent = r.status === 403 ? "Only admins can read feedback." : r.error;
      more.hidden = true;
      return;
    }
    for (const f of r.value.items) list.appendChild(row(f));
    next = r.value.next;
    more.hidden = !next;
    more.disabled = false;
    status.textContent = list.childElementCount === 0 ? "Nothing here. All caught up!" : "";
  }

  async function reload(): Promise<void> {
    gen++;
    loading = false;
    next = null;
    list.replaceChildren();
    await load();
  }

  function close(): void {
    if (backdrop.hidden) return;
    closeViewer();
    backdrop.hidden = true;
    uiSound("close");
    opts.onClose?.();
  }

  return {
    open() {
      backdrop.hidden = false;
      uiSound("open");
      void reload();
    },
    close,
    isOpen: () => !backdrop.hidden,
    closeTop() {
      if (viewer.hidden) return false;
      closeViewer();
      return true;
    },
  };
}
