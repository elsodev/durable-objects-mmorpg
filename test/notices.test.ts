import { describe, expect, it } from "vitest";
import {
  cleanNoticeText,
  cooldownLeft,
  nextVote,
  NOTICE_COOLDOWN_MS,
  NOTICE_COST,
  NOTICE_MAX_LEN,
  NOTICE_MAX_POSTS,
  NOTICE_TTL_MS,
  timeAgo,
} from "../src/shared/notices";
import { MAX_VOTERS, NoticeBoard, sanitizeRecord } from "../src/worker/social/board";
import { NoticeDesk, WATCH_MS, type DeskHost } from "../src/worker/social/noticeDesk";
import { boardInReach, chargeNotice, refundNotice } from "../src/worker/game/notices";
import { validateClientMsg } from "../src/shared/validate";
import { getMap } from "../src/shared/maps";

const T0 = 1_800_000_000_000;
const MIN = 60_000;

describe("notice text", () => {
  it("caps the length by characters, never splitting an emoji", () => {
    expect(cleanNoticeText("a".repeat(500))).toHaveLength(NOTICE_MAX_LEN);
    const emoji = cleanNoticeText("🐔".repeat(300))!;
    expect(Array.from(emoji)).toHaveLength(NOTICE_MAX_LEN);
    expect(emoji).toBe("🐔".repeat(NOTICE_MAX_LEN));
  });

  it("strips control and invisible format characters and squeezes spaces", () => {
    expect(cleanNoticeText("  Lost\n\nhen\t\u0000near   the well  ")).toBe("Lost hen near the well");
    expect(cleanNoticeText("evil‮eman​")).toBe("evileman");
    expect(cleanNoticeText("<b>hi</b>")).toBe("<b>hi</b>"); // shown with textContent, never as HTML
  });

  it("refuses empty or non-string text", () => {
    expect(cleanNoticeText("  \n​ ")).toBeNull();
    expect(cleanNoticeText(42)).toBeNull();
    expect(cleanNoticeText(undefined)).toBeNull();
  });

  it("is validated on the way in", () => {
    expect(validateClientMsg({ t: "noticePost", text: " hi\u0007there " })).toEqual({ t: "noticePost", text: "hi there" });
    expect(validateClientMsg({ t: "noticePost", text: "" })).toBeNull();
    expect(validateClientMsg({ t: "noticeVote", id: "abc123", press: "like" })).toEqual({ t: "noticeVote", id: "abc123", press: "like" });
    expect(validateClientMsg({ t: "noticeVote", id: "abc", press: "love" })).toBeNull();
    expect(validateClientMsg({ t: "noticeVote", id: "../x", press: "like" })).toBeNull();
    expect(validateClientMsg({ t: "noticeDelete", id: "x".repeat(40) })).toBeNull();
    expect(validateClientMsg({ t: "noticeDelete", id: "abc", extra: 1 })).toEqual({ t: "noticeDelete", id: "abc" });
  });
});

describe("timeAgo", () => {
  it("reads like a note on a board", () => {
    expect(timeAgo(T0, T0)).toBe("just now");
    expect(timeAgo(T0 - 59_000, T0)).toBe("just now");
    expect(timeAgo(T0 - 5 * MIN, T0)).toBe("5m ago");
    expect(timeAgo(T0 - 59 * MIN, T0)).toBe("59m ago");
    expect(timeAgo(T0 - 60 * MIN, T0)).toBe("1h ago");
    expect(timeAgo(T0 - 23 * 60 * MIN, T0)).toBe("23h ago");
    expect(timeAgo(T0 - 2 * 24 * 60 * MIN, T0)).toBe("2d ago");
    expect(timeAgo(T0 - 15 * 24 * 60 * MIN, T0)).toBe("2w ago");
  });

  it("treats a time from the future (clock skew) as just now", () => {
    expect(timeAgo(T0 + 30 * MIN, T0)).toBe("just now");
    expect(timeAgo(Number.NaN, T0)).toBe("just now");
  });

  it("says how long the posting cooldown has left", () => {
    expect(cooldownLeft(undefined, T0)).toBeNull();
    expect(cooldownLeft(T0, T0)).toBeNull();
    expect(cooldownLeft(T0 + 20_000, T0)).toBe("20s");
    expect(cooldownLeft(T0 + 4 * MIN + 1, T0)).toBe("5m");
  });
});

