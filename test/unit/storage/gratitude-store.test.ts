import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/storage/db.js";
import { GratitudeStore } from "../../../src/storage/gratitude-store.js";

describe("GratitudeStore", () => {
  let db: Database;
  let store: GratitudeStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new GratitudeStore(db);
  });

  it("creates a row with three items", () => {
    const row = store.create({ userId: "user1", date: "2026-01-01", item1: "a", item2: "b", item3: "c" });
    expect(row.item1).toBe("a");
    expect(row.item3).toBe("c");
  });

  it("lists rows since a given date", () => {
    store.create({ userId: "user1", date: "2026-01-01", item1: "a", item2: "b", item3: "c" });
    store.create({ userId: "user1", date: "2026-01-05", item1: "d", item2: "e", item3: "f" });
    const rows = store.listSince("user1", "2026-01-03");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe("2026-01-05");
  });
});
