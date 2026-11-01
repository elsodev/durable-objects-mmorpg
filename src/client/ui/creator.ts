// Character creator ("Wardrobe"): live walking preview, one tab per look part, swatch buttons,
// Randomize and Save. Shown after the first sign-in (save has no look) and from the HUD menu.
// Stable ids: #creator, #creator-preview, #creator-random, #creator-save, #creator-close.
import { LOOK_OPTIONS, randomLook, sameLook, type LookPart } from "../../shared/look";
import type { Facing, Look } from "../../shared/types";
import type { LookManifest, LookOptionArt } from "../art/look-logic";
import { CREATOR_TABS, previewFrame, turnFacing, withOption } from "./creator-logic";
import { uiSound } from "./sound";
import "./styles/creator.css";

/** Preview scale: one 64 px LPC frame drawn at 4x. */
const PREVIEW_SCALE = 4;
/** Head crop (source px of a down-facing frame) for hairstyle thumbnails. */
const HEAD_CROP = { x: 16, y: 6, w: 32, h: 30 };
/** Whole-figure crop (source px of a down-facing frame) for body type thumbnails. */
const BODY_CROP = { x: 14, y: 10, w: 36, h: 54 };
/** Parts whose thumbnail is a crop of the look with that option applied, not a colour chip. */
const PICTURE_THUMBS: Partial<Record<LookPart, { crop: typeof HEAD_CROP; cls: string }>> = {
  body: { crop: BODY_CROP, cls: "creator-thumb creator-thumb-body" },
  hairStyle: { crop: HEAD_CROP, cls: "creator-thumb" },
};
const FACING_LABEL: Record<Facing, string> = { down: "Front", left: "Left", up: "Back", right: "Right" };

export interface CreatorOptions {
  initial: Look;
  /** First visit: no close button, Esc does nothing; the player has to Save. */
  firstTime: boolean;
  manifest: LookManifest | null;
  /** Composited sheet for a look (ui/compositor), or null when the layer art is missing. */
  sheet(look: Look): CanvasImageSource | null;
  onSave(look: Look): void;
  /** Told while the screen is open, so the game ignores movement keys. */
  setTyping?(typing: boolean): void;
}

export interface CreatorHandle {
  close(): void;
  /** Resolves with the saved look, or null if closed without saving. */
  done: Promise<Look | null>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, cls: string, id: string | null, sound: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", cls, label);
  b.type = "button";
  if (id) b.id = id;
  b.addEventListener("pointerenter", () => uiSound("hover"));
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    uiSound(sound);
    onClick();
  });
  return b;
}

function optionsFor(m: LookManifest | null, part: LookPart): LookOptionArt[] {
  const fromArt = m?.options[part] ?? [];
  // Only ids the server accepts; fall back to bare ids when the manifest is missing.
  return LOOK_OPTIONS[part].map((id) => fromArt.find((o) => o.id === id) ?? { id, label: id.replace(/_/g, " ") });
}

let openHandle: CreatorHandle | null = null;

