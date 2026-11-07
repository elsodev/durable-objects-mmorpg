// Pure parts of the controls tutorial: what it says and whether this account has seen it.
// The keys listed here mirror game/input.ts (ACTIONS, MOVE, slotForCode), ui/hud-logic.ts
// (shortcutFor) and the click handling in game/session.ts; fe-tutorial.test.ts checks them.

export interface ControlRow {
  /** Key caps shown side by side; "click" and "wheel" are mouse actions. */
  keys: string[];
  text: string;
}

export interface ControlGroup {
  title: string;
  rows: ControlRow[];
}

export const CONTROL_GROUPS: readonly ControlGroup[] = [
  {
    title: "Getting around",
    rows: [
      { keys: ["W", "A", "S", "D"], text: "Walk (arrow keys work too)" },
      { keys: ["click"], text: "Walk to a spot" },
    ],
  },
  {
    title: "Tools",
    rows: [
      { keys: ["1", "–", "8"], text: "Pick a hotbar slot (or the mouse wheel)" },
      { keys: ["Space"], text: "Use the tool or item in your hand (E works too)" },
      { keys: ["click"], text: "Use it on a tile within reach" },
    ],
  },
  {
    title: "Folks & things",
    rows: [
      { keys: ["F"], text: "Talk to a villager or read a sign" },
      { keys: ["click"], text: "Click a villager to walk over and talk" },
      { keys: ["Q"], text: "Give the item in your hand as a gift (at home: eat it)" },
    ],
  },
  {
    title: "Menus",
    rows: [
      { keys: ["I"], text: "Bag" },
      { keys: ["G"], text: "Village goals" },
      { keys: ["O"], text: "Friends" },
      { keys: ["Enter"], text: "Chat" },
      { keys: ["Esc"], text: "Close a menu or cancel" },
    ],
  },
  {
    title: "Home & chat",
    rows: [
      { keys: ["F"], text: "At your bed: sleep and start a new day (or click the bed)" },
      { keys: ["B"], text: "Build mode for furniture; R rotates" },
      { keys: ["T"], text: "Edit your house: drag furniture, Shift-click or drag a box for several, R turns, Del picks up" },
      { keys: ["/emote", "wave"], text: "Emote, or pick one from the smiley button by the chat box" },
      { keys: ["/w", "name"], text: "Whisper to a player" },
    ],
  },
];

/** The same card for touch screens: taps, long-presses and the on-screen controller (ui/gamepad.ts). */
export const TOUCH_CONTROL_GROUPS: readonly ControlGroup[] = [
  {
    title: "Getting around",
    rows: [
      { keys: ["tap"], text: "Walk to a spot" },
      { keys: ["pad"], text: "On a phone, the gamepad button by the bug button brings up a D-pad" },
      { keys: ["»"], text: "Hold Run on the controller to dash" },
    ],
  },
  {
    title: "Tools",
    rows: [
      { keys: ["tap"], text: "Pick a hotbar slot" },
      { keys: ["tap"], text: "Use the tool on a tile within reach" },
      { keys: ["A"], text: "Use the tool or item in your hand" },
    ],
  },
  {
    title: "Folks & things",
    rows: [
      { keys: ["tap"], text: "Tap a villager to walk over and talk" },
      { keys: ["B"], text: "Talk to a villager or read a sign" },
      { keys: ["Q"], text: "Give the item in your hand as a gift (at home: eat it)" },
      { keys: ["hold"], text: "Long-press a player for their card, or an item for Drop" },
    ],
  },
  {
    title: "Menus",
    rows: [
      { keys: ["tap"], text: "The buttons along the bottom: chat, bag and map" },
      { keys: ["tap"], text: "The dots button opens the rest; the eye hides the HUD" },
    ],
  },
];

/** Touch words that read like a gesture, not a key cap. */
export const GESTURE_KEYS: ReadonlySet<string> = new Set(["click", "wheel", "tap", "hold", "pad"]);

const STORAGE_PREFIX = "dmmo.tutorial.v1.";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function tutorialKey(userId: string): string {
  return STORAGE_PREFIX + userId;
}

/** True when this account dismissed the tutorial on this device. Unreadable storage counts as seen, so it never nags. */
export function tutorialSeen(store: KeyValueStore | null | undefined, userId: string): boolean {
  try {
    if (!store) return true;
    return store.getItem(tutorialKey(userId)) === "1";
  } catch {
    return true;
  }
}

export function markTutorialSeen(store: KeyValueStore | null | undefined, userId: string): void {
  try {
    store?.setItem(tutorialKey(userId), "1");
  } catch {
    // Private mode or blocked storage: it may show again next time, which is harmless.
  }
}
