import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/storage/db.js";
import { UserPreferenceStore } from "../../../src/storage/user-preference-store.js";

describe("UserPreferenceStore", () => {
  let db: Database;
  let store: UserPreferenceStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new UserPreferenceStore(db);
  });

  it("defaults to hotline guidance enabled and post analysis disabled for unknown users", () => {
    expect(store.get("nobody")).toEqual({ crisisHotlineEnabled: true, postAnalysisEnabled: false });
    expect(store.isCrisisHotlineEnabled("nobody")).toBe(true);
    expect(store.isPostAnalysisEnabled("nobody")).toBe(false);
  });

  it("opts a user in and out of post analysis without touching the hotline setting", () => {
    store.setCrisisHotlineEnabled("u1", false);
    store.setPostAnalysisEnabled("u1", true);
    expect(store.get("u1")).toEqual({ crisisHotlineEnabled: false, postAnalysisEnabled: true });
    expect(store.isPostAnalysisEnabled("u2")).toBe(false);

    store.setPostAnalysisEnabled("u1", false);
    expect(store.get("u1")).toEqual({ crisisHotlineEnabled: false, postAnalysisEnabled: false });
  });

  it("keeps the hotline default when post analysis is the first setting a user touches", () => {
    store.setPostAnalysisEnabled("fresh", true);
    expect(store.get("fresh")).toEqual({ crisisHotlineEnabled: true, postAnalysisEnabled: true });
  });

  it("disables and re-enables hotline guidance per user", () => {
    store.setCrisisHotlineEnabled("u1", false, new Date("2026-09-11T00:00:00Z"));
    expect(store.isCrisisHotlineEnabled("u1")).toBe(false);
    // 他ユーザーには影響しない
    expect(store.isCrisisHotlineEnabled("u2")).toBe(true);

    const updated = store.setCrisisHotlineEnabled("u1", true);
    expect(updated.crisisHotlineEnabled).toBe(true);
    expect(store.isCrisisHotlineEnabled("u1")).toBe(true);
  });

  it("records updated_at on write", () => {
    store.setCrisisHotlineEnabled("u1", false, new Date("2026-09-11T01:02:03Z"));
    const row = db.prepare("SELECT updated_at FROM user_preferences WHERE user_id = ?").get("u1") as {
      updated_at: string;
    };
    expect(row.updated_at).toBe("2026-09-11T01:02:03.000Z");
  });
});
