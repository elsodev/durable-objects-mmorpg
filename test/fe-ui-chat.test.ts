import { describe, expect, it } from "vitest";
import { displayLine, MAX_NAME_LEN, nameColor, nameHue, outgoingText } from "../src/client/ui/chat-format";
import { MAX_CHAT_LEN } from "../src/shared/validate";

describe("chat helpers", () => {
  it("gives each name a stable hue", () => {
    expect(nameHue("Willow")).toBe(nameHue("Willow"));
    expect(nameHue("Willow")).toBeGreaterThanOrEqual(0);
    expect(nameHue("Willow")).toBeLessThan(360);
    const hues = new Set(["Ana", "Bo", "Cid", "Dee", "Eli", "Fay"].map(nameHue));
    expect(hues.size).toBeGreaterThan(3);
    expect(nameColor("Ana")).toMatch(/^hsl\(\d+ 70% 72%\)$/);
  });

  it("trims, caps and drops empty outgoing text", () => {
    expect(outgoingText("  hi  ")).toBe("hi");
    expect(outgoingText("   ")).toBeNull();
    expect(outgoingText("x".repeat(500))!.length).toBe(MAX_CHAT_LEN);
    expect(outgoingText("a\nb")).toBe("a b");
  });

  it("sanitizes incoming lines", () => {
    const l = displayLine("n".repeat(80), "hello\u0000world");
    expect(l.name.length).toBe(MAX_NAME_LEN);
    expect(l.text).toBe("hello world");
    expect(displayLine("x", "  ").text).toBe("");
  });
});
