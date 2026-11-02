import { describe, expect, it } from "vitest";
import { applyVoteCounts, composeState, readPosts, readVoteCounts } from "../src/client/ui/notice-board-logic";
import { NOTICE_COST, NOTICE_MAX_LEN } from "../src/shared/notices";
import { THUMB_DOWN, THUMB_UP } from "../src/client/ui/notice-icons";

const T0 = 1_800_000_000_000;
const post = { id: "n1", author: "Ann", text: "hi", at: T0, likes: 1, dislikes: 0, vote: 1 as const, mine: false };

describe("notice board panel logic", () => {
  it("patches live vote counts and keeps your own vote", () => {
    const next = applyVoteCounts([post, { ...post, id: "n2" }], "n1", 4, 2);
    expect(next[0]).toMatchObject({ likes: 4, dislikes: 2, vote: 1 });
    expect(next[1]).toMatchObject({ likes: 1, dislikes: 0 });
    expect(readVoteCounts({ t: "noticeVotes", id: "n1", likes: 2, dislikes: 0 })).toEqual({ id: "n1", likes: 2, dislikes: 0 });
    expect(readVoteCounts({ t: "noticeVotes", id: "n1", likes: -1, dislikes: 0 })).toBeNull();
  });

  it("reads only well-formed posts", () => {
    expect(readPosts([post, { id: 3 }, null, { ...post, id: "n2", vote: 7, likes: "x" }])).toEqual([post, { ...post, id: "n2", vote: 0, likes: 0 }]);
    expect(readPosts("nope")).toEqual([]);
  });

  it("enables Pin only with text, enough coins and no cooldown", () => {
    expect(composeState("", 500, undefined, T0, false).canPin).toBe(false);
    expect(composeState("hello", 500, undefined, T0, false)).toEqual({ canPin: true, hint: `Pinning costs ${NOTICE_COST} coins.`, left: `${NOTICE_MAX_LEN - 5} left` });
    expect(composeState("hello", 50, undefined, T0, false)).toMatchObject({ canPin: false, hint: `You need ${NOTICE_COST} coins (you have 50).` });
    expect(composeState("hello", 500, T0 + 90_000, T0, false)).toMatchObject({ canPin: false, hint: "You can pin another notice in 2m." });
    expect(composeState("hello", 500, undefined, T0, true).canPin).toBe(false);
  });

  it("draws square 12x12 thumbs, the dislike one upside down", () => {
    expect(THUMB_UP).toHaveLength(12);
    for (const row of THUMB_UP) expect(row).toHaveLength(12);
    expect(THUMB_DOWN[0]).toBe(THUMB_UP[11]);
  });
});
