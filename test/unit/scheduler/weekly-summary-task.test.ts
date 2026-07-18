import { describe, expect, it } from "vitest";
import { BehavioralActivationStore } from "../../../src/storage/behavioral-activation-store.js";
import { CheckinStore } from "../../../src/storage/checkin-store.js";
import { openDatabase } from "../../../src/storage/db.js";
import { GratitudeStore } from "../../../src/storage/gratitude-store.js";
import { MedicationStore } from "../../../src/storage/medication-store.js";
import { ThoughtRecordStore } from "../../../src/storage/thought-record-store.js";
import { buildWeeklyTrend, shouldRunNow } from "../../../src/scheduler/weekly-summary-task.js";

describe("shouldRunNow", () => {
  it("returns false when the day of week does not match", () => {
    const now = new Date("2026-01-05T20:00:00+09:00");
    expect(shouldRunNow(null, now, 2, 20)).toBe(false);
  });

  it("returns false when the hour does not match", () => {
    const now = new Date("2026-01-05T20:00:00+09:00");
    expect(shouldRunNow(null, now, 1, 21)).toBe(false);
  });

  it("returns true on the first run within the matching slot", () => {
    const now = new Date("2026-01-05T20:00:00+09:00");
    expect(shouldRunNow(null, now, 1, 20)).toBe(true);
  });

  it("returns false if already run within the last 20 hours", () => {
    const now = new Date("2026-01-05T20:00:00+09:00");
    const lastRunAt = new Date(now.getTime() - 60 * 60 * 1000);
    expect(shouldRunNow(lastRunAt, now, 1, 20)).toBe(false);
  });

  it("returns true if the last run was more than 20 hours ago", () => {
    const now = new Date("2026-01-05T20:00:00+09:00");
    const lastRunAt = new Date(now.getTime() - 21 * 60 * 60 * 1000);
    expect(shouldRunNow(lastRunAt, now, 1, 20)).toBe(true);
  });
});

describe("buildWeeklyTrend", () => {
  it("returns a no-record message when nothing was logged", () => {
    const db = openDatabase(":memory:");
    const deps = {
      checkinStore: new CheckinStore(db),
      activationStore: new BehavioralActivationStore(db),
      gratitudeStore: new GratitudeStore(db),
      thoughtRecordStore: new ThoughtRecordStore(db),
      medicationStore: new MedicationStore(db),
    };
    const trend = buildWeeklyTrend("user1", deps, new Date("2026-01-08T00:00:00Z"));
    expect(trend).toContain("記録がない");
  });

  it("summarizes the mood average when checkins exist", () => {
    const db = openDatabase(":memory:");
    const checkinStore = new CheckinStore(db);
    checkinStore.upsert({ userId: "user1", date: "2026-01-05", mood: 6 });
    checkinStore.upsert({ userId: "user1", date: "2026-01-06", mood: 8 });
    const deps = {
      checkinStore,
      activationStore: new BehavioralActivationStore(db),
      gratitudeStore: new GratitudeStore(db),
      thoughtRecordStore: new ThoughtRecordStore(db),
      medicationStore: new MedicationStore(db),
    };
    const trend = buildWeeklyTrend("user1", deps, new Date("2026-01-08T00:00:00Z"));
    expect(trend).toContain("7.0");
  });

  it("includes a medication line when medication records exist", () => {
    const db = openDatabase(":memory:");
    const medicationStore = new MedicationStore(db);
    medicationStore.upsert({ userId: "user1", date: "2026-01-05", morningTaken: true, prnCount: 2 });
    const deps = {
      checkinStore: new CheckinStore(db),
      activationStore: new BehavioralActivationStore(db),
      gratitudeStore: new GratitudeStore(db),
      thoughtRecordStore: new ThoughtRecordStore(db),
      medicationStore,
    };
    const trend = buildWeeklyTrend("user1", deps, new Date("2026-01-08T00:00:00Z"));
    expect(trend).toContain("服薬の記録は1日分あった");
    expect(trend).toContain("頓服は計2回");
  });
});
