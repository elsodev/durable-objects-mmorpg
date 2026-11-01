// Home simulation UI: clock + day, stamina and watering can rows in the status panel, the sleep
// confirmation, the end-of-day summary, the shipping bin panel, the "going to sleep" countdown
// and the morning fade. DOM only; every text is set with textContent.
import type { DaySummary, ShipLine } from "../../shared/home";
import { getItem } from "../../shared/items";
import type { ItemId } from "../../shared/types";
import { iconFor } from "./icons";
import { uiSound } from "./sound";
import "./styles/home.css";

export interface HomeUiOpts {
  /** "Take back" in the shipping bin panel. */
  unship(): void;
  /** "Eat" button for the selected edible item. */
  eat(): void;
  /** "Move bed" in the sleep dialog: enter build mode on the bed. */
  moveBed?(): void;
  setTyping(typing: boolean): void;
  /** The shipping bin panel was closed (✕, Escape or closeBin), e.g. to shut the bin's lid. */
  onBinClose?(): void;
}

export interface HomeUi {
  /** Shows the home rows (at home) or hides them (shared zones, until setZoneStamina). */
  setAtHome(atHome: boolean): void;
  /** Visiting someone else's home: only the (host's) clock shows; stamina, water and Eat are yours, not here. */
  setVisiting?(visiting: boolean): void;
  setClock(day: number, label: string, night: boolean): void;
  setVitals(stamina: number, maxStamina: number, water: number, maxWater: number): void;
  /** Shared zones: only the stamina bar shows (mining and chopping cost it there too). */
  setZoneStamina?(stamina: number, maxStamina: number): void;
  /** Selected item if it can be eaten, else null. */
  setEdible(item: ItemId | null): void;
  setBin(items: ShipLine[], total: number, open: boolean): void;
  closeBin(): void;
  /** "Go to sleep? The day will end." Resolves "sleep", "move" or "cancel". */
  confirmSleep(): Promise<"sleep" | "move" | "cancel">;
  sleeping(host: string, endsAt: number, now: () => number): void;
  showSummary(summary: DaySummary): void;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** appendChild for several nodes (Element.append is typed oddly under the Workers types). */
function add(parent: Node, ...children: Node[]): void {
  for (const c of children) parent.appendChild(c);
}

function btn(text: string, className: string, id: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", className, text);
  b.type = "button";
  b.id = id;
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    uiSound("click");
    onClick();
  });
  return b;
}

function icon(item: ItemId): HTMLElement {
  const img = el("img", "home-icon");
  img.alt = "";
  try {
    img.src = iconFor(item);
  } catch {
    // no icon: the name still reads
  }
  return img;
}

const QUALITY = ["", "Silver", "Gold"];

export function itemLabel(item: ItemId): { name: string; quality: string } {
  const def = getItem(item);
  const base = def?.base ? getItem(def.base) : def;
  return { name: base?.name ?? item, quality: QUALITY[def?.quality ?? 0] ?? "" };
}