export function openCreator(root: HTMLElement, opts: CreatorOptions): CreatorHandle {
  if (openHandle) return openHandle;
  let look: Look = { ...opts.initial };
  let facing: Facing = "down";
  let tab = 0;
  let raf = 0;
  let resolveDone!: (v: Look | null) => void;
  const done = new Promise<Look | null>((r) => (resolveDone = r));
  const m = opts.manifest;
  const fw = m?.frameW ?? 64;
  const fh = m?.frameH ?? 64;

  // ---- layout
  const backdrop = el("div", "dm-dialog creator-backdrop");
  backdrop.id = "creator";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-labelledby", "creator-title");
  const panel = el("div", "dm-panel creator-panel");
  const header = el("div", "dm-panel-header");
  const title = el("h2", "dm-title", opts.firstTime ? "Make your farmer" : "Wardrobe");
  title.id = "creator-title";
  header.appendChild(title);
  if (!opts.firstTime) {
    const x = button("×", "dm-close", "creator-close", "close", () => finish(null));
    x.setAttribute("aria-label", "Close");
    header.appendChild(x);
  }
  const intro = el(
    "p",
    "dm-muted creator-intro",
    opts.firstTime ? "Pick a look for your time in Mossbrook. You can change it later in the Wardrobe." : "Try something new on.",
  );

  const stage = el("div", "creator-stage");
  const preview = el("canvas", "creator-preview");
  preview.id = "creator-preview";
  preview.width = fw * PREVIEW_SCALE;
  preview.height = fh * PREVIEW_SCALE;
  preview.setAttribute("role", "img");
  const pctx = preview.getContext("2d");
  const facingLabel = el("span", "creator-facing");
  const turnLeft = button("◀", "dm-btn dm-btn-small creator-turn", "creator-turn-left", "select", () => turn(-1));
  const turnRight = button("▶", "dm-btn dm-btn-small creator-turn", "creator-turn-right", "select", () => turn(1));
  turnLeft.setAttribute("aria-label", "Turn left");
  turnRight.setAttribute("aria-label", "Turn right");
  const turnRow = el("div", "creator-turn-row");
  for (const n of [turnLeft, facingLabel, turnRight]) turnRow.appendChild(n);
  stage.appendChild(preview);
  stage.appendChild(turnRow);
  stage.appendChild(el("span", "dm-muted creator-hint", "← → to turn"));

  const tabs = el("div", "creator-tabs");
  tabs.setAttribute("role", "tablist");
  const tabBtns = CREATOR_TABS.map((t, i) => {
    const b = button(t.short ?? t.label, "creator-tab", `creator-tab-${t.part}`, "tab", () => selectTab(i));
    b.setAttribute("role", "tab");
    if (t.short) {
      b.setAttribute("aria-label", t.label);
      b.title = t.label;
    }
    tabs.appendChild(b);
    return b;
  });
  const swatches = el("div", "creator-swatches");
  swatches.setAttribute("role", "tabpanel");
  const chosen = el("div", "creator-chosen");
  const picker = el("div", "creator-picker");
  for (const n of [tabs, swatches, chosen]) picker.appendChild(n);

  const body = el("div", "creator-body");
  body.appendChild(stage);
  body.appendChild(picker);

  const footer = el("div", "creator-footer");
  const randomBtn = button("Randomize", "dm-btn", "creator-random", "select", () => {
    look = randomLook(Math.random);
    renderSwatches();
  });
  const saveBtn = button(opts.firstTime ? "Start farming" : "Save", "dm-btn dm-btn-primary", "creator-save", "confirm", () => {
    opts.onSave({ ...look });
    finish(look);
  });
  footer.appendChild(randomBtn);
  footer.appendChild(saveBtn);

  for (const n of [header, intro, body, footer]) panel.appendChild(n);
  backdrop.appendChild(panel);
  root.appendChild(backdrop);

  // ---- behaviour
  function turn(dir: 1 | -1): void {
    facing = turnFacing(facing, dir);
    facingLabel.textContent = FACING_LABEL[facing];
  }

  function selectTab(i: number): void {
    tab = i;
    tabBtns.forEach((b, j) => {
      b.classList.toggle("active", j === i);
      b.setAttribute("aria-selected", String(j === i));
      b.tabIndex = j === i ? 0 : -1;
    });
    tabBtns[i]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    renderSwatches();
  }

  function thumb(option: LookOptionArt, part: LookPart): HTMLElement {
    const pic = PICTURE_THUMBS[part];
    if (pic) {
      const { crop } = pic;
      const c = el("canvas", pic.cls);
      c.width = crop.w * 2;
      c.height = crop.h * 2;
      const src = opts.sheet({ ...look, [part]: option.id });
      const ctx = c.getContext("2d");
      const row = m?.walk.down.row ?? 2;
      if (src && ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(src, crop.x, row * fh + crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
      }
      return c;
    }
    const chip = el("span", "creator-chip");
    if (option.swatch) chip.style.background = option.swatch;
    return chip;
  }

  function renderSwatches(): void {
    const part = CREATOR_TABS[tab]!.part;
    swatches.replaceChildren();
    for (const o of optionsFor(m, part)) {
      const b = button("", "dm-slot creator-swatch", null, "select", () => {
        look = withOption(look, part, o.id);
        renderSwatches();
      });
      b.dataset.part = part;
      b.dataset.option = o.id;
      b.title = o.label;
      b.setAttribute("aria-label", o.label);
      b.setAttribute("aria-pressed", String(look[part] === o.id));
      b.appendChild(thumb(o, part));
      b.appendChild(el("span", "creator-swatch-label", o.label));
      swatches.appendChild(b);
    }
    const label = optionsFor(m, part).find((o) => o.id === look[part])?.label ?? look[part];
    chosen.textContent = `${CREATOR_TABS[tab]!.label}: ${label}`;
    preview.setAttribute("aria-label", `Your farmer, ${FACING_LABEL[facing].toLowerCase()} view`);
    saveBtn.disabled = !opts.firstTime && sameLook(look, opts.initial);
  }

  const started = performance.now();
  function draw(now: number): void {
    raf = requestAnimationFrame(draw);
    if (!pctx) return;
    pctx.clearRect(0, 0, preview.width, preview.height);
    const src = opts.sheet(look);
    if (!src || !m) return;
    const r = m.walk[facing];
    const col = (r.col ?? 0) + previewFrame(now - started, r.frames);
    pctx.imageSmoothingEnabled = false;
    pctx.drawImage(src, col * fw, r.row * fh, fw, fh, 0, 0, preview.width, preview.height);
  }

  // Capture phase on window: the game and HUD never see keys while the creator is open.
  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
    e.stopImmediatePropagation();
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      e.preventDefault();
      uiSound("select");
      turn(-1);
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      e.preventDefault();
      uiSound("select");
      turn(1);
    } else if (e.key === "Escape" && !opts.firstTime) {
      e.preventDefault();
      uiSound("close");
      finish(null);
    }
  };
  window.addEventListener("keydown", onKey, true);
  backdrop.addEventListener("pointerdown", (e) => e.stopPropagation());

  function finish(result: Look | null): void {
    if (openHandle !== handle) return;
    openHandle = null;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey, true);
    opts.setTyping?.(false);
    backdrop.remove();
    resolveDone(result ? { ...result } : null);
  }

  const handle: CreatorHandle = { close: () => finish(null), done };
  openHandle = handle;
  opts.setTyping?.(true);
  uiSound("open");
  facingLabel.textContent = FACING_LABEL[facing];
  selectTab(0);
  raf = requestAnimationFrame(draw);
  saveBtn.focus({ preventScroll: true });
  return handle;
}

export function isCreatorOpen(): boolean {
  return openHandle !== null;
}