describe("notice fee", () => {
  it("takes 200 coins synchronously and refuses when you can't afford it", () => {
    expect(NOTICE_COST).toBe(200);
    const rich = { coins: 250 };
    expect(chargeNotice(rich)).toBe(true);
    expect(rich.coins).toBe(50);
    expect(chargeNotice(rich)).toBe(false);
    expect(rich.coins).toBe(50);
    refundNotice(rich);
    expect(rich.coins).toBe(250);
    const exact = { coins: 200 };
    expect(chargeNotice(exact)).toBe(true);
    expect(exact.coins).toBe(0);
  });
});

describe("where the board can be used", () => {
  it("stands in the village square and in the town hall, and nowhere else shared", () => {
    for (const zone of ["village", "int_townhall"] as const) {
      const map = getMap(zone);
      const board = map.props.find((p) => p.type === "notice_board")!;
      expect(board, zone).toBeTruthy();
      expect(boardInReach(map, { x: board.x + 1, y: board.y + board.h + 1 })).toBe(true);
      expect(boardInReach(map, { x: board.x + 20, y: board.y + 20 })).toBe(false);
    }
    expect(getMap("riverside").props.some((p) => p.type === "notice_board")).toBe(false);
  });
});

describe("vote rules", () => {
  it("toggles: same press removes, the other switches", () => {
    expect(nextVote(0, "like")).toBe(1);
    expect(nextVote(1, "like")).toBe(0);
    expect(nextVote(1, "dislike")).toBe(-1);
    expect(nextVote(-1, "dislike")).toBe(0);
    expect(nextVote(-1, "like")).toBe(1);
  });

  it("one vote per player, no votes on your own notice", () => {
    const b = new NoticeBoard();
    expect(b.post("ann", "Ann", "Selling turnips", T0, "n1").ok).toBe(true);
    const own = b.vote("n1", "ann", "like");
    expect(own).toEqual({ ok: false, reason: "You can't vote on your own notice." });
    b.vote("n1", "bob", "like");
    b.vote("n1", "bob", "like"); // took it back
    b.vote("n1", "cat", "like");
    b.vote("n1", "dan", "dislike");
    b.vote("n1", "cat", "dislike"); // switched
    const v = b.view("bob")[0]!;
    expect([v.likes, v.dislikes, v.vote]).toEqual([0, 2, 0]);
    const c = b.view("cat")[0]!;
    expect(c.vote).toBe(-1);
    expect(b.view("ann")[0]!.mine).toBe(true);
    expect(b.vote("nope", "bob", "like").ok).toBe(false);
  });

  it("caps voters per notice so one stored value stays small", () => {
    const b = new NoticeBoard();
    b.post("ann", "Ann", "Hi", T0, "n1");
    for (let i = 0; i < MAX_VOTERS; i++) expect(b.vote("n1", `u${i}`, "like").ok).toBe(true);
    expect(b.vote("n1", "late", "like").ok).toBe(false);
    expect(b.vote("n1", "u1", "dislike").ok).toBe(true); // existing voters may still switch
  });
});

