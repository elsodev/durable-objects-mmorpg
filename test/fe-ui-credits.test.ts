import { describe, expect, it } from "vitest";
import { CREDIT_FILES, allAuthors, isShareAlike, parseCredits, type CreditDoc } from "../src/client/ui/credits-logic";

interface NodeFs {
  readFileSync(path: string, enc: "utf8"): string;
}
// node:fs through a computed specifier, so the client/worker typechecks don't need Node types.
async function shippedDocs(): Promise<CreditDoc[]> {
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as NodeFs;
  return CREDIT_FILES.map((p) => parseCredits(fs.readFileSync(`src/client/public${p}`, "utf8")));
}

describe("parseCredits", () => {
  it("reads headings, bullet credits, tables and notices", () => {
    const doc = parseCredits(
      [
        "# Pack credits",
        "",
        "All art is LPC.",
        "## Licences",
        "  > Required line by **Someone**, CC BY 4.0.",
        "## props/",
        "### props/barrel.png",
        "- Authors: Alice, Bob",
        "- License: **CC-BY-SA 3.0 / GPL 3.0**",
        "## Music",
        "| File | Title | Author | Licence |",
        "|---|---|---|---|",
        "| `a.ogg` | Song | Carol | CC0 1.0 |",
        "| `b.ogg` | Song | carol | CC0 1.0 |",
        "```",
        "| ignored | in | code | block |",
        "```",
      ].join("\n"),
    );
    expect(doc.title).toBe("Pack credits");
    expect(doc.summary).toBe("All art is LPC.");
    expect(doc.groups.map((g) => g.title)).toEqual(["Licences", "props", "Music"]);
    expect(doc.groups[0]!.notices).toEqual(["Required line by Someone, CC BY 4.0."]);
    expect(doc.groups[1]!.entries).toEqual([
      { name: "props/barrel.png", authors: ["Alice", "Bob"], licenses: ["CC-BY-SA 3.0", "GPL 3.0"], shareAlike: true },
    ]);
    expect(doc.groups[2]!.entries).toEqual([{ name: "Song", authors: ["Carol"], licenses: ["CC0 1.0"], shareAlike: false }]);
  });

  it("never yields markup characters from bold/code spans", () => {
    const doc = parseCredits("## G\n### x\n- Authors: **<b>**, `y`\n");
    expect(doc.groups[0]!.entries[0]!.authors).toEqual(["<b>", "y"]);
  });

  it("flags share-alike licences only", () => {
    expect(isShareAlike("CC-BY-SA 3.0")).toBe(true);
    expect(isShareAlike("CC BY-SA 4.0")).toBe(true);
    expect(isShareAlike("CC BY 4.0")).toBe(false);
    expect(isShareAlike("OGA-BY 3.0")).toBe(false);
  });
});

describe("shipped CREDITS files", () => {
  it("keep the required CC-BY attribution lines", async () => {
    const text = JSON.stringify(await shippedDocs());
    expect(text).toContain("Oculus Audio Pack 01");
    expect(text).toContain("CC BY 4.0");
    expect(text).toContain("columbia23");
    expect(text).toContain("suonho");
    expect(text).toContain("CC BY 3.0");
  });

  it("credit every LPC asset with authors and licences", async () => {
    const docs = await shippedDocs();
    for (const d of docs) {
      for (const g of d.groups) {
        for (const e of g.entries) {
          expect(e.authors.length, `${d.title} / ${e.name}`).toBeGreaterThan(0);
          expect(e.licenses.length, `${d.title} / ${e.name}`).toBeGreaterThan(0);
        }
      }
    }
    const lpc = docs[0]!;
    const names = lpc.groups.flatMap((g) => g.entries.map((e) => e.name));
    expect(names).toContain("characters/player_1.png");
    expect(names).toContain("icons/veggies_shadowless.png");
    expect(lpc.groups.some((g) => g.entries.some((e) => e.shareAlike))).toBe(true);
    const authors = allAuthors(docs);
    for (const a of ["Johannes Sjölund (wulax)", "Lanea Zimmerman (Sharm)", "Kenney (kenney.nl)", "JaidynReiman"]) {
      expect(authors).toContain(a);
    }
  });
});
