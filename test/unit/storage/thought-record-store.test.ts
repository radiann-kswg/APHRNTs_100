import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/storage/db.js";
import { ThoughtRecordStore } from "../../../src/storage/thought-record-store.js";

describe("ThoughtRecordStore", () => {
  let db: Database;
  let store: ThoughtRecordStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new ThoughtRecordStore(db);
  });

  it("creates a row with the given fields", () => {
    const row = store.create({
      userId: "user1",
      situation: "発表で失敗した",
      automaticThought: "おれはダメだ",
      emotionLabel: "不安",
      emotionIntensity: 80,
      distortionId: "all_or_nothing",
      evidenceFor: "うまく話せなかった",
      evidenceAgainst: "内容自体は伝わっていた",
      balancedThought: "完璧ではなかったが、伝わった部分もある",
      reRatedEmotionIntensity: 40,
    });

    expect(row.situation).toBe("発表で失敗した");
    expect(row.emotion_intensity).toBe(80);
    expect(row.re_rated_emotion_intensity).toBe(40);
  });

  it("lists rows created since a given timestamp", () => {
    store.create({ userId: "user1", situation: "古い記録" }, new Date("2020-01-01T00:00:00Z"));
    store.create({ userId: "user1", situation: "新しい記録" }, new Date("2026-01-01T00:00:00Z"));
    const rows = store.listSince("user1", "2025-01-01T00:00:00.000Z");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.situation).toBe("新しい記録");
  });
});
