// See ../contracts.ts for the contract.
// Name tags, speech bubbles, NPC status and hp bars, drawn into layers.overlay at headOf() each frame.
// All strings reach the screen through Text.text only (never HTML), after sanitizeText().
import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { EMOTE_MS, type EmoteCode } from "../../shared/emotes";
import { truncateWords } from "../../shared/social";
import { emoteTexture } from "../art/emotes";
import type { CreateOverlays, Overlays } from "../contracts";
import type { EntityState, Vec2 } from "../../shared/types";

export const BUBBLE_MS = 5000;
export const BUBBLE_FADE_MS = 600;
export const WRAP_CHARS = 28;
export const MAX_LINES = 3;
const MAX_INPUT = 240;
const MAX_NAME = 20;
const MAX_STATUS = 24;
const DOT_STEP_MS = 350;

export const TAG_COLORS = {
  you: 0xffd75e,
  player: 0xffffff,
  npc: 0xa8f08a,
  monster: 0xff9a8a,
  animal: 0xffd0e4,
} as const;

// ---------------------------------------------------------------- pure helpers (tested)

function isInvisible(c: number): boolean {
  return c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
}

/** Strips control characters, collapses whitespace, caps length. */
export function sanitizeText(text: string, max = MAX_INPUT): string {
  // Control chars, zero-width and bidi overrides become spaces.
  const clean = Array.from(String(text ?? ""), (ch) => (isInvisible(ch.codePointAt(0) ?? 0) ? " " : ch)).join("");
  const collapsed = clean.replace(/\s+/g, " ").trim();
  return Array.from(collapsed).slice(0, max).join("");
}

/** Word-wraps to `width` chars, hard-splits long words, and ellipsizes past `maxLines`. */
export function wrapText(text: string, width = WRAP_CHARS, maxLines = MAX_LINES): string[] {
  const words = sanitizeText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let word of words) {
    while (Array.from(word).length > width) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      const chars = Array.from(word);
      lines.push(chars.slice(0, width).join(""));
      word = chars.slice(width).join("");
    }
    if (!word) continue;
    if (!cur) cur = word;
    else if (Array.from(cur).length + 1 + Array.from(word).length <= width) cur += " " + word;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = Array.from(kept[maxLines - 1]);
  kept[maxLines - 1] = (last.length >= width ? last.slice(0, width - 1).join("") : last.join("")).trimEnd() + "…";
  return kept;
}

/** Bubble text: at most 5 words (the chat log has the full line), wrapped. */
export function bubbleLines(text: string): string[] {
  return wrapText(truncateWords(sanitizeText(text)));
}

export const EMOTE_FADE_MS = 400;
export const EMOTE_POP_MS = 160;

/** Emote bubble scale: pops from 0.6 to 1 over EMOTE_POP_MS. */
export function emoteScale(age: number): number {
  if (age >= EMOTE_POP_MS) return 1;
  const t = Math.max(0, age) / EMOTE_POP_MS;
  return 0.6 + 0.4 * (1 - (1 - t) * (1 - t));
}

/** Bubble opacity at `age` ms: 1 until the fade window, then linear to 0; 0 once expired. */
export function bubbleAlpha(age: number, life = BUBBLE_MS, fade = BUBBLE_FADE_MS): number {
  if (age < 0) return 1;
  if (age >= life) return 0;
  const fadeStart = life - fade;
  return age <= fadeStart ? 1 : 1 - (age - fadeStart) / fade;
}

/** Status line with trailing dots animated ("" -> "." -> ".." -> "..."). Non-dotted status is returned as is. */
export function animateStatus(status: string, now: number): string {
  const s = sanitizeText(status, MAX_STATUS);
  const m = /^(.*?)(\.{2,}|…)$/.exec(s);
  if (!m) return s;
  const n = 1 + (Math.floor(now / DOT_STEP_MS) % 3);
  return m[1] + ".".repeat(n);
}

