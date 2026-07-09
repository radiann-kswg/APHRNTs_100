import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBotDigest } from "../../../src/bridge/digest-exporter.js";
import { BehavioralActivationStore } from "../../../src/storage/behavioral-activation-store.js";
import { CheckinStore } from "../../../src/storage/checkin-store.js";
import { openDatabase } from "../../../src/storage/db.js";
import { GratitudeStore } from "../../../src/storage/gratitude-store.js";
import { ThoughtRecordStore } from "../../../src/storage/thought-record-store.js";

const NOW = new Date("2026-07-09T12:00:00.000Z");

describe("buildBotDigest", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  it("reports when there are no records in the period", () => {
    const digest = buildBotDigest(db, { days: 14, now: NOW });
    expect(digest).toContain("記録ダイジェスト");
    expect(digest).toContain("対象期間内にMisskey Bot側の記録はない");
  });

  it("includes checkins, thought records, activities and gratitude entries", () => {
    new CheckinStore(db).upsert(
      { userId: "u1", date: "2026-07-08", mood: 6, sleepHours: 7, energy: 5, creativeProgress: "ラフ1枚" },
      NOW,
    );
    new ThoughtRecordStore(db).create(
      { userId: "u1", situation: "締切前", automaticThought: "間に合わない", emotionLabel: "不安", emotionIntensity: 8, balancedThought: "分割すれば進む", reRatedEmotionIntensity: 5 },
      NOW,
    );
    new BehavioralActivationStore(db).create(
      { userId: "u1", activity: "散歩", predictedPleasure: 4, predictedMastery: 3, status: "completed", actualPleasure: 6, actualMastery: 5 },
      NOW,
    );
    new GratitudeStore(db).create(
      { userId: "u1", date: "2026-07-08", item1: "晴れた", item2: "作業が進んだ", item3: "よく眠れた" },
      NOW,
    );

    const digest = buildBotDigest(db, { days: 14, now: NOW });

    expect(digest).toContain("## 日次チェックイン");
    expect(digest).toContain("2026-07-08: 気分 6/10");
    expect(digest).toContain("創作: ラフ1枚");
    expect(digest).toContain("## 思考記録");
    expect(digest).toContain("自動思考「間に合わない」");
    expect(digest).toContain("バランス思考「分割すれば進む」");
    expect(digest).toContain("## 行動活性化");
    expect(digest).toContain("[completed] 散歩");
    expect(digest).toContain("## 感謝日記");
    expect(digest).toContain("晴れた ／ 作業が進んだ ／ よく眠れた");
  });

  it("excludes records older than the requested period", () => {
    new CheckinStore(db).upsert({ userId: "u1", date: "2026-06-01", mood: 3 }, NOW);
    const digest = buildBotDigest(db, { days: 14, now: NOW });
    expect(digest).not.toContain("2026-06-01");
    expect(digest).toContain("対象期間内にMisskey Bot側の記録はない");
  });

  it("limits records to the owner when ownerUserId is set", () => {
    const store = new CheckinStore(db);
    store.upsert({ userId: "owner", date: "2026-07-08", mood: 7, notes: "オーナーの記録" }, NOW);
    store.upsert({ userId: "other", date: "2026-07-08", mood: 2, notes: "他ユーザーの記録" }, NOW);

    const digest = buildBotDigest(db, { days: 14, now: NOW, ownerUserId: "owner" });

    expect(digest).toContain("オーナーの記録");
    expect(digest).not.toContain("他ユーザーの記録");
    expect(digest).toContain("対象ユーザー: owner");
  });

  it("includes all users when ownerUserId is empty (single-user mode)", () => {
    const store = new CheckinStore(db);
    store.upsert({ userId: "u1", date: "2026-07-08", mood: 7, notes: "A" }, NOW);
    store.upsert({ userId: "u2", date: "2026-07-08", mood: 2, notes: "B" }, NOW);

    const digest = buildBotDigest(db, { days: 14, now: NOW, ownerUserId: "" });

    expect(digest).toContain("メモ: A");
    expect(digest).toContain("メモ: B");
  });
});