export function createHomeUi(root: HTMLElement, opts: HomeUiOpts): HomeUi {
  const layer = el("div", "hud-layer home-layer");
  root.appendChild(layer);

  // ---- status rows (inside the HUD status panel when it exists)
  const rows = el("div", "home-rows");
  rows.id = "home-status";
  const clockEl = el("div", "home-clock");
  clockEl.id = "home-clock";
  const dayEl = el("span", "home-day", "Day 1");
  const timeEl = el("span", "home-time", "6:00 AM");
  add(clockEl, el("span", "home-sun"), dayEl, timeEl);
  const staminaEl = el("div", "home-bar home-stamina");
  staminaEl.id = "home-stamina";
  staminaEl.title = "Stamina: tools tire you; eat crops or sleep to recover";
  const staminaFill = el("span", "home-bar-fill");
  const staminaText = el("span", "home-bar-text", "100");
  add(staminaEl, el("span", "home-bar-label", "Energy"), el("span", "home-bar-track"));
  staminaEl.lastElementChild!.appendChild(staminaFill);
  staminaEl.appendChild(staminaText);
  const waterEl = el("div", "home-water");
  waterEl.id = "home-water";
  waterEl.title = "Watering can: refill at the well or the pond";
  const eatBtn = btn("Eat (Q)", "dm-btn dm-btn-small home-eat", "home-eat", () => opts.eat());
  eatBtn.hidden = true;
  add(rows, clockEl, staminaEl, waterEl, eatBtn);
  const status = root.querySelector("#hud-status");
  if (status) status.appendChild(rows);
  else {
    const own = el("div", "dm-panel home-own-panel");
    own.appendChild(rows);
    layer.appendChild(own);
  }

  // ---- shipping bin panel
  const bin = el("div", "dm-panel home-bin");
  bin.id = "bin-panel";
  bin.hidden = true;
  const binList = el("ul", "home-bin-list");
  const binTotal = el("div", "home-bin-total");
  const takeBack = btn("Take back last", "dm-btn dm-btn-small", "bin-takeback", () => opts.unship());
  const binHead = el("div", "dm-panel-header");
  const hideBin = () => {
    if (bin.hidden) return;
    bin.hidden = true;
    opts.onBinClose?.();
  };
  add(binHead, el("span", "dm-title", "Shipping bin"), btn("✕", "dm-close", "bin-close", hideBin));
  add(bin, binHead, el("p", "home-muted", "Everything here is sold tonight when the day ends."), binList, binTotal, takeBack);
  layer.appendChild(bin);

  // ---- modal dialogs
  const dialog = el("div", "dm-dialog home-dialog");
  dialog.hidden = true;
  const panel = el("div", "dm-panel home-dialog-panel");
  dialog.appendChild(panel);
  layer.appendChild(dialog);
  let closeDialog: (() => void) | null = null;

  function openDialog(id: string, build: (p: HTMLElement) => void, onClose: () => void): void {
    closeDialog?.();
    panel.replaceChildren();
    panel.id = id;
    build(panel);
    dialog.hidden = false;
    opts.setTyping(true);
    closeDialog = () => {
      closeDialog = null;
      dialog.hidden = true;
      opts.setTyping(false);
      onClose();
    };
  }

  const onKey = (ev: KeyboardEvent) => {
    if (dialog.hidden) {
      if (ev.key === "Escape" && !bin.hidden) {
        ev.preventDefault();
        hideBin();
      }
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeDialog?.();
    }
  };
  addEventListener("keydown", onKey, true);

  // ---- countdown + morning fade
  const banner = el("div", "dm-panel home-sleep-banner");
  banner.id = "sleep-countdown";
  banner.hidden = true;
  layer.appendChild(banner);
  let countdown: ReturnType<typeof setInterval> | null = null;
  const fade = el("div", "home-fade");
  fade.id = "home-fade";
  layer.appendChild(fade);

  function morningFade(): void {
    fade.classList.remove("is-on");
    void fade.offsetWidth; // restart the animation
    fade.classList.add("is-on");
  }

  const setBar = (stamina: number, maxStamina: number) => {
    const pct = maxStamina > 0 ? Math.max(0, Math.min(1, stamina / maxStamina)) : 0;
    staminaFill.style.width = `${Math.round(pct * 100)}%`;
    staminaFill.classList.toggle("is-low", pct <= 0.2);
    staminaText.textContent = `${stamina}`;
  };

  let home = false;
  const ui: HomeUi = {
    setAtHome(atHome) {
      home = atHome;
      // In zones the rows stay hidden until the zone reports your stamina (setZoneStamina).
      rows.hidden = !atHome;
      clockEl.hidden = !atHome;
      waterEl.hidden = !atHome;
      staminaEl.hidden = false;
      if (!atHome) {
        eatBtn.hidden = true;
        bin.hidden = true;
        banner.hidden = true;
      }
    },
    setVisiting(visiting) {
      if (!home) return; // zones: only the stamina bar, whatever setAtHome left
      staminaEl.hidden = visiting;
      waterEl.hidden = visiting;
      if (visiting) eatBtn.hidden = true;
    },
    setZoneStamina(stamina, maxStamina) {
      setBar(stamina, maxStamina);
      rows.hidden = false;
    },
    setClock(day, label, night) {
      dayEl.textContent = `Day ${day}`;
      timeEl.textContent = label;
      clockEl.classList.toggle("is-night", night);
    },
    setVitals(stamina, maxStamina, water, maxWater) {
      setBar(stamina, maxStamina);
      waterEl.textContent = `Watering can ${water}/${maxWater}`;
      waterEl.classList.toggle("is-empty", water <= 0);
    },
    setEdible(item) {
      eatBtn.hidden = !item;
      eatBtn.title = item ? `Eat ${getItem(item)?.name ?? item}` : "";
    },
    setBin(items, total, open) {
      binList.replaceChildren();
      if (items.length === 0) binList.appendChild(el("li", "home-muted", "Empty. Use a crop, ore or anything sellable on the bin to ship it."));
      for (const l of items) {
        const li = el("li", "home-line");
        const { name, quality } = itemLabel(l.item);
        add(li, icon(l.item), el("span", "home-line-name", quality ? `${name} (${quality})` : name), el("span", "home-line-qty", `×${l.qty}`), el("span", "home-line-coins", `${l.coins} c`));
        binList.appendChild(li);
      }
      binTotal.textContent = `Tonight: ${total} c`;
      takeBack.disabled = items.length === 0;
      if (open) bin.hidden = false;
    },
    closeBin() {
      hideBin();
    },
    confirmSleep() {
      return new Promise((resolve) => {
        let answer: "sleep" | "move" | "cancel" = "cancel";
        openDialog(
          "sleep-dialog",
          (p) => {
            const actions = el("div", "home-actions");
            add(actions, 
              btn("Sleep", "dm-btn dm-btn-primary", "sleep-yes", () => {
                answer = "sleep";
                closeDialog?.();
              }),
              btn("Not now", "dm-btn", "sleep-no", () => closeDialog?.()),
            );
            if (opts.moveBed)
              add(actions, 
                btn("Move bed", "dm-btn dm-btn-small", "sleep-move", () => {
                  answer = "move";
                  closeDialog?.();
                }),
              );
            add(p, el("h2", "dm-title", "Go to sleep?"), el("p", "", "The day will end."), actions);
          },
          () => resolve(answer),
        );
        (document.getElementById("sleep-yes") as HTMLButtonElement | null)?.focus();
      });
    },
    sleeping(host, endsAt, now) {
      if (countdown) clearInterval(countdown);
      const draw = () => {
        const s = Math.max(0, Math.ceil((endsAt - now()) / 1000));
        banner.textContent = `${host} is going to sleep… ${s}`;
        if (s <= 0 && countdown) {
          clearInterval(countdown);
          countdown = null;
        }
      };
      banner.hidden = false;
      draw();
      countdown = setInterval(draw, 250);
    },
    showSummary(summary) {
      if (countdown) clearInterval(countdown);
      countdown = null;
      banner.hidden = true;
      bin.hidden = true;
      morningFade();
      openDialog(
        "day-summary",
        (p) => {
          const title = summary.passedOut ? `You passed out! Day ${summary.day} is over` : `Day ${summary.day} is over`;
          add(p, el("h2", "dm-title", title));
          if (summary.away) add(p, el("p", "home-muted", "The day ended while you were away."));
          const table = el("table", "home-summary");
          const head = el("tr");
          for (const h of ["", "Item", "Quality", "Qty", "Earned"]) head.appendChild(el("th", "", h));
          table.appendChild(head);
          for (const l of summary.lines) {
            const tr = el("tr");
            const { name, quality } = itemLabel(l.item);
            const iconCell = el("td");
            iconCell.appendChild(icon(l.item));
            add(tr, iconCell, el("td", "", name), el("td", `q-${quality.toLowerCase() || "normal"}`, quality || "Normal"), el("td", "", `${l.qty}`), el("td", "", `${l.coins} c`));
            table.appendChild(tr);
          }
          if (summary.lines.length === 0) add(p, el("p", "home-muted", "Nothing was shipped today."));
          else add(p, table);
          const notes = el("ul", "home-notes");
          if (summary.grown > 0) notes.appendChild(el("li", "", `${summary.grown} watered crop${summary.grown === 1 ? "" : "s"} grew overnight.`));
          if (summary.crows.length > 0) {
            const names = summary.crows.map((c) => itemLabel(c.crop).name.toLowerCase());
            notes.appendChild(el("li", "is-bad", `Crows ate ${summary.crows.length} crop${summary.crows.length === 1 ? "" : "s"} (${names.join(", ")}). A scarecrow keeps them away.`));
          }
          if (summary.wilted) notes.appendChild(el("li", "is-bad", `${summary.wilted} crop${summary.wilted === 1 ? "" : "s"} wilted without water. Water ${summary.wilted === 1 ? "it" : "them"} today to perk ${summary.wilted === 1 ? "it" : "them"} up.`));
          if (summary.died?.length) {
            const n = summary.died.length;
            notes.appendChild(el("li", "is-bad", `${n} crop${n === 1 ? "" : "s"} died of thirst. Clear ${n === 1 ? "it" : "them"} with your hoe or by hand.`));
          }
          if (summary.reverted > 0) notes.appendChild(el("li", "", `${summary.reverted} patch${summary.reverted === 1 ? "" : "es"} of empty soil went back to grass.`));
          if (summary.passedOut) notes.appendChild(el("li", "is-bad", `You stayed up past 2:00 and lost ${summary.penalty}g.`));
          if (notes.childElementCount > 0) add(p, notes);
          const total = el("div", "home-summary-total", `Total earned: ${summary.total - summary.penalty} c`);
          add(p, total, btn("Good morning!", "dm-btn dm-btn-primary", "summary-ok", () => closeDialog?.()));
        },
        () => undefined,
      );
      (document.getElementById("summary-ok") as HTMLButtonElement | null)?.focus();
    },
    destroy() {
      if (countdown) clearInterval(countdown);
      removeEventListener("keydown", onKey, true);
      rows.remove();
      layer.remove();
    },
  };
  return ui;
}
