// Turns the CREDITS markdown files that ship with the assets into a compact list for the Credits
// dialog: one entry per asset/pack with its authors and licences. Pure, so it is unit tested.

export interface CreditEntry {
  name: string;
  authors: string[];
  licenses: string[];
  /** Any listed licence is share-alike (CC-BY-SA), which carries extra terms for derivatives. */
  shareAlike: boolean;
}

export interface CreditGroup {
  title: string;
  /** Required attribution lines (blockquotes in the markdown), shown verbatim. */
  notices: string[];
  entries: CreditEntry[];
}

export interface CreditDoc {
  title: string;
  summary: string;
  groups: CreditGroup[];
}

/** Where the full per-file credits live, relative to the site root (copied from src/client/public). */
export const CREDIT_FILES = [
  "/assets/lpc/CREDITS.md",
  "/assets/lpc/custom/CREDITS-custom.md",
  "/assets/audio/CREDITS.md",
  "/assets/emotes/CREDITS.md",
  "/assets/ui/CREDITS.md",
] as const;

const MAX_TEXT = 400;

function clean(s: string): string {
  return s
    .replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}

/** Split on commas (and " / " for licences) outside parentheses; "Oculus VR, LLC" stays whole. */
function splitList(s: string, slash = false): string[] {
  const text = clean(s);
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    const rest = text.slice(i + 1);
    const comma = ch === "," && !/^\s*(LLC|Inc|Ltd)\b/.test(rest);
    const sl = slash && ch === "/" && text[i - 1] === " " && text[i + 1] === " ";
    if (depth === 0 && (comma || sl)) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function pushUnique(into: string[], items: string[]): void {
  const seen = new Set(into.map((x) => x.toLowerCase()));
  for (const it of items) {
    const k = it.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    into.push(it);
  }
}

export function isShareAlike(license: string): boolean {
  return /\bBY[- ]SA\b/i.test(license);
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

interface TableCols {
  name: number;
  authors: number;
  licenses: number;
}

function tableCols(header: string[]): TableCols | null {
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const authors = find(/^authors?\b/i);
  const licenses = find(/^licen[cs]es?\b/i);
  if (authors < 0 || licenses < 0) return null;
  const titled = find(/title|sheet definition/i);
  return { name: titled >= 0 ? titled : 0, authors, licenses };
}

export function parseCredits(md: string): CreditDoc {
  const doc: CreditDoc = { title: "", summary: "", groups: [] };
  let group: CreditGroup | null = null;
  let heading: string | null = null; // current ### entry name
  let cols: TableCols | null | undefined; // undefined: not in a table
  let inCode = false;
  let wantSummary = false;

  const ensureGroup = (): CreditGroup => {
    if (!group) {
      group = { title: doc.title || "Credits", notices: [], entries: [] };
      doc.groups.push(group);
    }
    return group;
  };
  const entry = (name: string): CreditEntry => {
    const g = ensureGroup();
    let e = g.entries.find((x) => x.name === name);
    if (!e) {
      e = { name, authors: [], licenses: [], shareAlike: false };
      g.entries.push(e);
    }
    return e;
  };
  const credit = (name: string, authors: string[], licenses: string[]) => {
    if (!name) return;
    const e = entry(name);
    pushUnique(e.authors, authors);
    pushUnique(e.licenses, licenses);
    e.shareAlike = e.licenses.some(isShareAlike);
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    if (!line.startsWith("|")) cols = undefined;

    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#\s+(.+)/))) {
      doc.title = clean(m[1]!);
      wantSummary = true;
    } else if ((m = line.match(/^##\s+(.+)/))) {
      group = { title: clean(m[1]!).replace(/\/$/, ""), notices: [], entries: [] };
      doc.groups.push(group);
      heading = null;
      wantSummary = false;
    } else if ((m = line.match(/^###\s+(.+)/))) {
      heading = clean(m[1]!);
      wantSummary = false;
    } else if ((m = line.match(/^\s*>\s?(.*)/))) {
      const text = clean(m[1]!);
      if (text) ensureGroup().notices.push(text);
    } else if ((m = line.match(/^-\s+Authors?:\s*(.+)/i))) {
      if (heading) credit(heading, splitList(m[1]!), []);
    } else if ((m = line.match(/^-\s+Licen[cs]es?:\s*(.+)/i))) {
      if (heading) credit(heading, [], splitList(m[1]!, true));
    } else if ((m = line.match(/^-\s+(.+?)\s+—\s+\*\*(.+?)\*\*/))) {
      // "- authors — **licence** — source" (derived files with several originals)
      if (heading) credit(heading, splitList(m[1]!), splitList(m[2]!, true));
    } else if (line.startsWith("|")) {
      const row = cells(line);
      if (cols === undefined) {
        cols = tableCols(row);
      } else if (cols && !row.every((c) => /^:?-+:?$/.test(c))) {
        const name = heading ?? clean(row[cols.name] ?? "");
        credit(name, splitList(row[cols.authors] ?? ""), splitList(row[cols.licenses] ?? "", true));
      }
    } else if (wantSummary && line.trim()) {
      doc.summary = clean(line);
      wantSummary = false;
    }
  }
  doc.groups = doc.groups.filter((g) => g.entries.length > 0 || g.notices.length > 0);
  return doc;
}

/** Every credited author across the given docs, in first-seen order, case-insensitively unique. */
export function allAuthors(docs: CreditDoc[]): string[] {
  const out: string[] = [];
  for (const d of docs) for (const g of d.groups) for (const e of g.entries) pushUnique(out, e.authors);
  return out;
}
