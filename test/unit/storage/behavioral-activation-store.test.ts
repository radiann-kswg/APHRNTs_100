import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { BehavioralActivationStore } from "../../../src/storage/behavioral-activation-store.js";
import { openDatabase } from "../../../src/storage/db.js";

describe("BehavioralActivationStore", () => {
  let db: Database;
  let store: BehavioralActivationStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new BehavioralActivationStore(db);
  });

  it("defaults status to planned", () => {
    const row = store.create({ userId: "user1", activity: "散歩" });
    expect(row.status).toBe("planned");
  });

  it("stores predicted and actual ratings", () => {
    const row = store.create({
      userId: "user1",
      activity: "散歩",
      predictedPleasure: 6,
      predictedMastery: 5,
      actualPleasure: 8,
      actualMastery: 7,
      status: "completed",
    });
    expect(row.predicted_pleasure).toBe(6);
    expect(row.actual_pleasure).toBe(8);
    expect(row.status).toBe("completed");
  });

  it("lists rows created since a given timestamp", () => {
    store.create({ userId: "user1", activity: "古い活動" }, new Date("2020-01-01T00:00:00Z"));
    store.create({ userId: "user1", activity: "新しい活動" }, new Date("2026-01-01T00:00:00Z"));
    const rows = store.listSince("user1", "2025-01-01T00:00:00.000Z");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.activity).toBe("新しい活動");
  });
});
