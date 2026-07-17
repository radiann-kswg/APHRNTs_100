import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/storage/db.js";
import { MoodEventStore } from "../../../src/storage/mood-event-store.js";

const NOW = new Date("2026-07-15T03:00:00.000Z");

describe("MoodEventStore", () => {
  let db: Database;
  let store: MoodEventStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new MoodEventStore(db);
  });

  it("creates a mood event with timepoint and note", () => {
    const row = store.create(
      { userId: "u1", date: "2026-07-15", timepoint: "朝", mood: 7, note: "運動後" },
      NOW,
    );
    expect(row.user_id).toBe("u1");
    expect(row.date).toBe("2026-07-15");
    expect(row.timepoint).toBe("朝");
    expect(row.mood).toBe(7);
    expect(row.note).toBe("運動後");
    expect(row.recorded_at).toBe(NOW.toISOString());
  });

  it("allows multiple events per day and lists them in recorded order", () => {
    store.create(
      { userId: "u1", date: "2026-07-15", timepoint: "朝", mood: 6, recordedAt: "2026-07-14T22:00:00.000Z" },
      NOW,
    );
    store.create(
      { userId: "u1", date: "2026-07-15", timepoint: "昼", mood: 3, recordedAt: "2026-07-15T03:00:00.000Z" },
      NOW,
    );
    store.create(
      { userId: "u1", date: "2026-07-14", timepoint: "夜", mood: 5, recordedAt: "2026-07-14T12:00:00.000Z" },
      NOW,
    );

    const rows = store.listSince("u1", "2026-07-14");
    expect(rows.map((r) => `${r.date}:${r.timepoint}${r.mood}`)).toEqual([
      "2026-07-14:夜5",
      "2026-07-15:朝6",
      "2026-07-15:昼3",
    ]);
  });

  it("filters by user and since date", () => {
    store.create({ userId: "u1", date: "2026-07-10", mood: 5 }, NOW);
    store.create({ userId: "u2", date: "2026-07-15", mood: 8 }, NOW);
    expect(store.listSince("u1", "2026-07-14")).toHaveLength(0);
    expect(store.listSince("u2", "2026-07-14")).toHaveLength(1);
  });
});
