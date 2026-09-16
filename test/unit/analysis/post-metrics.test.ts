import { describe, expect, it } from "vitest";
import {
  aggregateDailyMetrics,
  isCountableNote,
  normalizeNoteText,
  type UserNote,
} from "../../../src/analysis/post-metrics.js";

const OWNER = "owner1";
const options = { ownerUserId: OWNER };

function note(overrides: Partial<UserNote> & { id: string; createdAt: string }): UserNote {
  return {
    userId: OWNER,
    text: "きょうも作業した",
    visibility: "public",
    ...overrides,
  };
}

describe("normalizeNoteText", () => {
  it("removes mentions, URLs, custom emoji and hashtags", () => {
    const normalized = normalizeNoteText(
      "@friend@example.com これ見て https://example.com/a/b :momo_smile: #ナンバーテールズ よかった",
    );
    expect(normalized).toBe("これ見て よかった");
  });

  it("does not leave the host name of a URL behind", () => {
    expect(normalizeNoteText("参考 https://hospital.example.jp/page?x=1 まで")).toBe("参考 まで");
  });

  it("returns an empty string for null / empty text", () => {
    expect(normalizeNoteText(null)).toBe("");
    expect(normalizeNoteText(undefined)).toBe("");
    expect(normalizeNoteText("")).toBe("");
  });
});

describe("isCountableNote", () => {
  it("rejects notes written by anyone other than the owner", () => {
    const foreign = note({ id: "a", createdAt: "2026-09-10T03:00:00Z", userId: "someone-else" });
    expect(isCountableNote(foreign, options)).toBe(false);
  });

  it("rejects plain renotes but keeps quote renotes (the owner's own comment)", () => {
    const plain = note({ id: "a", createdAt: "2026-09-10T03:00:00Z", renoteId: "x", text: null });
    const quote = note({ id: "b", createdAt: "2026-09-10T03:00:00Z", renoteId: "x", text: "これ分かる" });
    expect(isCountableNote(plain, options)).toBe(false);
    expect(isCountableNote(quote, options)).toBe(true);
  });

  it("rejects channel notes, deleted notes and non-listed visibilities", () => {
    expect(isCountableNote(note({ id: "a", createdAt: "2026-09-10T03:00:00Z", channelId: "ch" }), options)).toBe(false);
    expect(
      isCountableNote(note({ id: "b", createdAt: "2026-09-10T03:00:00Z", deletedAt: "2026-09-11T00:00:00Z" }), options),
    ).toBe(false);
    expect(isCountableNote(note({ id: "c", createdAt: "2026-09-10T03:00:00Z", visibility: "specified" }), options)).toBe(
      false,
    );
    expect(isCountableNote(note({ id: "d", createdAt: "2026-09-10T03:00:00Z", visibility: "followers" }), options)).toBe(
      false,
    );
  });

  it("accepts followers-only notes when the visibility is opted in", () => {
    const followersOnly = note({ id: "a", createdAt: "2026-09-10T03:00:00Z", visibility: "followers" });
    expect(isCountableNote(followersOnly, { ownerUserId: OWNER, visibilities: ["public", "home", "followers"] })).toBe(
      true,
    );
  });
});

describe("aggregateDailyMetrics", () => {
  it("groups by JST date, not UTC (23:59 and 00:00 JST are different days)", () => {
    const metrics = aggregateDailyMetrics(
      [
        // 2026-09-10 23:59 JST
        note({ id: "a", createdAt: "2026-09-10T14:59:00Z" }),
        // 2026-09-11 00:00 JST
        note({ id: "b", createdAt: "2026-09-10T15:00:00Z" }),
      ],
      options,
    );
    expect(metrics.map((m) => m.date)).toEqual(["2026-09-10", "2026-09-11"]);
    expect(metrics[0]?.postCount).toBe(1);
    expect(metrics[1]?.postCount).toBe(1);
  });

  it("counts JST 00:00-04:59 as night posts and excludes 05:00", () => {
    const metrics = aggregateDailyMetrics(
      [
        note({ id: "a", createdAt: "2026-09-10T15:00:00Z" }), // 00:00 JST
        note({ id: "b", createdAt: "2026-09-10T19:59:00Z" }), // 04:59 JST
        note({ id: "c", createdAt: "2026-09-10T20:00:00Z" }), // 05:00 JST
      ],
      options,
    );
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.postCount).toBe(3);
    expect(metrics[0]?.nightPostCount).toBe(2);
  });

  it("counts replies, CW, attachments, chars and the busiest JST hour", () => {
    const metrics = aggregateDailyMetrics(
      [
        note({ id: "a", createdAt: "2026-09-10T01:00:00Z", text: "12345", replyId: "r1" }),
        note({ id: "b", createdAt: "2026-09-10T01:30:00Z", text: "123", cw: "ぐち" }),
        note({ id: "c", createdAt: "2026-09-10T01:45:00Z", text: "12", fileIds: ["f1", "f2"] }),
        note({ id: "d", createdAt: "2026-09-10T05:00:00Z", text: "1" }),
      ],
      options,
    );
    const day = metrics[0];
    expect(day?.postCount).toBe(4);
    expect(day?.replyCount).toBe(1);
    expect(day?.cwCount).toBe(1);
    expect(day?.attachmentPostCount).toBe(1);
    expect(day?.totalChars).toBe(11);
    expect(day?.maxBurstPerHour).toBe(3);
    expect(day?.firstPostAt).toBe("2026-09-10T01:00:00.000Z");
    expect(day?.lastPostAt).toBe("2026-09-10T05:00:00.000Z");
  });

  it("never counts a third party's note even if the API returned one", () => {
    const metrics = aggregateDailyMetrics(
      [
        note({ id: "a", createdAt: "2026-09-10T01:00:00Z" }),
        note({ id: "b", createdAt: "2026-09-10T02:00:00Z", userId: "someone-else", text: "他人の投稿" }),
      ],
      options,
    );
    expect(metrics[0]?.postCount).toBe(1);
  });

  it("skips notes with an unparsable timestamp instead of throwing", () => {
    const metrics = aggregateDailyMetrics([note({ id: "a", createdAt: "not-a-date" })], options);
    expect(metrics).toEqual([]);
  });
});
