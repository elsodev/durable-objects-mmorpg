// Notice Board panel (#notice-board-panel), opened by interacting with a notice board (village
// square or town hall; one shared board). Lists notices newest first with likes, dislikes and
// "posted 5m ago"; "Post a notice" opens a short compose box that pins one for NOTICE_COST coins.
// Every notice is untrusted player text: textContent only.
import { NOTICE_COST, NOTICE_MAX_LEN, NOTICE_TTL_MS, timeAgo, type NoticePress, type NoticeView } from "../../shared/notices";
import { applyVoteCounts, composeState, readPosts, readVoteCounts } from "./notice-board-logic";
import { thumbIcon } from "./notice-icons";
import { uiSound } from "./sound";
import "./styles/notice-board.css";

const NOTICE_TTL_DAYS = Math.round(NOTICE_TTL_MS / 86_400_000);

export interface NoticeBoardOpts {
  post(text: string): void;
  vote(id: string, press: NoticePress): void;
  remove(id: string): void;
  coins(): number;
  now(): number;
  isGuest(): boolean;
}

export interface NoticeBoardUi {
  /** The board from the zone (`notices`); opens the panel when `open`. */
  set(msg: { posts: NoticeView[]; open?: boolean; nextPostAt?: number; posted?: boolean }): void;
  /** Pushes from the social socket made by players elsewhere ("notices", "noticeVotes"). */
  social(payload: Record<string, unknown> & { t: string }): void;
  /** Coins changed: refresh the Pin button. */
  refresh(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
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
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (b.disabled) return;
    uiSound("click");
    onClick();
  });
  return b;
}

export function createNoticeBoardUi(root: HTMLElement, opts: NoticeBoardOpts): NoticeBoardUi {
  const panel = el("div", "dm-panel nb-panel");
  panel.id = "notice-board-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Notice Board");
  const head = el("div", "dm-panel-header");
  add(head, el("span", "dm-title", "Notice Board"), btn("✕", "dm-close", () => close()));

  const compose = el("div", "nb-compose");
  const openCompose = btn(`Post a notice · ${NOTICE_COST}c`, "dm-btn-primary nb-open-compose", () => setComposing(true));
  openCompose.id = "notice-post-open";
  const box = el("textarea", "nb-input");
  box.id = "notice-text";
  box.maxLength = NOTICE_MAX_LEN;
  box.rows = 3;
  box.placeholder = "Lost a hen? Selling turnips? Pin a note for the village.";
  box.setAttribute("aria-label", "Your notice");
  const left = el("span", "nb-left");
  const hint = el("p", "nb-hint");
  const pin = btn(`Pin · ${NOTICE_COST}c`, "dm-btn-primary", () => {
    const text = box.value.trim();
    if (!text) return;
    pin.disabled = true;
    opts.post(text);
  });
  pin.id = "notice-post";
  const cancel = btn("Cancel", "", () => setComposing(false));
  const actions = el("div", "nb-compose-row");
  add(actions, left, el("span", "nb-spacer"), cancel, pin);
  const form = el("div", "nb-form");
  add(form, box, actions, hint);
  add(compose, openCompose, form);

  const list = el("div", "nb-list");
  list.id = "notice-list";
  const foot = el("p", "nb-footnote", `One board for the whole village · notices last ${NOTICE_TTL_DAYS} days`);
  add(panel, head, compose, list, foot);
  root.appendChild(panel);

  let posts: NoticeView[] = [];
  let nextPostAt: number | undefined;
  let composing = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  function setComposing(on: boolean): void {
    composing = on && !opts.isGuest();
    if (!composing) box.value = "";
    renderCompose();
    if (composing) box.focus();
  }

  function renderCompose(): void {
    const s = composeState(box.value, opts.coins(), nextPostAt, opts.now(), opts.isGuest());
    openCompose.hidden = composing;
    openCompose.disabled = opts.isGuest();
    form.hidden = !composing;
    left.textContent = s.left;
    hint.textContent = s.hint;
    hint.classList.toggle("nb-hint-warn", !s.canPin && box.value.trim().length > 0);
    pin.disabled = !s.canPin;
  }

  function voteButton(p: NoticeView, press: NoticePress): HTMLButtonElement {
    const like = press === "like";
    const count = like ? p.likes : p.dislikes;
    const b = btn("", `nb-vote ${like ? "nb-like" : "nb-dislike"}`, () => opts.vote(p.id, press));
    add(b, thumbIcon(!like), el("span", "nb-count", String(count)));
    const active = p.vote === (like ? 1 : -1);
    b.setAttribute("aria-pressed", String(active));
    b.setAttribute("aria-label", `${like ? "Like" : "Dislike"} (${count})`);
    b.disabled = p.mine || opts.isGuest();
    if (p.mine) b.title = "You can't vote on your own notice.";
    return b;
  }

  function renderList(): void {
    const now = opts.now();
    list.replaceChildren();
    if (posts.length === 0) {
      list.appendChild(el("p", "nb-empty", "Nothing pinned yet. Be the first!"));
      return;
    }
    for (const p of posts) {
      const card = el("article", "nb-note");
      card.dataset.id = p.id;
      const meta = el("div", "nb-meta");
      add(meta, el("span", "nb-author", p.author), el("span", "nb-ago", `posted ${timeAgo(p.at, now)}`));
      const foot = el("div", "nb-foot");
      add(foot, voteButton(p, "like"), voteButton(p, "dislike"));
      if (p.mine) {
        foot.appendChild(el("span", "nb-spacer"));
        foot.appendChild(btn("Take down", "nb-remove", () => opts.remove(p.id)));
      }
      add(card, meta, el("p", "nb-text", p.text), foot);
      list.appendChild(card);
    }
  }

  function render(): void {
    renderCompose();
    renderList();
  }

  function open(): void {
    panel.hidden = false;
    if (!timer) timer = setInterval(() => !panel.hidden && renderList(), 30_000);
  }

  function close(): void {
    if (panel.hidden) return;
    panel.hidden = true;
    setComposing(false);
    if (box === document.activeElement) box.blur();
    if (timer) clearInterval(timer);
    timer = null;
  }

  box.addEventListener("input", () => renderCompose());
  // Keys typed into the note never reach the game or the HUD shortcuts.
  box.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") setComposing(false);
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!pin.disabled) pin.click();
    }
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !panel.hidden) close();
  };
  window.addEventListener("keydown", onKey);

  return {
    set(msg) {
      posts = readPosts(msg.posts);
      nextPostAt = typeof msg.nextPostAt === "number" ? msg.nextPostAt : undefined;
      if (msg.posted) setComposing(false);
      if (msg.open) open();
      render();
    },
    social(payload) {
      if (payload.t === "notices") {
        posts = readPosts(payload.posts);
        nextPostAt = typeof payload.nextPostAt === "number" ? payload.nextPostAt : undefined;
        if (!panel.hidden) render();
      } else if (payload.t === "noticeVotes") {
        const c = readVoteCounts(payload);
        if (!c) return;
        posts = applyVoteCounts(posts, c.id, c.likes, c.dislikes);
        if (!panel.hidden) renderList();
      }
    },
    refresh() {
      if (!panel.hidden) renderCompose();
    },
    close,
    isOpen: () => !panel.hidden,
    destroy() {
      close();
      window.removeEventListener("keydown", onKey);
      panel.remove();
    },
  };
}