export function tagColor(e: Pick<EntityState, "id" | "kind">, youId: string | null): number {
  if (youId !== null && e.id === youId) return TAG_COLORS.you;
  return TAG_COLORS[e.kind] ?? TAG_COLORS.player;
}

/** Monsters always show a bar; you only when hurt; others never. */
export function showHpBar(e: Pick<EntityState, "id" | "kind" | "hp" | "maxHp">, youId: string | null): boolean {
  if (e.hp === undefined || !e.maxHp || e.maxHp <= 0) return false;
  if (e.kind === "monster") return true;
  return youId !== null && e.id === youId && e.hp < e.maxHp;
}

export function hpColor(frac: number): number {
  if (frac > 0.5) return 0x6fd35a;
  if (frac > 0.25) return 0xf2c14e;
  return 0xe5533d;
}

// ---------------------------------------------------------------- display

const FONT = "'Press Start 2P', 'Pixelify Sans', ui-monospace, Menlo, Consolas, monospace";
const RES = 2;

const nameStyles = new Map<number, TextStyle>();
const nameStyle = (color: number): TextStyle => {
  let st = nameStyles.get(color);
  if (!st) {
    st = makeNameStyle(color);
    nameStyles.set(color, st);
  }
  return st;
};
const makeNameStyle = (color: number) =>
  new TextStyle({
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: "bold",
    fill: color,
    stroke: { color: 0x1d1424, width: 3, join: "round" },
    letterSpacing: 0.5,
  });

const statusStyle = new TextStyle({
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: "bold",
  fill: 0xfff3c4,
  stroke: { color: 0x1d1424, width: 3, join: "round" },
});

const bubbleTextStyle = new TextStyle({
  fontFamily: FONT,
  fontSize: 11,
  fill: 0x3b2a1a,
  lineHeight: 14,
  align: "center",
});

const BUBBLE_FILL = 0xfff8e7;
const BUBBLE_EDGE = 0x3b2a1a;
const PAD_X = 7;
const PAD_Y = 5;
const RADIUS = 6;
const TAIL_W = 10;
const TAIL_H = 7;
const HP_W = 34;
const HP_H = 5;

interface Bubble {
  lines: string;
  at: number;
}

interface View {
  root: Container;
  name: Text;
  nameKey: string;
  colorKey: number;
  status: Text;
  hp: Graphics;
  hpKey: string;
  bubble: Container;
  bubbleBg: Graphics;
  bubbleText: Text;
  bubbleKey: string;
  emote: Container;
  emoteIcon: Sprite;
  emoteKey: string;
}

interface Emoted {
  code: EmoteCode;
  at: number;
}

const EMOTE_ICON = 24;
const EMOTE_PAD = 4;

/** Rounded rect with a downward tail at bottom-center as one path, so the outline has no seam. */
function drawBubble(g: Graphics, w: number, h: number): void {
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = -h - TAIL_H;
  const y1 = -TAIL_H;
  const r = Math.min(RADIUS, h / 2, w / 2);
  g.clear()
    .moveTo(x0 + r, y0)
    .lineTo(x1 - r, y0)
    .arcTo(x1, y0, x1, y0 + r, r)
    .lineTo(x1, y1 - r)
    .arcTo(x1, y1, x1 - r, y1, r)
    .lineTo(TAIL_W / 2, y1)
    .lineTo(0, 0)
    .lineTo(-TAIL_W / 2, y1)
    .lineTo(x0 + r, y1)
    .arcTo(x0, y1, x0, y1 - r, r)
    .lineTo(x0, y0 + r)
    .arcTo(x0, y0, x0 + r, y0, r)
    .closePath()
    .fill({ color: BUBBLE_FILL, alpha: 0.97 })
    .stroke({ color: BUBBLE_EDGE, width: 2, alignment: 0.5 });
}

function drawHp(g: Graphics, frac: number): void {
  const f = Math.max(0, Math.min(1, frac));
  const x = -HP_W / 2;
  g.clear()
    .rect(x - 1, -HP_H - 1, HP_W + 2, HP_H + 2)
    .fill(0x1d1424)
    .rect(x, -HP_H, HP_W, HP_H)
    .fill(0x4a2e3a);
  if (f > 0) g.rect(x, -HP_H, Math.max(1, Math.round(HP_W * f)), HP_H).fill(hpColor(f));
}

