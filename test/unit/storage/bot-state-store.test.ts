import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { BotStateStore } from "../../../src/storage/bot-state-store.js";
import { openDatabase } from "../../../src/storage/db.js";

describe("BotStateStore", () => {
  let db: Database;
  let store: BotStateStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new BotStateStore(db);
  });

  it("returns null for an unset key", () => {
    expect(store.get("unknown_key")).toBeNull();
  });

  it("sets and retrieves a value", () => {
    store.set("weekly_summary_last_run_at", "2026-01-01T00:00:00.000Z");
    expect(store.get("weekly_summary_last_run_at")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("overwrites an existing value", () => {
    store.set("key", "first");
    store.set("key", "second");
    expect(store.get("key")).toBe("second");
  });
});
