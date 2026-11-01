// LPC-proportioned humanoid on a 64x64 frame, feet at y = 60, centred on pixel column 32.
// A walk cycle is 4 frames: contact, pass, contact (other leg), pass. Arms swing against the legs.
import type { Facing } from "../../../shared/types";
import { P, shade, type Rgb } from "../palette";
import { PixelGrid } from "./grid";
import type { Look } from "./looks";

export const FRAME = 64;
export const FEET_Y = 60;

/** Leg phase per walk frame: +1 = one leg forward, -1 = the other, 0 = passing (body bobs up). */
export const WALK_PHASES = [1, 0, -1, 0] as const;

const CX = 32;

function shadedRect(g: PixelGrid, x: number, y: number, w: number, h: number, c: Rgb): void {
  g.rect(x, y, w, h, c);
  g.vline(x, y, h, shade(c, 0.18));
  g.vline(x + w - 1, y, h, shade(c, -0.25));
  g.hline(x, y + h - 1, w, shade(c, -0.25));
}

/** Slanted limb: a w-wide column whose bottom is shifted by dx (for side-view swings). */
function limb(g: PixelGrid, x: number, top: number, bottom: number, w: number, dx: number, c: Rgb): number {
  const len = Math.max(1, bottom - top);
  let last = x;
  for (let y = top; y <= bottom; y++) {
    const off = Math.round((dx * (y - top)) / len);
    last = x + off;
    g.hline(last, y, w, c);
    g.px(last + w - 1, y, shade(c, -0.22));
  }
  return last;
}

export interface Pose {
  facing: Facing;
  phase: number; // -1..1
  bob: number; // 0 or -1
  /** 0..2 for attack frames: arm raised, extended, down. -1 = not attacking. */
  attack?: number;
}

export function drawHumanoid(look: Look, pose: Pose): PixelGrid {
  const g = new PixelGrid(FRAME, FRAME);
  const side = pose.facing === "left" || pose.facing === "right";
  // Draw everything facing right; left is a mirror.
  const body = side ? drawSide(look, pose) : drawFront(look, pose, pose.facing === "up");
  g.blit(body, 0, 0, pose.facing === "left");
  g.outline("self");
  return g;
}

interface Frame {
  legTop: number;
  torsoTop: number;
  torsoBottom: number;
  hy: number; // head top
}

function frameFor(look: Look, bob: number): Frame {
  const L = look.small ? 8 : 11;
  const T = look.small ? 10 : 13;
  const legTop = 58 - L + bob;
  const torsoBottom = legTop + 1;
  const torsoTop = torsoBottom - T;
  const hy = torsoTop + 1 - 14;
  return { legTop, torsoTop, torsoBottom, hy };
}

function legColor(look: Look): Rgb {
  return look.outfit === "overalls" ? look.accent : look.pants;
}