export const createOverlays: CreateOverlays = (layers): Overlays => {
  // Bubbles sit in their own container above every tag, so a bubble is never covered by a neighbour's name.
  let tags = new Container({ label: "overlay-tags" });
  let bubbles = new Container({ label: "overlay-bubbles" });
  layers.overlay.addChild(tags, bubbles);

  const views = new Map<string, View>();
  const said = new Map<string, Bubble>();
  const emoted = new Map<string, Emoted>();
  let destroyed = false;

  function makeView(id: string): View {
    const root = new Container({ label: `tag:${id}` });
    const name = new Text({ text: "", style: nameStyle(TAG_COLORS.player), resolution: RES, anchor: { x: 0.5, y: 1 } });
    const status = new Text({ text: "", style: statusStyle, resolution: RES, anchor: { x: 0.5, y: 1 } });
    const hp = new Graphics();
    root.addChild(hp, name, status);
    tags.addChild(root);

    const bubble = new Container({ label: `bubble:${id}`, visible: false });
    const bubbleBg = new Graphics();
    const bubbleText = new Text({ text: "", style: bubbleTextStyle, resolution: RES, anchor: { x: 0.5, y: 1 } });
    bubble.addChild(bubbleBg, bubbleText);
    bubbles.addChild(bubble);

    const emote = new Container({ label: `emote:${id}`, visible: false });
    const emoteBg = new Graphics();
    drawBubble(emoteBg, EMOTE_ICON + EMOTE_PAD * 2, EMOTE_ICON + EMOTE_PAD * 2);
    const emoteIcon = new Sprite();
    emoteIcon.anchor.set(0.5, 1);
    emoteIcon.position.set(0, -TAIL_H - EMOTE_PAD);
    emoteIcon.width = EMOTE_ICON;
    emoteIcon.height = EMOTE_ICON;
    emote.addChild(emoteBg, emoteIcon);
    bubbles.addChild(emote);

    return {
      root, name, nameKey: "", colorKey: -1, status, hp, hpKey: "", bubble, bubbleBg, bubbleText, bubbleKey: "",
      emote, emoteIcon, emoteKey: "",
    };
  }

  function dropView(id: string, v: View): void {
    v.root.destroy({ children: true });
    v.bubble.destroy({ children: true });
    v.emote.destroy({ children: true });
    views.delete(id);
  }

  function layoutView(v: View, e: EntityState, head: Vec2, youId: string | null, now: number): void {
    const hx = Math.round(head.x);
    let y = Math.round(head.y) - 2;
    v.root.position.set(hx, 0);

    // Monsters are identified by their sprite and hp bar; a name tag would only add clutter.
    const showName = e.kind !== "monster" && e.name.length > 0;
    v.name.visible = showName;
    if (showName) {
      const color = tagColor(e, youId);
      if (color !== v.colorKey) {
        v.name.style = nameStyle(color);
        v.colorKey = color;
      }
      if (e.name !== v.nameKey) {
        v.name.text = sanitizeText(e.name, MAX_NAME);
        v.nameKey = e.name;
      }
      v.name.position.set(0, y);
      y -= Math.ceil(v.name.height) + 1;
    }

    const hpOn = showHpBar(e, youId);
    v.hp.visible = hpOn;
    if (hpOn) {
      const frac = (e.hp ?? 0) / (e.maxHp ?? 1);
      const key = frac.toFixed(3);
      if (key !== v.hpKey) {
        drawHp(v.hp, frac);
        v.hpKey = key;
      }
      v.hp.position.set(0, y - 1);
      y -= HP_H + 4;
    }

    const b = said.get(e.id);
    const alpha = b ? bubbleAlpha(now - b.at) : 0;
    if (b && alpha <= 0) said.delete(e.id);

    // A live bubble wins over status: they share the same spot above the head.
    const statusText = alpha <= 0 && e.status ? animateStatus(e.status, now) : "";
    v.status.visible = statusText.length > 0;
    if (statusText) {
      if (v.status.text !== statusText) v.status.text = statusText;
      v.status.position.set(0, y);
    }

    v.bubble.visible = alpha > 0;
    if (b && alpha > 0) {
      if (b.lines !== v.bubbleKey) {
        v.bubbleText.text = b.lines;
        const w = Math.ceil(v.bubbleText.width) + PAD_X * 2;
        const h = Math.ceil(v.bubbleText.height) + PAD_Y * 2;
        drawBubble(v.bubbleBg, w, h);
        v.bubbleText.position.set(0, -TAIL_H - PAD_Y + 1);
        v.bubbleKey = b.lines;
      }
      v.bubble.alpha = alpha;
      v.bubble.position.set(hx, y - 1);
    }

    // Emotes stack above a live speech bubble.
    const em = emoted.get(e.id);
    const eAge = em ? now - em.at : 0;
    const eAlpha = em ? bubbleAlpha(eAge, EMOTE_MS, EMOTE_FADE_MS) : 0;
    if (em && eAlpha <= 0) emoted.delete(e.id);
    v.emote.visible = !!em && eAlpha > 0;
    if (em && eAlpha > 0) {
      if (em.code !== v.emoteKey) {
        v.emoteIcon.texture = emoteTexture(em.code);
        v.emoteIcon.width = EMOTE_ICON;
        v.emoteIcon.height = EMOTE_ICON;
        v.emoteKey = em.code;
      }
      const top = alpha > 0 ? y - 1 - Math.ceil(v.bubble.height) - 2 : y - 1;
      v.emote.alpha = eAlpha;
      v.emote.scale.set(emoteScale(eAge));
      v.emote.position.set(hx, top);
    }
  }

  return {
    sync(states, headOf, youId) {
      if (destroyed) return;
      // GameApp.clearWorld() may have destroyed our containers along with the overlay layer's children.
      if (tags.destroyed || bubbles.destroyed || !tags.parent || !bubbles.parent) {
        if (!tags.destroyed) tags.destroy({ children: true });
        if (!bubbles.destroyed) bubbles.destroy({ children: true });
        views.clear();
        if (layers.overlay.destroyed) return;
        tags = new Container({ label: "overlay-tags" });
        bubbles = new Container({ label: "overlay-bubbles" });
        layers.overlay.addChild(tags, bubbles);
      }
      const now = performance.now();
      const seen = new Set<string>();
      for (const e of states) {
        seen.add(e.id);
        const head = headOf(e.id);
        let v = views.get(e.id);
        if (!head) {
          if (v) {
            v.root.visible = false;
            v.bubble.visible = false;
            v.emote.visible = false;
          }
          continue;
        }
        if (!v) {
          v = makeView(e.id);
          views.set(e.id, v);
        }
        v.root.visible = true;
        layoutView(v, e, head, youId, now);
      }
      for (const [id, v] of views) if (!seen.has(id)) dropView(id, v);
      // Bubbles said to entities that never showed up still expire.
      for (const [id, b] of said) if (!seen.has(id) && now - b.at >= BUBBLE_MS) said.delete(id);
      for (const [id, m] of emoted) if (!seen.has(id) && now - m.at >= EMOTE_MS) emoted.delete(id);
    },

    say(entityId, text) {
      if (destroyed) return;
      const lines = bubbleLines(text);
      if (lines.length === 0) {
        said.delete(entityId);
        return;
      }
      said.set(entityId, { lines: lines.join("\n"), at: performance.now() });
    },

    emote(entityId, code) {
      if (destroyed) return;
      emoted.set(entityId, { code, at: performance.now() });
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      views.clear();
      said.clear();
      emoted.clear();
      if (!tags.destroyed) tags.destroy({ children: true });
      if (!bubbles.destroyed) bubbles.destroy({ children: true });
    },
  };
};
