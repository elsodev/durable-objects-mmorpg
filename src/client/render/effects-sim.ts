// Pure simulation for render/effects.ts: pooled particles and floating text. No Pixi, no DOM,
// randomness passed in, so it is testable and the renderer only mirrors slot state to sprites.

export type BurstKind = "dust" | "hit" | "water" | "sparkle";
export type FloatKind = "info" | "error" | "loot";

export interface Particle {
  active: boolean;
  x: number; // px, camera space
  y: number;
  vx: number; // px/s
  vy: number;
  age: number; // s
  life: number; // s
  size: number; // px
  color: number;
  gravity: number; // px/s^2, +y is down
  drag: number; // fraction of velocity lost per second (0..1)
  twinkle: boolean;
  additive: boolean;
  /** Current alpha, written by step(). */
  alpha: number;
  /** Current scale factor of size, written by step(). */
  scale: number;
}

interface BurstSpec {
  count: [number, number];
  colors: number[];
  speed: [number, number];
  /** Emission cone: center angle (rad, 0 = right, -PI/2 = up) and half-width. */
  angle: number;
  spread: number;
  life: [number, number];
  size: [number, number];
  gravity: number;
  drag: number;
  /** Random offset of the spawn point, px. */
  jitter: number;
  twinkle?: boolean;
  additive?: boolean;
  /** Particles shrink over life instead of keeping size. */
  shrink?: boolean;
}

const UP = -Math.PI / 2;

export const BURSTS: Record<BurstKind, BurstSpec> = {
  dust: {
    count: [5, 7],
    colors: [0xcbb58e, 0xb59e78, 0xe0d2b0],
    speed: [20, 60],
    angle: UP,
    spread: Math.PI * 0.6,
    life: [0.35, 0.65],
    size: [4, 7],
    gravity: -20,
    drag: 0.9,
    jitter: 10,
    shrink: false,
  },
  hit: {
    count: [7, 10],
    colors: [0xffffff, 0xfff1a8, 0xffc75f],
    speed: [140, 260],
    angle: 0,
    spread: Math.PI,
    life: [0.18, 0.35],
    size: [3, 5],
    gravity: 0,
    drag: 0.97,
    jitter: 4,
    additive: true,
    shrink: true,
  },
  water: {
    count: [7, 10],
    colors: [0x7ec8f0, 0xa8dcf7, 0x4fa3d9],
    speed: [70, 150],
    angle: UP,
    spread: Math.PI * 0.4,
    life: [0.45, 0.75],
    size: [3, 5],
    gravity: 520,
    drag: 0.3,
    jitter: 8,
  },
  sparkle: {
    count: [5, 8],
    colors: [0xfff6a8, 0xffffff, 0xbdf3ff, 0xffd166],
    speed: [10, 40],
    angle: UP,
    spread: Math.PI,
    life: [0.8, 1.3],
    size: [3, 5],
    gravity: -30,
    drag: 0.6,
    jitter: 22,
    twinkle: true,
    additive: true,
  },
};

export type Rand = () => number;

const range = (r: Rand, [a, b]: [number, number]) => a + (b - a) * r();

function blank(): Particle {
  return {
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: 0,
    life: 1,
    size: 1,
    color: 0xffffff,
    gravity: 0,
    drag: 0,
    twinkle: false,
    additive: false,
    alpha: 0,
    scale: 1,
  };
}

/** Fixed-size particle pool. When full, the oldest particle is recycled so new bursts always show. */
export class ParticlePool {
  readonly slots: Particle[];
  private shrinkFlags: boolean[];

  constructor(readonly capacity: number) {
    this.slots = Array.from({ length: capacity }, blank);
    this.shrinkFlags = new Array<boolean>(capacity).fill(false);
  }

  activeCount(): number {
    let n = 0;
    for (const p of this.slots) if (p.active) n++;
    return n;
  }

  private claim(): number {
    let oldest = 0;
    let oldestAge = -1;
    for (let i = 0; i < this.slots.length; i++) {
      const p = this.slots[i]!;
      if (!p.active) return i;
      const frac = p.age / p.life;
      if (frac > oldestAge) {
        oldestAge = frac;
        oldest = i;
      }
    }
    return oldest;
  }

  /** Spawns a burst at px (x, y); returns the slot indices used. */
  burst(x: number, y: number, kind: BurstKind, rand: Rand, countScale = 1): number[] {
    const spec = BURSTS[kind];
    const count = Math.max(1, Math.round(range(rand, spec.count) * countScale));
    const used: number[] = [];
    for (let n = 0; n < count; n++) {
      const i = this.claim();
      const p = this.slots[i]!;
      const ang = spec.angle + (rand() * 2 - 1) * spec.spread;
      const speed = range(rand, spec.speed);
      p.active = true;
      p.x = x + (rand() * 2 - 1) * spec.jitter;
      p.y = y + (rand() * 2 - 1) * spec.jitter * 0.5;
      p.vx = Math.cos(ang) * speed;
      p.vy = Math.sin(ang) * speed;
      p.age = 0;
      p.life = range(rand, spec.life);
      p.size = Math.round(range(rand, spec.size));
      p.color = spec.colors[Math.floor(rand() * spec.colors.length) % spec.colors.length]!;
      p.gravity = spec.gravity;
      p.drag = spec.drag;
      p.twinkle = spec.twinkle ?? false;
      p.additive = spec.additive ?? false;
      p.alpha = 1;
      p.scale = 1;
      this.shrinkFlags[i] = spec.shrink ?? false;
      used.push(i);
    }
    return used;
  }