describe("posting rules", () => {
  it("one post per player per cooldown", () => {
    const b = new NoticeBoard();
    expect(b.post("ann", "Ann", "first", T0, "n1").ok).toBe(true);
    const again = b.post("ann", "Ann", "second", T0 + MIN, "n2");
    expect(again.ok).toBe(false);
    expect(!again.ok && again.reason).toMatch(/4m/);
    expect(b.nextPostAt("ann", T0 + MIN)).toBe(T0 + NOTICE_COOLDOWN_MS);
    expect(b.post("bob", "Bob", "mine", T0 + MIN, "n3").ok).toBe(true);
    expect(b.post("ann", "Ann", "second", T0 + NOTICE_COOLDOWN_MS, "n2").ok).toBe(true);
  });

  it("a retried post with the same request id is pinned once", () => {
    const b = new NoticeBoard();
    const a = b.post("ann", "Ann", "hello", T0, "n1", "req-1");
    const again = b.post("ann", "Ann", "hello", T0 + 10, "n2", "req-1");
    expect(again.ok && a.ok && again.record.id).toBe("n1");
    expect(b.size).toBe(1);
  });

  it("keeps the newest 50, newest first", () => {
    const b = new NoticeBoard();
    for (let i = 0; i < NOTICE_MAX_POSTS + 3; i++) b.post(`u${i}`, `U${i}`, `note ${i}`, T0 + i * 1000, `n${i}`);
    expect(b.size).toBe(NOTICE_MAX_POSTS);
    const shown = b.view("x");
    expect(shown[0]!.text).toBe(`note ${NOTICE_MAX_POSTS + 2}`);
    expect(shown.at(-1)!.text).toBe("note 3");
  });

  it("notices come down after a week", () => {
    const b = new NoticeBoard();
    b.post("ann", "Ann", "old", T0, "n1");
    b.post("bob", "Bob", "new", T0 + 3 * 24 * 60 * MIN, "n2");
    expect(b.prune(T0 + NOTICE_TTL_MS - 1)).toEqual([]);
    expect(b.prune(T0 + NOTICE_TTL_MS)).toEqual(["n1"]);
    expect(b.view("x").map((v) => v.id)).toEqual(["n2"]);
  });

  it("only the author can take a notice down", () => {
    const b = new NoticeBoard();
    b.post("ann", "Ann", "hi", T0, "n1");
    expect(b.remove("n1", "bob").ok).toBe(false);
    expect(b.remove("n1", "ann").ok).toBe(true);
    expect(b.size).toBe(0);
  });

  it("hides notices from people the viewer muted, but never your own", () => {
    const b = new NoticeBoard();
    b.post("ann", "Ann", "hi", T0, "n1");
    b.post("bob", "Bob", "yo", T0 + 1, "n2");
    expect(b.view("cat", new Set(["ann"])).map((v) => v.id)).toEqual(["n2"]);
    expect(b.view("ann", new Set(["ann"])).map((v) => v.id)).toEqual(["n2", "n1"]);
  });

  it("drops bad stored records and strips self-votes", () => {
    expect(sanitizeRecord({ id: "n1", authorId: "a", author: "A", text: "", at: T0, votes: {} })).toBeNull();
    const r = sanitizeRecord({ id: "n1", authorId: "a", author: "A", text: "hi", at: T0, votes: { a: 1, b: -1, c: 5 } })!;
    expect(r.votes).toEqual({ b: -1 });
  });
});

/** The parts of DO storage the desk uses, with structured clones like the real thing. */
class MemStorage {
  data = new Map<string, unknown>();
  async get(k: string): Promise<unknown> {
    return structuredClone(this.data.get(k));
  }
  async put(k: string, v: unknown): Promise<void> {
    this.data.set(k, structuredClone(v));
  }
  async delete(k: string | string[]): Promise<number> {
    let n = 0;
    for (const key of Array.isArray(k) ? k : [k]) if (this.data.delete(key)) n++;
    return n;
  }
  async list(opts: { prefix: string }): Promise<Map<string, unknown>> {
    return new Map([...this.data].filter(([k]) => k.startsWith(opts.prefix)).map(([k, v]) => [k, structuredClone(v)]));
  }
}

function host(storage: MemStorage, now: () => number, opts: { guests?: string[]; muted?: Record<string, string[]> } = {}) {
  const watching = new Map<string, number>();
  const pushed: { to: string; payload: any }[] = [];
  const h: DeskHost = {
    storage: storage as unknown as DeskHost["storage"],
    mutedBy: async (u) => new Set(opts.muted?.[u] ?? []),
    watch: (u, until) => void watching.set(u, until),
    watchers: (t) => [...watching].filter(([, until]) => until > t).map(([u]) => u),
    push: (to, payload) => void pushed.push({ to, payload }),
    isGuest: (u) => (opts.guests ?? []).includes(u),
    chatMuted: () => false,
  };
  void now;
  return { h, pushed, watching };
}

