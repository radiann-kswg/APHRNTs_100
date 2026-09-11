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

  it("defaults to hotline guidance enabled for unknown users", () => {
    expect(store.get("nobody")).toEqual({ crisisHotlineEnabled: true });
    expect(store.isCrisisHotlineEnabled("nobody")).toBe(true);
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