  step(dt: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      const p = this.slots[i]!;
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        p.alpha = 0;
        continue;
      }
      const keep = Math.pow(1 - Math.min(p.drag, 0.999), dt);
      p.vx *= keep;
      p.vy = p.vy * keep + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.age / p.life;
      // Hold full alpha for the first half, then fade out.
      let a = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
      if (p.twinkle) a *= 0.55 + 0.45 * Math.abs(Math.sin(p.age * 14 + i));
      p.alpha = Math.max(0, Math.min(1, a));
      p.scale = this.shrinkFlags[i] ? 1 - t * 0.7 : 1;
    }
  }

  clear(): void {
    for (const p of this.slots) {
      p.active = false;
      p.alpha = 0;
    }
  }
}

// ---------------------------------------------------------------- floating text

export const FLOAT_COLORS: Record<FloatKind, number> = {
  info: 0xf4f1de,
  error: 0xff6b6b,
  loot: 0xffd166,
};

export const FLOAT_LIFE = 1.3; // s
export const FLOAT_RISE = 48; // px over the whole life
export const FLOAT_MAX_CHARS = 40;

export interface FloatEntry {
  id: number;
  text: string;
  kind: FloatKind;
  x: number; // px
  y: number; // px at spawn (after stacking offset)
  age: number;
  /** Written by step(). */
  dy: number;
  alpha: number;
  scale: number;
}

/** Plain-text cap: untrusted strings (item names etc.) never grow the overlay unbounded. */
export function sanitizeFloat(text: string): string {
  const flat = text.replace(/[\r\n\t]+/g, " ").trim();
  return flat.length > FLOAT_MAX_CHARS ? flat.slice(0, FLOAT_MAX_CHARS - 1) + "…" : flat;
}

export class FloatTexts {
  readonly entries: FloatEntry[] = [];
  private nextId = 1;

  constructor(readonly max = 24) {}

  /** Adds an entry; texts spawned close together stack upward instead of overlapping. Returns the entry and any evicted one. */
  add(x: number, y: number, text: string, kind: FloatKind): { entry: FloatEntry; evicted: FloatEntry | null } {
    let stack = 0;
    for (const e of this.entries) {
      if (e.age < 0.6 && Math.abs(e.x - x) < 40 && Math.abs(e.y - y) < 80) stack++;
    }
    let evicted: FloatEntry | null = null;
    if (this.entries.length >= this.max) evicted = this.entries.shift() ?? null;
    const entry: FloatEntry = {
      id: this.nextId++,
      text: sanitizeFloat(text),
      kind,
      x,
      y: y - stack * 18,
      age: 0,
      dy: 0,
      alpha: 1,
      scale: 1,
    };
    this.entries.push(entry);
    return { entry, evicted };
  }

  /** Advances time; returns entries that expired this step. */
  step(dt: number): FloatEntry[] {
    const done: FloatEntry[] = [];
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      e.age += dt;
      const t = e.age / FLOAT_LIFE;
      if (t >= 1) {
        done.push(e);
        this.entries.splice(i, 1);
        continue;
      }
      // Ease-out rise, quick pop-in scale, fade over the last 40%.
      e.dy = -FLOAT_RISE * (1 - (1 - t) * (1 - t));
      e.scale = t < 0.12 ? 0.7 + (t / 0.12) * 0.4 : t < 0.2 ? 1.1 - ((t - 0.12) / 0.08) * 0.1 : 1;
      e.alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    }
    return done;
  }

  clear(): FloatEntry[] {
    return this.entries.splice(0, this.entries.length);
  }
}

// ---------------------------------------------------------------- footstep dust

/** Emits a dust puff every `interval` seconds while the tracked position keeps moving. */
export class FootstepTracker {
  private last: { x: number; y: number } | null = null;
  private acc = 0;

  constructor(
    private interval = 0.3,
    private minSpeed = 1.2, // tiles/s
  ) {}

  /** pos in tiles; returns true when a puff should be emitted this frame. */
  update(dt: number, pos: { x: number; y: number } | null): boolean {
    if (!pos || dt <= 0) {
      this.last = pos ? { x: pos.x, y: pos.y } : null;
      this.acc = 0;
      return false;
    }
    const prev = this.last;
    this.last = { x: pos.x, y: pos.y };
    if (!prev) return false;
    const dist = Math.hypot(pos.x - prev.x, pos.y - prev.y);
    // Teleports and zone changes are not footsteps.
    if (dist > 1 || dist / dt < this.minSpeed) {
      this.acc = 0;
      return false;
    }
    this.acc += dt;
    if (this.acc >= this.interval) {
      this.acc -= this.interval;
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------- ambient

export interface AmbientLook {
  /** Multiply color over the whole screen (0xffffff = no change). */
  tint: number;
  /** Radius of the light around you, in tiles; 0 = no light hole. */
  light: number;
}

export const AMBIENT: Record<"day" | "cave" | "indoor", AmbientLook> = {
  day: { tint: 0xffffff, light: 0 },
  indoor: { tint: 0xffe6c4, light: 0 },
  cave: { tint: 0x23263a, light: 4.5 },
};

/** Gentle torch flicker for the cave light radius, deterministic in time. */
export function flicker(t: number): number {
  return 1 + 0.025 * Math.sin(t * 7.3) + 0.015 * Math.sin(t * 17.1 + 1.3);
}