describe("notice desk (SocialRoom storage and live updates)", () => {
  it("persists posts, votes and the cooldown across a restart", async () => {
    const storage = new MemStorage();
    const { h } = host(storage, () => T0);
    const desk = await NoticeDesk.load(h);
    expect((await desk.post("ann", "Ann", "Hens for sale", "n1", "r1", T0)).ok).toBe(true);
    await desk.vote("bob", "n1", "like", T0 + 1);
    await desk.vote("cat", "n1", "dislike", T0 + 2);

    const again = await NoticeDesk.load(host(storage, () => T0).h);
    const seen = await again.list("bob", T0 + 3);
    expect(seen.posts).toHaveLength(1);
    expect(seen.posts[0]).toMatchObject({ id: "n1", author: "Ann", text: "Hens for sale", likes: 1, dislikes: 1, vote: 1, mine: false });
    const ann = await again.post("ann", "Ann", "again", "n2", "r2", T0 + MIN);
    expect(ann.ok).toBe(false);
    expect(ann.nextPostAt).toBe(T0 + NOTICE_COOLDOWN_MS);
  });

  it("removes the oldest from storage when the board is full, and expired ones on the next call", async () => {
    const storage = new MemStorage();
    const desk = await NoticeDesk.load(host(storage, () => T0).h);
    for (let i = 0; i <= NOTICE_MAX_POSTS; i++) await desk.post(`u${i}`, `U${i}`, `note ${i}`, `n${i}`, `r${i}`, T0 + i);
    const keys = [...storage.data.keys()].filter((k) => k.startsWith("notice:"));
    expect(keys).toHaveLength(NOTICE_MAX_POSTS);
    expect(storage.data.has("notice:n0")).toBe(false);
    await desk.list("x", T0 + NOTICE_TTL_MS + 100);
    expect([...storage.data.keys()].filter((k) => k.startsWith("notice:"))).toHaveLength(0);
  });

  it("pushes new notices and vote counts to everyone looking, wherever they are", async () => {
    const storage = new MemStorage();
    const { h, pushed } = host(storage, () => T0, { muted: { dan: ["ann"] } });
    const desk = await NoticeDesk.load(h);
    await desk.list("bob", T0);
    await desk.list("dan", T0);
    await desk.post("ann", "Ann", "Fair on Friday", "n1", "r1", T0);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const toBob = pushed.find((p) => p.to === "bob" && p.payload.t === "notices")!;
    expect(toBob.payload.posts.map((p: any) => p.id)).toEqual(["n1"]);
    const toDan = pushed.find((p) => p.to === "dan" && p.payload.t === "notices")!;
    expect(toDan.payload.posts).toEqual([]); // dan muted ann
    expect(pushed.some((p) => p.to === "ann")).toBe(false); // the author has the answer already

    pushed.length = 0;
    await desk.vote("bob", "n1", "like", T0 + 1);
    expect(pushed).toEqual([
      { to: "dan", payload: { t: "noticeVotes", id: "n1", likes: 1, dislikes: 0 } },
      { to: "ann", payload: { t: "noticeVotes", id: "n1", likes: 1, dislikes: 0 } },
    ]);

    pushed.length = 0;
    await desk.list("x", T0 + WATCH_MS + 10);
    await desk.vote("x", "n1", "dislike", T0 + WATCH_MS + 20);
    expect(pushed).toEqual([]); // everyone else stopped looking long ago
  });

  it("guests can read but not pin or vote", async () => {
    const storage = new MemStorage();
    const desk = await NoticeDesk.load(host(storage, () => T0, { guests: ["gus"] }).h);
    await desk.post("ann", "Ann", "hi", "n1", "r1", T0);
    expect((await desk.list("gus", T0)).posts).toHaveLength(1);
    expect((await desk.post("gus", "Gus", "me too", "n2", "r2", T0)).ok).toBe(false);
    expect((await desk.vote("gus", "n1", "like", T0)).ok).toBe(false);
  });
});
