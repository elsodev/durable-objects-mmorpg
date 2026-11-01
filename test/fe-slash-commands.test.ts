import { describe, expect, it } from "vitest";
import {
  SLASH_COMMANDS,
  enterCompletes,
  moveSelection,
  slashSuggestions,
  type SlashContext,
} from "../src/client/ui/slash-commands";
import { parseChatInput } from "../src/shared/social";
import { parseFriendCommand } from "../src/shared/friends";
import { parseHomeCommand } from "../src/shared/visits";
import { parseMuteCommand } from "../src/shared/players";
import { EMOTES } from "../src/shared/emotes";

const village: SlashContext = { atHome: false, homeOwner: false, guest: false, devTools: false };
const myHome: SlashContext = { atHome: true, homeOwner: true, guest: false, devTools: false };
const visiting: SlashContext = { atHome: true, homeOwner: false, guest: false, devTools: false };
const labels = (input: string, ctx: SlashContext) => slashSuggestions(input, ctx).map((s) => s.label);

describe("slash suggestions", () => {
  it("lists only commands that work where you are", () => {
    const v = labels("/", village);
    expect(v).toEqual(expect.arrayContaining(["/w", "/r", "/world", "/zone", "/emote", "/friend"]));
    expect(v).not.toContain("/invite");
    expect(v).not.toContain("/day");
    const h = labels("/", myHome);
    expect(h).toEqual(expect.arrayContaining(["/invite", "/kick", "/uninvite"]));
    expect(labels("/", visiting)).not.toContain("/kick");
  });

  it("hides account-only commands from guests", () => {
    const g = labels("/", { ...myHome, guest: true });
    expect(g).toContain("/emote");
    expect(g).not.toContain("/w");
    expect(g).not.toContain("/friend");
    expect(g).not.toContain("/invite");
  });

  it("shows dev tools only on dev servers, each where it works", () => {
    expect(labels("/", { ...myHome, devTools: true })).toEqual(expect.arrayContaining(["/day", "/time"]));
    expect(labels("/", { ...myHome, devTools: true })).not.toContain("/hour");
    expect(labels("/", { ...village, devTools: true })).toContain("/hour");
    expect(labels("/", { ...village, devTools: true })).not.toContain("/day");
  });

  it("narrows by name, then alias, as you type", () => {
    expect(labels("/em", village)).toEqual(["/emote"]);
    expect(labels("/w", village)[0]).toBe("/w"); // exact name first
    expect(labels("/w", village)).toContain("/world");
    expect(labels("/whis", village)).toEqual(["/w"]); // alias "whisper"
    expect(labels("/ki", myHome)).toEqual(["/kick"]);
    expect(labels("/xyz", village)).toEqual([]);
    expect(labels("hello", village)).toEqual([]);
    expect(labels("/EM", village)).toEqual(["/emote"]);
  });

  it("completes the command, with a space when it takes arguments", () => {
    const [w] = slashSuggestions("/w", village);
    expect(w).toMatchObject({ completion: "/w ", syntax: "name message" });
    const [day] = slashSuggestions("/da", { ...myHome, devTools: true });
    expect(day!.completion).toBe("/day");
  });

  it("lists emote codes while typing the argument", () => {
    expect(labels("/emote ", village)).toEqual([...EMOTES]);
    expect(labels("/emote s", village)).toEqual(["sad", "sleepy", "surprised", "sweat"]);
    const [wave] = slashSuggestions("/e wa", village);
    expect(wave).toMatchObject({ label: "wave", completion: "/e wave" });
    expect(labels("/emote wave now", village)).toEqual([]);
    expect(labels("/w bob", village)).toEqual([]);
  });

  it("Enter completes only when it would change the text", () => {
    const [w] = slashSuggestions("/w", village);
    expect(enterCompletes("/w", w)).toBe(true);
    const [wave] = slashSuggestions("/emote wave", village);
    expect(enterCompletes("/emote wave", wave)).toBe(false);
    expect(enterCompletes("/emote", undefined)).toBe(false);
  });

  it("moves the highlight with wrap-around", () => {
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(-1, -1, 3)).toBe(2);
    expect(moveSelection(0, 1, 0)).toBe(-1);
  });
});

describe("the command table matches the real handlers", () => {
  it("every chat-routed command and alias is understood by parseChatInput", () => {
    const sample: Record<string, string> = { w: "bob hi", r: "hi", world: "hi", zone: "hi", emote: "wave" };
    const kind: Record<string, string> = { w: "pm", r: "error", world: "world", zone: "zone", emote: "emote" };
    for (const [name, arg] of Object.entries(sample)) {
      const cmd = SLASH_COMMANDS.find((c) => c.name === name)!;
      for (const n of [cmd.name, ...cmd.aliases]) {
        // /r without anyone to reply to is an error, but still the reply command (not zone chat).
        expect(parseChatInput(`/${n} ${arg}`, "all", null)?.kind, `/${n}`).toBe(kind[name]);
      }
    }
  });

  it("friend and home commands are parsed by their own handlers", () => {
    expect(parseFriendCommand("/friend bob")).toEqual({ name: "bob" });
    for (const c of ["invite", "kick", "uninvite"]) {
      expect(SLASH_COMMANDS.some((s) => s.name === c)).toBe(true);
      expect(parseHomeCommand(`/${c} bob`)?.cmd).toBe(c);
    }
  });

  it("mute commands are parsed by parseMuteCommand and offered to accounts only", () => {
    for (const c of ["mute", "unmute"] as const) {
      expect(SLASH_COMMANDS.some((s) => s.name === c)).toBe(true);
      expect(parseMuteCommand(`/${c} bob`)).toEqual({ cmd: c, name: "bob" });
    }
    expect(labels("/", village)).toEqual(expect.arrayContaining(["/mute", "/unmute"]));
    expect(labels("/", { ...village, guest: true })).not.toContain("/mute");
  });

  it("emote options are exactly the emote codes", () => {
    expect(SLASH_COMMANDS.find((c) => c.name === "emote")!.options).toEqual(EMOTES);
  });
});
