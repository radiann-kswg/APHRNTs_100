import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createToolExecutor } from "../../../../src/bot/tools/handlers.js";
import { BehavioralActivationStore } from "../../../../src/storage/behavioral-activation-store.js";
import { CheckinStore } from "../../../../src/storage/checkin-store.js";
import { openDatabase } from "../../../../src/storage/db.js";
import { GratitudeStore } from "../../../../src/storage/gratitude-store.js";
import { MedicationStore } from "../../../../src/storage/medication-store.js";
import { ThoughtRecordStore } from "../../../../src/storage/thought-record-store.js";

describe("createToolExecutor", () => {
  let db: Database;
  let checkinStore: CheckinStore;
  let thoughtRecordStore: ThoughtRecordStore;
  let gratitudeStore: GratitudeStore;
  let activationStore: BehavioralActivationStore;
  let medicationStore: MedicationStore;
  let executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;

  beforeEach(() => {
    db = openDatabase(":memory:");
    checkinStore = new CheckinStore(db);
    thoughtRecordStore = new ThoughtRecordStore(db);
    gratitudeStore = new GratitudeStore(db);
    activationStore = new BehavioralActivationStore(db);
    medicationStore = new MedicationStore(db);
    executeTool = createToolExecutor(
      "user1",
      { checkinStore, thoughtRecordStore, gratitudeStore, activationStore, medicationStore },
      () => new Date("2026-01-01T00:00:00Z"),
    );
  });

  it("save_checkin persists a row", async () => {
    await executeTool("save_checkin", { date: "2026-01-01", mood: 7 });
    const rows = checkinStore.listSince("user1", "2026-01-01");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mood).toBe(7);
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

  it("returns a message for unknown tools", async () => {
    const result = await executeTool("unknown_tool", {});
    expect(result).toContain("不明");
  });
});
