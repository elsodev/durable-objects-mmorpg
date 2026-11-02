// Web Audio player for music and SFX. installAudio() registers itself with the game and UI sound
// seams; everything else in the client just calls playSfx()/uiSound()/setMusicZone().
import type { ZoneId } from "../../shared/types";
import { setAudioHooks } from "../game/audio";
import { setUiSoundPlayer } from "../ui/sound";
import { menuIcon } from "../ui/menu-icons";
import {
  FOOTSTEP_INTERVAL_MS,
  Throttle,
  assetUrl,
  clamp01,
  footstepKey,
  musicKeyForZone,
  parseSettings,
  pickVariant,
  pitchFor,
  resolveSfxKey,
  type AudioManifest,
  type AudioSettings,
  type MusicEntry,
} from "./audio-logic";

export type AudioChannel = "music" | "sfx";

export interface AudioOptions {
  /** Directory holding audio.json; paths in the manifest are relative to it. */
  base?: string;
  /** Crossfade length for music changes, in seconds. */
  crossfade?: number;
}

export interface AudioController {
  playSfx(key: string): void;
  setMusicZone(zone: ZoneId | null): void;
  /** AFK: suspend all sound, music paused where it was, until unpaused. */
  setPaused(paused: boolean): void;
  footstep(groundKind: string): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  setVolume(channel: AudioChannel, value: number): void;
  getVolume(channel: AudioChannel): number;
  /** Called whenever settings change (mute or volume), so controls stay in sync. */
  onChange(fn: (s: AudioSettings) => void): () => void;
  /** Resolves once the sound manifest has loaded (or failed: sounds then just stay silent). */
  ready(): Promise<void>;
}

const STORAGE_KEY = "dmmo.audio";
// A sound that took longer than this to decode is dropped rather than played late.
const MAX_LATE_MS = 250;
// Small, common sounds decoded right after unlock so the first click isn't silent.
const PREWARM = ["ui_click", "ui_hover", "ui_open", "ui_close", "ui_slot", "step_grass", "step_stone"];
/**
 * Loaded right after PREWARM: a sound still loading when it's asked for is dropped (MAX_LATE_MS),
 * so without these the first swing of each tool, the first harvest and so on were silent.
 */
const PREWARM_PLAY = ["hoe", "water", "plant", "harvest", "pick_swing", "pick_hit", "rock_break", "sword_swing", "sword_hit", "sword_miss", "pickup", "coins", "place", "error", "refill", "eat", "drink", "ui_tab", "ui_confirm", "ui_cancel", "npc_talk", "dog_bark", "husky_yip", "husky_awoo", "cat_purr", "cat_meow", "hen_cluck", "announce_start", "announce_end", "level_up"];

interface MusicTrack {
  key: string;
  el: HTMLAudioElement;
  gain: GainNode;
  src: MediaElementAudioSourceNode;
}

let active: AudioController | null = null;

function readSettings(): AudioSettings {
  try {
    return parseSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseSettings(null);
  }
}

function writeSettings(s: AudioSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Private mode or blocked storage: settings just won't survive a reload.
  }
}

const silent: AudioController = {
  playSfx() {},
  setMusicZone() {},
  setPaused() {},
  footstep() {},
  setMuted() {},
  isMuted: () => true,
  setVolume() {},
  getVolume: () => 0,
  onChange: () => () => {},
  ready: () => Promise.resolve(),
};

/** Create the player (once) and hook it into the game and UI sound seams. */
export function installAudio(opts: AudioOptions = {}): AudioController {
  if (active) return active;
  const Ctx: typeof AudioContext | undefined =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return silent;
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return silent;
  }
  active = createPlayer(ctx, opts);
  const player = active;
  setAudioHooks({
    playSfx: (k) => player.playSfx(k),
    setMusicZone: (z) => player.setMusicZone(z),
    setPaused: (p) => player.setPaused(p),
  });
  setUiSoundPlayer((k) => player.playSfx(k));
  return player;
}

