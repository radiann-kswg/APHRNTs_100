import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createToolExecutor } from "../../../../src/bot/tools/handlers.js";
import { BehavioralActivationStore } from "../../../../src/storage/behavioral-activation-store.js";
import { CheckinStore } from "../../../../src/storage/checkin-store.js";
import { openDatabase } from "../../../../src/storage/db.js";
import { GratitudeStore } from "../../../../src/storage/gratitude-store.js";
import { MedicationStore } from "../../../../src/storage/medication-store.js";
import { MoodEventStore } from "../../../../src/storage/mood-event-store.js";
import { ThoughtRecordStore } from "../../../../src/storage/thought-record-store.js";

describe("createToolExecutor", () => {
  let db: Database;
  let checkinStore: CheckinStore;
  let thoughtRecordStore: ThoughtRecordStore;
  let gratitudeStore: GratitudeStore;
  let activationStore: BehavioralActivationStore;
  let medicationStore: MedicationStore;
  let moodEventStore: MoodEventStore;
  let executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;

  beforeEach(() => {
    db = openDatabase(":memory:");
    checkinStore = new CheckinStore(db);
    thoughtRecordStore = new ThoughtRecordStore(db);
    gratitudeStore = new GratitudeStore(db);
    activationStore = new BehavioralActivationStore(db);
    medicationStore = new MedicationStore(db);
    moodEventStore = new MoodEventStore(db);
    executeTool = createToolExecutor(
      "user1",
      { checkinStore, thoughtRecordStore, gratitudeStore, activationStore, medicationStore, moodEventStore },
      () => new Date("2026-01-01T00:00:00Z"),
    );
  });

  it("save_checkin persists a row", async () => {
    await executeTool("save_checkin", { date: "2026-01-01", mood: 7 });
    const rows = checkinStore.listSince("user1", "2026-01-01");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mood).toBe(7);
  });

  it("save_checkin defaults the omitted date to today in JST, not UTC", async () => {
    // UTC 2026-07-11T20:00:00Z is already 2026-07-12 in JST (early morning) — this
    // reproduces the reported bug where a late-night/early-morning save landed on the wrong day.
    const jstBoundaryExecuteTool = createToolExecutor(
      "user1",
      { checkinStore, thoughtRecordStore, gratitudeStore, activationStore, medicationStore, moodEventStore },
      () => new Date("2026-07-11T20:00:00Z"),
    );
    await jstBoundaryExecuteTool("save_checkin", { mood: 5 });
    const rows = checkinStore.listSince("user1", "2026-07-01");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe("2026-07-12");
  });

  it("save_medication persists a row with tri-state slots", async () => {
    await executeTool("save_medication", { date: "2026-01-01", morningTaken: true, nightTaken: false });
    const rows = medicationStore.listSince("user1", "2026-01-01");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.morning_taken).toBe(1);
    expect(rows[0]?.night_taken).toBe(0);
    expect(rows[0]?.midday_taken).toBeNull();
  });

  it("save_thought_record persists a row", async () => {
    await executeTool("save_thought_record", {
      situation: "会議で失敗した",
      automaticThought: "おれはダメだ",
    });
    const rows = thoughtRecordStore.listSince("user1", "2025-01-01T00:00:00.000Z");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.situation).toBe("会議で失敗した");
  });

  it("save_gratitude persists a row", async () => {
    await executeTool("save_gratitude", { date: "2026-01-01", item1: "a", item2: "b", item3: "c" });
    const rows = gratitudeStore.listSince("user1", "2026-01-01");
    expect(rows).toHaveLength(1);
  });

  it("save_activity persists a row", async () => {
    await executeTool("save_activity", { activity: "散歩" });
    const rows = activationStore.listSince("user1", "2025-01-01T00:00:00.000Z");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.activity).toBe("散歩");
  });

  it("save_activity handles a missing activity gracefully", async () => {
    const result = await executeTool("save_activity", {});
    expect(result).toContain("読み取れなかった");
  });

  it("get_recent_records reports missing vs present fields across a mix of recorded and unrecorded days", async () => {
    // now() is fixed to 2026-01-01T00:00:00Z in beforeEach, which is 2026-01-01 in JST.
    checkinStore.upsert({
      userId: "user1",
      date: "2026-01-01",
      mood: 8,
      sleepHours: 7,
      sleepQuality: 4,
      energy: 6,
      creativeProgress: "書けた",
      notes: "調子いい",
    });
    medicationStore.upsert({ userId: "user1", date: "2026-01-01", morningTaken: true });

    checkinStore.upsert({ userId: "user1", date: "2025-12-31", mood: 5 });
    // 2025-12-30: nothing recorded at all.

    const result = await executeTool("get_recent_records", { days: 3 });

    expect(result).toContain("2025-12-30: 記録なし（全項目未記録）");
    expect(result).toContain("2025-12-31: 気分○ 睡眠✕ エネルギー✕ 創作✕ 服薬✕ メモ✕");
    expect(result).toContain("2026-01-01: 気分○ 睡眠○ エネルギー○ 創作○ 服薬○ メモ○");
  });

  it("get_recent_records clamps the days parameter to [1, 14]", async () => {
    const tooMany = await executeTool("get_recent_records", { days: 100 });
    expect(tooMany.split("\n")).toHaveLength(15); // header + 14 date lines

    const tooFew = await executeTool("get_recent_records", { days: 0 });
    expect(tooFew.split("\n")).toHaveLength(2); // header + 1 date line
  });

  it("returns a message for unknown tools", async () => {
    const result = await executeTool("unknown_tool", {});
    expect(result).toContain("不明");
  });
  it("save_mood_event persists a timepoint mood record", async () => {
    const result = await executeTool("save_mood_event", { date: "2026-01-01", timepoint: "朝", mood: 7, note: "運動後" });
    expect(result).toContain("2026-01-01");
    expect(result).toContain("朝");
    const rows = moodEventStore.listSince("user1", "2026-01-01");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mood).toBe(7);
    expect(rows[0]?.timepoint).toBe("朝");
    expect(rows[0]?.note).toBe("運動後");
  });

  it("save_mood_event defaults the omitted date to today in JST", async () => {
    const jstBoundaryExecuteTool = createToolExecutor(
      "user1",
      { checkinStore, thoughtRecordStore, gratitudeStore, activationStore, medicationStore, moodEventStore },
      () => new Date("2026-07-11T20:00:00Z"), // JSTでは2026-07-12
    );
    await jstBoundaryExecuteTool("save_mood_event", { mood: 4 });
    const rows = moodEventStore.listSince("user1", "2026-07-12");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe("2026-07-12");
  });

  it("save_mood_event without a mood value asks again instead of saving", async () => {
    const result = await executeTool("save_mood_event", { date: "2026-01-01", timepoint: "夜" });
    expect(result).toContain("読み取れなかった");
    expect(moodEventStore.listSince("user1", "2026-01-01")).toHaveLength(0);
  });
});