// ---------------------------------------------------------------- front / back
function drawFront(look: Look, pose: Pose, back: boolean): PixelGrid {
  const g = new PixelGrid(FRAME, FRAME);
  const f = frameFor(look, pose.bob);
  const p = pose.phase;
  const liftL = p > 0 ? 2 : 0;
  const liftR = p < 0 ? 2 : 0;

  // Legs + shoes.
  const lc = legColor(look);
  for (const [x, lift] of [
    [28, liftL],
    [33, liftR],
  ] as const) {
    shadedRect(g, x, f.legTop, 4, 58 - f.legTop - lift, lc);
    g.rect(x, 57 - lift, 4, 2, look.shoes);
    g.hline(x, 57 - lift, 4, shade(look.shoes, 0.25));
  }

  // Torso.
  const tw = 13;
  const tx = CX - 6;
  if (look.outfit === "dress" || look.outfit === "robe") {
    const hem = look.outfit === "robe" ? 57 : f.legTop + 7;
    const top = f.torsoBottom - 4;
    const skirt = look.outfit === "robe" ? look.shirt : shade(look.shirt, -0.08);
    g.poly([[tx, top], [tx + tw, top], [tx + tw + 2, hem], [tx - 2, hem]], skirt);
    g.hline(tx - 2, hem - 1, tw + 4, shade(skirt, -0.3));
    for (let x = tx + 2; x < tx + tw; x += 4) g.vline(x, top + 3, hem - top - 4, shade(skirt, -0.15));
  }
  shadedRect(g, tx, f.torsoTop, tw, f.torsoBottom - f.torsoTop, look.shirt);
  outfitFront(g, look, f, tx, tw, back);

  // Arms: a hand swings 1 px forward/back with the opposite leg.
  const armTop = f.torsoTop + 1;
  const armLen = look.small ? 9 : 11;
  const atk = pose.attack ?? -1;
  for (const [x, dir] of [
    [tx - 3, p],
    [tx + tw, -p],
  ] as const) {
    let hand = armTop + armLen + (dir > 0 ? 1 : dir < 0 ? -1 : 0);
    const raised = atk >= 0 && x > CX;
    if (raised) hand = atk === 0 ? armTop - 4 : atk === 1 ? armTop + 4 : armTop + armLen + 2;
    const top = Math.min(armTop, hand - 2);
    const bottom = Math.max(armTop + 3, hand);
    shadedRect(g, x, top, 3, bottom - top, look.outfit === "robe" ? look.shirt : look.shirt);
    g.vline(x === tx - 3 ? x + 2 : x, top + 1, bottom - top - 2, shade(look.shirt, -0.35));
    g.rect(x, raised && atk === 0 ? top - 2 : bottom, 3, 2, look.skin);
  }

  headFront(g, look, f.hy, back);
  return g;
}

function outfitFront(g: PixelGrid, look: Look, f: Frame, tx: number, tw: number, back: boolean): void {
  const belt = f.torsoBottom - 2;
  if (!back) {
    // neckline
    g.rect(CX - 1, f.torsoTop, 3, 2, look.skin);
    g.px(CX, f.torsoTop + 2, look.skin);
  }
  switch (look.outfit) {
    case "tunic":
    case "coat":
      g.hline(tx, belt, tw, 0x4a2e1e);
      if (!back) g.rect(CX - 1, belt, 3, 1, P.gold);
      if (look.outfit === "coat") {
        if (!back) {
          g.vline(CX, f.torsoTop + 2, belt - f.torsoTop - 2, look.accent);
          for (let y = f.torsoTop + 4; y < belt; y += 3) g.px(CX + 1, y, look.accent);
        }
        g.rect(tx, belt + 1, tw, 3, shade(look.shirt, -0.1));
        g.vline(tx + tw - 1, belt + 1, 3, shade(look.shirt, -0.3));
        if (!back) g.vline(CX, belt + 1, 3, shade(look.shirt, -0.35));
      }
      break;
    case "vest":
      g.rect(tx, f.torsoTop, 4, belt - f.torsoTop, look.accent);
      g.rect(tx + tw - 4, f.torsoTop, 4, belt - f.torsoTop, shade(look.accent, -0.15));
      if (back) g.rect(tx, f.torsoTop, tw, belt - f.torsoTop, look.accent);
      g.hline(tx, belt, tw, 0x4a2e1e);
      break;
    case "apron":
      if (!back) {
        g.rect(tx + 2, f.torsoTop + 3, tw - 4, f.legTop + 7 - f.torsoTop - 3, look.accent);
        g.vline(tx + tw - 3, f.torsoTop + 3, f.legTop + 7 - f.torsoTop - 3, shade(look.accent, -0.2));
        g.hline(tx + 2, f.legTop + 6, tw - 4, shade(look.accent, -0.25));
        g.vline(tx + 3, f.torsoTop, 3, look.accent);
        g.vline(tx + tw - 4, f.torsoTop, 3, look.accent);
        g.rect(CX - 2, belt + 2, 5, 3, shade(look.accent, -0.1));
      } else {
        g.hline(tx, belt - 1, tw, look.accent);
        g.rect(CX - 1, belt - 2, 3, 3, look.accent);
      }
      break;
    case "overalls":
      g.rect(tx + 2, belt - 4, tw - 4, 6, look.accent);
      g.vline(tx + 3, f.torsoTop, belt - 4 - f.torsoTop, look.accent);
      g.vline(tx + tw - 4, f.torsoTop, belt - 4 - f.torsoTop, look.accent);
      if (!back) {
        g.px(tx + 3, belt - 4, P.gold);
        g.px(tx + tw - 4, belt - 4, P.gold);
      }
      g.rect(tx, belt + 1, tw, 2, look.accent);
      break;
    case "dress":
      g.hline(tx, belt - 2, tw, look.accent);
      break;
    case "robe":
      g.hline(tx, belt, tw, look.accent);
      if (!back) g.vline(CX, belt, 6, look.accent);
      break;
  }
}

