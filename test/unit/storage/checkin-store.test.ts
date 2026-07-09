import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { CheckinStore } from "../../../src/storage/checkin-store.js";
import { openDatabase } from "../../../src/storage/db.js";

describe("CheckinStore", () => {
  let db: Database;
  let store: CheckinStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new CheckinStore(db);
  });

  it("creates a new row on first upsert", () => {
    const row = store.upsert({ userId: "user1", date: "2026-01-01", mood: 5 });
    expect(row.mood).toBe(5);
  });

  it("merges fields on subsequent upserts for the same day", () => {
    store.upsert({ userId: "user1", date: "2026-01-01", mood: 5 });
    const row = store.upsert({ userId: "user1", date: "2026-01-01", sleepHours: 7 });
    expect(row.mood).toBe(5);
    expect(row.sleep_hours).toBe(7);
  });

  it("lists rows since a given date", () => {
    store.upsert({ userId: "user1", date: "2026-01-01", mood: 5 });
    store.upsert({ userId: "user1", date: "2026-01-05", mood: 6 });
    const rows = store.listSince("user1", "2026-01-03");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe("2026-01-05");
  });
});
