// The HUD's feedback button (#hud-feedback, bottom-right, a ladybird) and its form
// (#feedback-panel): category, message with a counter, an optional screenshot of a dragged area,
// and Send. Admins also get "Review" (ui/feedback-admin.ts). Keys typed in the form never reach
// the game, and Esc closes the topmost piece.
import { FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_MAX, cleanFeedbackMessage, type FeedbackCategory } from "../../shared/feedback";
import { submitFeedback } from "./feedback-api";
import { createFeedbackReview, type FeedbackReview } from "./feedback-admin";
import { pickArea, type AreaPicker } from "./feedback-capture";
import { formState, viewportText } from "./feedback-form-logic";
import { captureWholeView, cropAndEncode, warmCapture, type EncodedShot } from "./feedback-shot";
import { menuIcon } from "./menu-icons";
import { uiSound } from "./sound";
import type { GameApi } from "./index";
import "./styles/feedback.css";

export interface FeedbackUi {
  setAdmin(on: boolean): void;
  close(): void;
  isOpen(): boolean;
}

/** Marks the feedback UI so the screenshot leaves it out. */
export const FEEDBACK_SKIP_CLASS = "fb-skip";

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

const CATEGORY_TEXT: Record<FeedbackCategory, string> = { bug: "Bug", idea: "Idea", other: "Other" };
const PLACEHOLDER: Record<FeedbackCategory, string> = {
  bug: "What happened? What did you expect instead?",
  idea: "What would make Mossbrook better?",
  other: "Tell us anything.",
};