function headFront(g: PixelGrid, look: Look, hy: number, back: boolean): void {
  const hair = look.hair;
  const hairDark = shade(hair, -0.3);
  const hairLight = shade(hair, 0.25);
  const cx = CX + 0.5;
  // Back hair that hangs behind the head is drawn first.
  if (back && look.hairStyle === "long") g.rect(CX - 6, hy + 8, 13, 12, hairDark);
  if (!back && (look.hairStyle === "long" || look.hairStyle === "bob")) {
    const len = look.hairStyle === "long" ? 18 : 12;
    g.rect(CX - 8, hy + 4, 3, len, hairDark);
    g.rect(CX + 6, hy + 4, 3, len, hairDark);
  }

  g.ellipse(cx, hy + 7, 7.5, 7, look.skin);
  g.rect(CX - 5, hy + 12, 11, 2, look.skin); // jaw
  g.vline(CX + 6, hy + 5, 7, shade(look.skin, -0.18));
  g.hline(CX - 4, hy + 13, 9, shade(look.skin, -0.15));
  g.px(CX - 8, hy + 7, shade(look.skin, -0.2));
  g.px(CX + 8, hy + 7, shade(look.skin, -0.2));
  g.px(CX - 8, hy + 8, shade(look.skin, -0.2));
  g.px(CX + 8, hy + 8, shade(look.skin, -0.2));

  if (!back) {
    for (const x of [CX - 3, CX + 3]) {
      g.vline(x, hy + 8, 2, 0x2a1e2a);
      g.px(x, hy + 8, 0x4a3a5a);
    }
    g.px(CX - 4, hy + 10, shade(look.skin, -0.1));
    g.px(CX + 4, hy + 10, shade(look.skin, -0.1));
    g.hline(CX - 1, hy + 11, 3, shade(look.skin, -0.3));
  }

  if (look.hairStyle === "bald") {
    g.px(CX - 3, hy + 2, shade(look.skin, 0.3));
    g.px(CX - 2, hy + 2, shade(look.skin, 0.3));
    if (look.beard) {
      g.rect(CX - 7, hy + 5, 2, 4, hair);
      g.rect(CX + 6, hy + 5, 2, 4, hair);
    }
    if (back && look.beard) g.rect(CX - 6, hy + 7, 13, 3, hair);
  } else if (back) {
    g.ellipse(cx, hy + 6.5, 7.8, 7, hair);
    g.rect(CX - 6, hy + 10, 13, 4, hair);
    for (let x = CX - 5; x <= CX + 5; x += 3) g.vline(x, hy + 5, 8, hairDark);
    g.hline(CX - 3, hy + 1, 5, hairLight);
    if (look.hairStyle === "long") g.rect(CX - 6, hy + 13, 13, 8, hair);
    if (look.hairStyle === "ponytail") {
      g.rect(CX - 1, hy + 12, 3, 9, hair);
      g.vline(CX + 1, hy + 12, 9, hairDark);
    }
  } else {
    // Cap of hair with a fringe; the fringe shape varies per style.
    for (let y = hy - 1; y <= hy + 5; y++) {
      const dy = (y + 0.5 - (hy + 5)) / 6.5;
      const half = 8 * Math.sqrt(Math.max(0, 1 - dy * dy));
      g.hline(Math.round(cx - half), y, Math.round(cx + half) - Math.round(cx - half), hair);
    }
    g.vline(CX - 7, hy + 5, 4, hair);
    g.vline(CX + 7, hy + 5, 4, hair);
    const fringe = look.hairStyle === "fringe" || look.hairStyle === "bob" ? 2 : 1;
    for (let x = CX - 6; x <= CX + 6; x++) {
      const notch = (x + hy) % 3 === 0 ? 0 : fringe;
      g.vline(x, hy + 6, notch, hair);
    }
    g.hline(CX - 4, hy + 1, 6, hairLight);
    g.px(CX - 5, hy + 2, hairLight);
    g.hline(CX - 6, hy + 5, 13, hairDark);
  }

  if (look.hairStyle === "spiky") {
    for (const sx of [-6, -3, 0, 3, 6]) g.poly([[CX + sx - 2, hy + 1], [CX + sx + 3, hy + 1], [CX + sx + 1, hy - 4]], hair);
    g.px(CX - 2, hy - 2, hairLight);
  }
  if (look.hairStyle === "bun") {
    g.ball(cx, hy - 1, 3.5, 3, hair, hairDark, hairLight);
  }
  if (look.hairStyle === "ponytail" && !back) {
    g.rect(CX + 7, hy + 6, 2, 6, hairDark);
  }

  if (look.beard && !back) {
    const b = look.beard;
    g.rect(CX - 6, hy + 10, 13, 4, b);
    g.rect(CX - 4, hy + 14, 9, 2, b);
    g.hline(CX - 2, hy + 16, 5, shade(b, -0.2));
    g.hline(CX - 1, hy + 11, 3, shade(b, -0.4)); // mouth
    g.hline(CX - 3, hy + 10, 7, shade(b, 0.15));
  }
  hatFront(g, look, hy);
}

