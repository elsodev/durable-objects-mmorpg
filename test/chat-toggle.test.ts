import { describe, expect, it } from "vitest";
import { initialChatHidden, lineWakesDot } from "../src/client/ui/chat-toggle-logic";

describe("chat toggle", () => {
  it("starts hidden unless the player left it open", () => {
    expect(initialChatHidden(() => null)).toBe(true);
    expect(initialChatHidden(() => "1")).toBe(true);
    expect(initialChatHidden(() => "0")).toBe(false);
  });
  it("starts hidden when storage throws", () => {
    expect(
      initialChatHidden(() => {
        throw new Error("blocked");
      }),
    ).toBe(true);
  });
  it("lights the dot for people talking, not system notes", () => {
    expect(lineWakesDot("player")).toBe(true);
    expect(lineWakesDot("npc")).toBe(true);
    expect(lineWakesDot("system")).toBe(false);
  });
});
