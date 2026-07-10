import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/storage/db.js";
import { MedicationStore } from "../../../src/storage/medication-store.js";

describe("MedicationStore", () => {
  let db: Database;
  let store: MedicationStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new MedicationStore(db);
  });

  it("creates a new row on first upsert", () => {
    const row = store.upsert({ userId: "user1", date: "2026-01-01", morningTaken: true });
    expect(row.morning_taken).toBe(1);
    expect(row.night_taken).toBeNull();
  });

  it("treats unspecified slots as null (not reported), not as false", () => {
    const row = store.upsert({ userId: "user1", date: "2026-01-01" });
    expect(row.morning_taken).toBeNull();
    expect(row.midday_taken).toBeNull();
    expect(row.after_meal_taken).toBeNull();
    expect(row.night_taken).toBeNull();
  });

  it("merges slots on subsequent upserts for the same day without clobbering existing values", () => {
    store.upsert({ userId: "user1", date: "2026-01-01", morningTaken: true });
    const row = store.upsert({ userId: "user1", date: "2026-01-01", nightTaken: false });
    expect(row.morning_taken).toBe(1);
    expect(row.night_taken).toBe(0);
  });

  it("stores PRN count and notes", () => {
    const row = store.upsert({ userId: "user1", date: "2026-01-01", prnCount: 2, prnNotes: "頭痛時" });
    expect(row.prn_count).toBe(2);
    expect(row.prn_notes).toBe("頭痛時");
  });

  it("lists rows since a given date", () => {
    store.upsert({ userId: "user1", date: "2026-01-01", morningTaken: true });
    store.upsert({ userId: "user1", date: "2026-01-05", morningTaken: false });
    const rows = store.listSince("user1", "2026-01-03");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe("2026-01-05");
  });
});