function hatFront(g: PixelGrid, look: Look, hy: number): void {
  const c = look.hatColor;
  const cx = CX + 0.5;
  switch (look.hat) {
    case "brim":
    case "straw":
      g.ellipse(cx, hy + 4, 11.5, 2.6, shade(c, -0.15));
      g.rect(CX - 5, hy - 3, 11, 7, c);
      g.vline(CX - 5, hy - 3, 6, shade(c, 0.2));
      g.vline(CX + 5, hy - 3, 6, shade(c, -0.25));
      g.hline(CX - 5, hy + 2, 11, look.hat === "straw" ? 0xa83a2a : shade(c, -0.45));
      g.hline(CX - 10, hy + 4, 21, shade(c, 0.12));
      break;
    case "helmet":
      for (let y = hy - 2; y <= hy + 5; y++) {
        const dy = (y + 0.5 - (hy + 5)) / 7.5;
        const half = 8.5 * Math.sqrt(Math.max(0, 1 - dy * dy));
        g.hline(Math.round(cx - half), y, Math.round(cx + half) - Math.round(cx - half), c);
      }
      g.hline(CX - 8, hy + 5, 17, shade(c, -0.3));
      g.hline(CX - 4, hy - 1, 5, shade(c, 0.35));
      g.rect(CX - 1, hy, 3, 3, 0xfff2a0);
      g.px(CX, hy + 1, 0xffffff);
      break;
    case "cap":
      g.ellipse(cx, hy + 3, 8, 4.5, c);
      g.rect(CX - 6, hy + 4, 13, 2, shade(c, -0.25));
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- side (facing right)
function drawSide(look: Look, pose: Pose): PixelGrid {
  const g = new PixelGrid(FRAME, FRAME);
  const f = frameFor(look, pose.bob);
  const p = pose.phase;
  const lc = legColor(look);
  const atk = pose.attack ?? -1;
  const armTop = f.torsoTop + 1;
  const armLen = look.small ? 9 : 11;

  // Far arm (behind body), swings with the near leg.
  if (atk < 0) {
    const farHand = limb(g, CX - 1, armTop, armTop + armLen, 3, 3 * p, shade(look.shirt, -0.3));
    g.rect(farHand, armTop + armLen + 1, 3, 2, shade(look.skin, -0.25));
  }

  // Far leg then near leg, swinging opposite ways.
  for (const [dx, tint] of [
    [-3 * p, -0.25],
    [3 * p, 0],
  ] as const) {
    const c = shade(lc, tint);
    const foot = limb(g, CX - 2, f.legTop, 56, 4, dx, c);
    g.rect(foot, 57, 6, 2, shade(look.shoes, tint));
    g.hline(foot, 57, 5, shade(look.shoes, tint + 0.25));
  }

  const tx = CX - 4;
  const tw = 9;
  if (look.outfit === "dress" || look.outfit === "robe") {
    const hem = look.outfit === "robe" ? 57 : f.legTop + 7;
    const top = f.torsoBottom - 4;
    const skirt = look.outfit === "robe" ? look.shirt : shade(look.shirt, -0.08);
    g.poly([[tx, top], [tx + tw, top], [tx + tw + 2, hem], [tx - 2, hem]], skirt);
    g.hline(tx - 2, hem - 1, tw + 4, shade(skirt, -0.3));
  }
  shadedRect(g, tx, f.torsoTop, tw, f.torsoBottom - f.torsoTop, look.shirt);
  const belt = f.torsoBottom - 2;
  switch (look.outfit) {
    case "tunic":
    case "coat":
      g.hline(tx, belt, tw, 0x4a2e1e);
      if (look.outfit === "coat") {
        g.rect(tx, belt + 1, tw, 3, shade(look.shirt, -0.1));
        g.vline(tx + tw - 1, f.torsoTop + 2, belt - f.torsoTop, look.accent);
      }
      break;
    case "vest":
      g.rect(tx, f.torsoTop, tw - 3, belt - f.torsoTop, look.accent);
      g.hline(tx, belt, tw, 0x4a2e1e);
      break;
    case "apron":
      g.rect(tx + tw - 2, f.torsoTop + 3, 3, f.legTop + 7 - f.torsoTop - 3, look.accent);
      g.hline(tx, belt - 1, tw, look.accent);
      break;
    case "overalls":
      g.rect(tx, belt - 4, tw, 7, look.accent);
      g.vline(tx + 5, f.torsoTop, belt - 4 - f.torsoTop, look.accent);
      break;
    case "dress":
      g.hline(tx, belt - 2, tw, look.accent);
      break;
    case "robe":
      g.hline(tx, belt, tw, look.accent);
      break;
  }

  // Near arm.
  if (atk >= 0) {
    const reach = [[-1, -7], [7, -1], [5, 6]][atk];
    g.line(CX, armTop + 1, CX + reach[0], armTop + 1 + reach[1], look.shirt);
    g.line(CX + 1, armTop + 1, CX + 1 + reach[0], armTop + 1 + reach[1], look.shirt);
    g.line(CX + 2, armTop + 1, CX + 2 + reach[0], armTop + 1 + reach[1], shade(look.shirt, -0.25));
    g.rect(CX + reach[0], armTop + 1 + reach[1], 3, 2, look.skin);
  } else {
    const hand = limb(g, CX - 1, armTop, armTop + armLen, 3, -3 * p, look.shirt);
    g.rect(hand, armTop + armLen + 1, 3, 2, look.skin);
  }

  headSide(g, look, f.hy);
  return g;
}

function headSide(g: PixelGrid, look: Look, hy: number): void {
  const hair = look.hair;
  const hairDark = shade(hair, -0.3);
  const hairLight = shade(hair, 0.25);
  if (look.hairStyle === "long") g.rect(CX - 7, hy + 6, 6, 14, hairDark);
  if (look.hairStyle === "ponytail") {
    g.rect(CX - 9, hy + 6, 3, 10, hairDark);
    g.px(CX - 8, hy + 16, hairDark);
  }

  g.ellipse(CX + 0.5, hy + 7, 6.5, 7, look.skin);
  g.rect(CX - 2, hy + 12, 8, 2, look.skin);
  g.px(CX + 7, hy + 8, look.skin); // nose
  g.px(CX + 7, hy + 9, shade(look.skin, -0.15));
  g.hline(CX - 2, hy + 13, 8, shade(look.skin, -0.15));
  g.vline(CX + 3, hy + 8, 2, 0x2a1e2a);
  g.px(CX + 3, hy + 8, 0x4a3a5a);
  g.px(CX + 5, hy + 11, shade(look.skin, -0.3));

  if (look.hairStyle === "bald") {
    g.px(CX - 1, hy + 2, shade(look.skin, 0.3));
    if (look.beard) g.rect(CX - 6, hy + 5, 4, 5, hair);
  } else {
    for (let y = hy - 1; y <= hy + 5; y++) {
      const dy = (y + 0.5 - (hy + 5)) / 6.5;
      const half = 7.5 * Math.sqrt(Math.max(0, 1 - dy * dy));
      g.hline(Math.round(CX - half), y, Math.round(CX + 0.5 + half) - Math.round(CX - half), hair);
    }
    const backLen = look.hairStyle === "long" ? 14 : look.hairStyle === "bob" ? 8 : 5;
    g.rect(CX - 6, hy + 4, 5, backLen, hair);
    g.vline(CX - 2, hy + 6, backLen - 2, hairDark);
    g.px(CX + 6, hy + 6, hair);
    g.px(CX + 5, hy + 6, hair);
    g.hline(CX - 3, hy + 1, 5, hairLight);
    g.px(CX, hy + 7, shade(look.skin, -0.2)); // ear
    g.px(CX, hy + 8, shade(look.skin, -0.2));
  }
  if (look.hairStyle === "spiky") {
    for (const sx of [-5, -2, 1, 4]) g.poly([[CX + sx - 2, hy + 1], [CX + sx + 3, hy + 1], [CX + sx - 1, hy - 4]], hair);
  }
  if (look.hairStyle === "bun") g.ball(CX - 3.5, hy, 3.5, 3, hair, hairDark, hairLight);

  if (look.beard) {
    const b = look.beard;
    g.rect(CX + 1, hy + 10, 6, 4, b);
    g.rect(CX + 1, hy + 14, 4, 2, b);
    g.px(CX + 6, hy + 11, shade(b, -0.4));
  }

  const c = look.hatColor;
  switch (look.hat) {
    case "brim":
    case "straw":
      g.ellipse(CX + 1.5, hy + 4, 10.5, 2.2, shade(c, -0.15));
      g.rect(CX - 4, hy - 3, 10, 7, c);
      g.hline(CX - 4, hy + 2, 10, look.hat === "straw" ? 0xa83a2a : shade(c, -0.45));
      g.hline(CX - 8, hy + 4, 20, shade(c, 0.12));
      break;
    case "helmet":
      for (let y = hy - 2; y <= hy + 5; y++) {
        const dy = (y + 0.5 - (hy + 5)) / 7.5;
        const half = 8 * Math.sqrt(Math.max(0, 1 - dy * dy));
        g.hline(Math.round(CX + 0.5 - half), y, Math.round(CX + 0.5 + half) - Math.round(CX + 0.5 - half), c);
      }
      g.hline(CX - 7, hy + 5, 16, shade(c, -0.3));
      g.rect(CX + 7, hy + 1, 2, 3, 0xfff2a0);
      break;
    case "cap":
      g.ellipse(CX + 0.5, hy + 3, 7.5, 4.5, c);
      g.rect(CX + 4, hy + 4, 6, 2, shade(c, -0.25));
      break;
    default:
      break;
  }
}