/** The installed controller, if any. */
export function getAudio(): AudioController | null {
  return active;
}

/** Footstep for the local player; call every frame while moving, it rate-limits itself. */
export function footstep(groundKind: string): void {
  active?.footstep(groundKind);
}

function createPlayer(ctx: AudioContext, opts: AudioOptions): AudioController {
  const base = opts.base ?? "/assets/audio";
  const fade = opts.crossfade ?? 1;
  const settings = readSettings();
  const listeners = new Set<(s: AudioSettings) => void>();

  const master = ctx.createGain();
  const musicBus = ctx.createGain();
  const sfxBus = ctx.createGain();
  musicBus.connect(master);
  sfxBus.connect(master);
  master.connect(ctx.destination);
  master.gain.value = settings.muted ? 0 : 1;
  musicBus.gain.value = settings.music;
  sfxBus.gain.value = settings.sfx;

  let manifest: AudioManifest | null = null;
  const buffers = new Map<string, Promise<AudioBuffer | null>>();
  const lastVariant = new Map<string, number>();
  const throttle = new Throttle();
  let lastStep = -Infinity;

  let wantedMusic: string | null = null;
  let track: MusicTrack | null = null;
  let unlocked = false;
  /** AFK: everything held until unpaused, whatever the tab does meanwhile. */
  let paused = false;

  const manifestReady: Promise<void> = fetch(assetUrl(base, "audio.json"))
    .then((r) => (r.ok ? (r.json() as Promise<AudioManifest>) : Promise.reject(new Error(`audio.json ${r.status}`))))
    .then((m) => {
      manifest = { music: m.music ?? {}, sfx: m.sfx ?? {} };
      applyMusic();
      if (unlocked) return prewarm();
    })
    .catch((err) => console.warn("audio manifest failed", err));

  // --- unlock: browsers keep the context suspended until a user gesture
  const unlockEvents = ["pointerdown", "keydown", "touchend"] as const;
  const unlock = () => {
    // The AFK screen's own click comes first; the next gesture unlocks.
    if (paused) return;
    ctx
      .resume()
      .then(() => {
        if (unlocked || ctx.state !== "running") return;
        unlocked = true;
        for (const e of unlockEvents) window.removeEventListener(e, unlock, true);
        track?.el.play().catch(() => {});
        void prewarm();
      })
      .catch(() => {});
  };
  for (const e of unlockEvents) window.addEventListener(e, unlock, true);

  document.addEventListener("visibilitychange", () => {
    if (!unlocked || paused) return;
    if (document.hidden) void ctx.suspend().catch(() => {});
    else void ctx.resume().catch(() => {});
  });

  function emit() {
    writeSettings(settings);
    for (const fn of listeners) {
      try {
        fn({ ...settings });
      } catch {
        // A broken listener must not stop the rest.
      }
    }
  }

  function ramp(param: AudioParam, to: number, seconds: number) {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(to, now + seconds);
  }

  // --- SFX
  function loadBuffer(file: string): Promise<AudioBuffer | null> {
    let p = buffers.get(file);
    if (!p) {
      p = fetch(assetUrl(base, file))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${file} ${r.status}`))))
        .then((data) => decode(data))
        .catch((err) => {
          console.warn("sfx load failed", file, err);
          return null;
        });
      buffers.set(file, p);
    }
    return p;
  }

  function decode(data: ArrayBuffer): Promise<AudioBuffer> {
    // Promise form isn't available on older Safari; the callback form works everywhere.
    return new Promise((resolve, reject) => {
      const ret = ctx.decodeAudioData(data, resolve, reject);
      if (ret && typeof ret.then === "function") ret.then(resolve, reject);
    });
  }

  /** Starts decoding the common small sounds; resolves when they are all in (or failed). */
  async function prewarm(): Promise<void> {
    await warm(PREWARM);
    await warm(PREWARM_PLAY);
  }

  async function warm(keys: readonly string[]): Promise<void> {
    if (!manifest) return;
    const loads: Promise<unknown>[] = [];
    for (const k of keys) {
      const entry = manifest.sfx[k];
      if (entry) for (const f of entry.files) loads.push(loadBuffer(f));
    }
    await Promise.allSettled(loads);
  }

  function playResolved(key: string) {
    const entry = manifest?.sfx[key];
    if (!entry || entry.files.length === 0) return;
    const i = pickVariant(entry.files.length, lastVariant.get(key), Math.random);
    lastVariant.set(key, i);
    const asked = performance.now();
    const varied = entry.files.length > 1 && !key.startsWith("ui_");
    void loadBuffer(entry.files[i]!).then((buf) => {
      if (!buf || performance.now() - asked > MAX_LATE_MS) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      if (varied) src.playbackRate.value = pitchFor(Math.random);
      const g = ctx.createGain();
      g.gain.value = clamp01(entry.volume);
      src.connect(g).connect(sfxBus);
      src.onended = () => g.disconnect();
      src.start();
    });
  }

  function playSfx(key: string) {
    if (!manifest || settings.muted || settings.sfx <= 0 || ctx.state !== "running") return;
    const k = resolveSfxKey(key, manifest.sfx);
    if (!k || !throttle.allow(k, performance.now())) return;
    playResolved(k);
  }

  // --- music
  function makeTrack(key: string, entry: MusicEntry): MusicTrack {
    const el = new Audio();
    el.preload = "auto";
    el.loop = entry.loop;
    const primary = assetUrl(base, entry.file);
    const fallback = entry.fallback ? assetUrl(base, entry.fallback) : null;
    const canOgg = el.canPlayType('audio/ogg; codecs="vorbis"') !== "";
    el.src = canOgg || !fallback ? primary : fallback;
    el.addEventListener("error", () => {
      // Ogg can claim support and still fail to decode (some Safari builds): retry with AAC once.
      if (fallback && !el.src.endsWith(entry.fallback!)) {
        el.src = fallback;
        if (unlocked) el.play().catch(() => {});
      }
    });
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(musicBus);
    return { key, el, gain, src };
  }

  function stopTrack(t: MusicTrack) {
    ramp(t.gain.gain, 0, fade);
    setTimeout(() => {
      t.el.pause();
      t.el.removeAttribute("src");
      t.el.load();
      t.src.disconnect();
      t.gain.disconnect();
    }, fade * 1000 + 100);
  }

  function applyMusic() {
    if (!manifest) return;
    const key = wantedMusic;
    if (track?.key === key) return;
    if (track) stopTrack(track);
    track = null;
    const entry = key ? manifest.music[key] : undefined;
    if (!key || !entry) return;
    const t = makeTrack(key, entry);
    track = t;
    ramp(t.gain.gain, clamp01(entry.volume), fade);
    if (unlocked) t.el.play().catch(() => {});
  }

  function setMusicZone(zone: ZoneId | null) {
    wantedMusic = manifest ? musicKeyForZone(zone, manifest.music) : (zone ?? "title");
    applyMusic();
  }

  function setPaused(p: boolean) {
    if (p === paused) return;
    paused = p;
    if (p) {
      track?.el.pause();
      void ctx.suspend().catch(() => {});
      return;
    }
    if (!unlocked || document.hidden) return;
    void ctx.resume().catch(() => {});
    track?.el.play().catch(() => {});
  }

  const controller: AudioController = {
    playSfx,
    setMusicZone,
    setPaused,
    footstep(groundKind) {
      const now = performance.now();
      if (now - lastStep < FOOTSTEP_INTERVAL_MS) return;
      lastStep = now;
      playSfx(footstepKey(groundKind));
    },
    setMuted(muted) {
      settings.muted = muted;
      ramp(master.gain, muted ? 0 : 1, 0.08);
      emit();
    },
    isMuted: () => settings.muted,
    setVolume(channel, value) {
      const v = clamp01(value);
      settings[channel] = v;
      ramp((channel === "music" ? musicBus : sfxBus).gain, v, 0.05);
      emit();
    },
    getVolume: (channel) => settings[channel],
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    ready: () => manifestReady,
  };

  // Sign-in screen plays the title theme until the session picks a zone.
  setMusicZone(null);
  return controller;
}

// --- controls

const STYLE_ID = "dm-audio-style";
const CSS = `
.dm-audio{display:flex;align-items:center;gap:var(--dm-gap,8px);font-family:var(--dm-font-body,sans-serif);font-size:var(--dm-fs-sm,13px);color:var(--dm-text,#3a2a1c)}
.dm-audio button{font:inherit;min-width:36px;height:32px;border:var(--dm-border-w,3px) solid var(--dm-border,#5a3920);border-radius:var(--dm-radius,6px);background:var(--dm-panel-2,#e3d3a8);color:var(--dm-text,#3a2a1c);cursor:pointer;line-height:1}
.dm-audio button:hover{background:var(--dm-cream-2,#ece0c0)}
.dm-audio button:focus-visible,.dm-audio input:focus-visible{outline:2px solid var(--dm-accent,#c0395a);outline-offset:2px}
.dm-audio button[aria-pressed="true"]{background:var(--dm-panel-inner,#b07a48);color:var(--dm-text-on-dark,#f6eed8)}
.dm-audio label{display:flex;align-items:center;gap:4px;white-space:nowrap}
.dm-audio button{display:inline-flex;align-items:center;justify-content:center}
.dm-audio-icon{width:16px;height:16px;flex:none;image-rendering:pixelated}
.dm-audio input[type=range]{width:72px;accent-color:var(--dm-moss,#5d8a3c)}
.dm-audio input:disabled{opacity:.5}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** Speaker toggle plus music and SFX sliders. Returns the root element; call remove() on it to unmount. */
export function mountAudioControls(container: HTMLElement): HTMLElement {
  ensureStyle();
  const audio = active ?? installAudio();
  const root = document.createElement("div");
  root.className = "dm-audio";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = "audio-toggle";

  const slider = (id: string, label: string, channel: AudioChannel) => {
    const wrap = document.createElement("label");
    wrap.title = label;
    const text = menuIcon(channel === "music" ? "music" : "sfx", "dm-audio-icon");
    const input = document.createElement("input");
    input.type = "range";
    input.id = id;
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => audio.setVolume(channel, Number(input.value) / 100));
    if (channel === "sfx") input.addEventListener("change", () => audio.playSfx("click"));
    wrap.appendChild(text);
    wrap.appendChild(input);
    return { wrap, input };
  };
  const music = slider("audio-music", "Music volume", "music");
  const sfx = slider("audio-sfx", "Sound effects volume", "sfx");

  const sync = () => {
    const muted = audio.isMuted();
    toggle.replaceChildren(menuIcon(muted ? "muted" : "sound", "dm-audio-icon"));
    toggle.setAttribute("aria-pressed", String(muted));
    toggle.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
    toggle.title = toggle.getAttribute("aria-label")!;
    music.input.value = String(Math.round(audio.getVolume("music") * 100));
    sfx.input.value = String(Math.round(audio.getVolume("sfx") * 100));
    music.input.disabled = muted;
    sfx.input.disabled = muted;
  };
  toggle.addEventListener("click", () => {
    const wasMuted = audio.isMuted();
    audio.setMuted(!wasMuted);
    if (wasMuted) audio.playSfx("toggle");
  });
  const off = audio.onChange(sync);
  sync();

  for (const n of [toggle, music.wrap, sfx.wrap]) root.appendChild(n);
  container.appendChild(root);
  // Drop the listener when the controls leave the DOM.
  const obs = new MutationObserver(() => {
    if (!root.isConnected) {
      off();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  return root;
}