export function createFeedback(
  hud: HTMLElement,
  ui: HTMLElement,
  game: Pick<GameApi, "setTyping" | "captureView" | "feedbackContext">,
  notice: (text: string, kind: "info" | "error") => void,
): FeedbackUi {
  const layer = el("div", `hud-layer hud-layer-feedback ${FEEDBACK_SKIP_CLASS}`);
  hud.appendChild(layer);

  const open = el("button", "dm-btn hud-feedback-btn");
  open.type = "button";
  open.id = "hud-feedback";
  open.appendChild(menuIcon("bug"));
  open.setAttribute("aria-label", "Send feedback");
  open.title = "Send feedback or report a bug";
  open.setAttribute("aria-haspopup", "dialog");
  open.setAttribute("aria-expanded", "false");
  open.addEventListener("pointerenter", () => uiSound("hover"));
  open.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panel.hidden) show();
    else close();
  });

  const panel = el("div", "dm-panel fb-panel");
  panel.id = "feedback-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Send feedback");
  const head = el("div", "dm-panel-header");
  const review = btn("Review", "fb-review-open", () => {
    reviewUi.open();
  });
  review.id = "feedback-review-open";
  review.title = "Admin: read player feedback";
  review.hidden = true;
  const closeBtn = el("button", "dm-close", "✕");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });
  const headRight = el("div", "fb-head-right");
  add(headRight, review, closeBtn);
  add(head, el("span", "dm-title", "Send feedback"), headRight);

  const cats = el("div", "fb-cats");
  cats.setAttribute("role", "radiogroup");
  cats.setAttribute("aria-label", "Kind of feedback");
  let category: FeedbackCategory = "bug";
  const catBtns = FEEDBACK_CATEGORIES.map((c) => {
    const b = btn(CATEGORY_TEXT[c], `fb-kind fb-kind-${c}`, () => setCategory(c));
    b.id = `feedback-cat-${c}`;
    b.setAttribute("role", "radio");
    return b;
  });
  add(cats, ...catBtns);

  const text = el("textarea", "fb-text");
  text.id = "feedback-message";
  text.rows = 5;
  // The DOM cap counts UTF-16 units; the counter and the server count code points.
  text.maxLength = FEEDBACK_MESSAGE_MAX * 2;
  text.setAttribute("aria-label", "Your feedback");
  const counter = el("span", "fb-counter");
  counter.id = "feedback-counter";
  counter.setAttribute("aria-live", "polite");

  const shotRow = el("div", "fb-shot");
  const addShot = btn("Add screenshot", "fb-shot-add", () => void startCapture());
  addShot.id = "feedback-shot-add";
  const shotHint = el("span", "dm-muted fb-shot-hint", "Optional: drag over the screen");
  const thumb = el("img", "fb-thumb");
  thumb.id = "feedback-thumb";
  thumb.alt = "Your screenshot";
  const retake = btn("Retake", "", () => void startCapture());
  retake.id = "feedback-shot-retake";
  const remove = btn("Remove", "", () => setShot(null));
  remove.id = "feedback-shot-remove";
  const shotActions = el("div", "fb-shot-actions");
  add(shotActions, retake, remove);
  const shotSize = el("span", "dm-muted fb-shot-size");
  shotActions.appendChild(shotSize);
  add(shotRow, addShot, shotHint, thumb, shotActions);

  const error = el("p", "fb-error");
  error.id = "feedback-error";
  error.setAttribute("role", "alert");
  const send = btn("Send", "dm-btn-primary fb-send", () => void submit());
  send.id = "feedback-send";
  const foot = el("div", "fb-foot");
  add(foot, el("span", "dm-muted fb-note", "Sent with your name, where you are and your browser."), send);
  const textRow = el("div", "fb-text-row");
  add(textRow, text, counter);
  add(panel, head, cats, textRow, shotRow, error, foot);
  add(layer, open, panel);

  const busy = el("div", "dm-panel fb-busy", "Taking a screenshot…");
  busy.setAttribute("role", "status");
  layer.appendChild(busy);

  const reviewUi: FeedbackReview = createFeedbackReview(layer);

  let shot: EncodedShot | null = null;
  let thumbUrl: string | null = null;
  let sending = false;
  let capturing = false;
  let picker: AreaPicker | null = null;

  function setCategory(c: FeedbackCategory): void {
    category = c;
    for (const [i, b] of catBtns.entries()) {
      const on = FEEDBACK_CATEGORIES[i] === c;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", String(on));
    }
    text.placeholder = PLACEHOLDER[c];
  }

  function setShot(next: EncodedShot | null): void {
    shot = next;
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = next ? URL.createObjectURL(next.blob) : null;
    if (thumbUrl) thumb.src = thumbUrl;
    else thumb.removeAttribute("src");
    shotSize.textContent = next ? `${next.width}×${next.height} · ${Math.max(1, Math.round(next.blob.size / 1024))} KB` : "";
    shotRow.classList.toggle("has-shot", !!next);
  }

  function render(): void {
    const s = formState(text.value, sending);
    counter.textContent = s.counter;
    counter.classList.toggle("is-warn", s.warn);
    send.disabled = !s.canSend || capturing;
    send.textContent = sending ? "Sending…" : "Send";
    addShot.disabled = capturing || sending;
    addShot.textContent = capturing ? "Capturing…" : "Add screenshot";
  }
  text.addEventListener("input", () => {
    error.textContent = "";
    render();
  });

  // Keys aimed at the form stay in the form: the game, chat and menu shortcuts never see them.
  panel.addEventListener("focusin", () => game.setTyping(true));
  panel.addEventListener("focusout", (e) => {
    if (!panel.contains(e.relatedTarget as Node | null)) game.setTyping(false);
  });
  const onKey = (e: KeyboardEvent): void => {
    // The HUD is rebuilt on sign-in: a detached copy lets go of the window.
    if (!layer.isConnected) return window.removeEventListener("keydown", onKey, true);
    if (picker) return; // the picker has its own keys
    const inside = e.target instanceof Node && (panel.contains(e.target) || layer.contains(e.target));
    if (e.key === "Escape" && (inside || !panel.hidden || reviewUi.isOpen())) {
      e.preventDefault();
      e.stopPropagation();
      if (reviewUi.closeTop()) return;
      if (reviewUi.isOpen()) return reviewUi.close();
      close();
      return;
    }
    if (inside) e.stopPropagation();
  };
  window.addEventListener("keydown", onKey, true);

  function show(): void {
    if (!panel.hidden) return;
    panel.hidden = false;
    open.setAttribute("aria-expanded", "true");
    open.classList.add("is-open");
    uiSound("open");
    render();
    text.focus();
    warmCapture(ui);
  }

  function close(): void {
    picker?.cancel();
    reviewUi.close();
    if (panel.hidden) return;
    panel.hidden = true;
    open.setAttribute("aria-expanded", "false");
    open.classList.remove("is-open");
    game.setTyping(false);
    uiSound("close");
  }

  async function startCapture(): Promise<void> {
    if (capturing) return;
    capturing = true;
    error.textContent = "";
    render();
    // Hide the form first and let a frame pass, so the view is captured as the player sees it
    // (the feedback layer is left out of the capture; only the "Taking a screenshot" pill shows).
    layer.classList.add("is-capturing");
    game.setTyping(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const gameCanvas = document.querySelector<HTMLCanvasElement>("#game canvas");
    const view = await captureWholeView({
      game: () => game.captureView?.() ?? null,
      gameRect: () => gameCanvas?.getBoundingClientRect() ?? null,
      ui,
      skip: (n) => n instanceof Element && n.classList.contains(FEEDBACK_SKIP_CLASS),
    });
    layer.classList.remove("is-capturing");
    picker = pickArea(document.body, view);
    const area = await picker.done;
    picker = null;
    if (area) {
      const encoded = await cropAndEncode(view, area);
      if (encoded) setShot(encoded);
      else error.textContent = "That screenshot is too big to send. Try a smaller area.";
    }
    capturing = false;
    render();
    if (!panel.hidden) (shot ? send : addShot).focus();
    else game.setTyping(false);
  }

  async function submit(): Promise<void> {
    const message = cleanFeedbackMessage(text.value);
    if (!message || sending) return;
    sending = true;
    error.textContent = "";
    render();
    const ctx = game.feedbackContext?.() ?? null;
    const r = await submitFeedback({
      category,
      message,
      screenshot: shot?.blob ?? null,
      info: {
        ...(ctx?.zone ? { zone: ctx.zone } : {}),
        ...(ctx && ctx.x !== null ? { x: ctx.x } : {}),
        ...(ctx && ctx.y !== null ? { y: ctx.y } : {}),
        ...(ctx ? { renderer: ctx.renderer } : {}),
        viewport: viewportText(window.innerWidth, window.innerHeight, window.devicePixelRatio),
        userAgent: navigator.userAgent.slice(0, 256),
      },
    });
    sending = false;
    if (!r.ok) {
      uiSound("error");
      error.textContent = r.error;
      render();
      return;
    }
    uiSound("confirm");
    text.value = "";
    setShot(null);
    setCategory("bug");
    close();
    notice("Thanks! Your feedback was sent.", "info");
  }

  setCategory("bug");
  render();

  return {
    setAdmin(on) {
      review.hidden = !on;
      layer.classList.toggle("is-admin", on);
    },
    close,
    isOpen: () => !panel.hidden || reviewUi.isOpen(),
  };
}
