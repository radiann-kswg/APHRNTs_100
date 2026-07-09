import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { ClaudeNotesStore } from "../../../src/storage/claude-notes-store.js";
import { openDatabase } from "../../../src/storage/db.js";

describe("ClaudeNotesStore", () => {
  let db: Database;
  let store: ClaudeNotesStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new ClaudeNotesStore(db);
  });

  it("creates a new note on first upsert", () => {
    const row = store.upsert({ date: "2026-07-01", content: "# 2026-07-01\n体調は普通。", sourcePath: "logs/2026-07-01.md" });
    expect(row.date).toBe("2026-07-01");
    expect(row.content).toContain("体調は普通");
  });

  it("overwrites content when the same date is imported again", () => {
    store.upsert({ date: "2026-07-01", content: "旧内容", sourcePath: "logs/2026-07-01.md" });
    const row = store.upsert({ date: "2026-07-01", content: "新内容", sourcePath: "logs/2026-07-01.md" });
    expect(row.content).toBe("新内容");
    expect(store.count()).toBe(1);
  });

  it("lists notes since a given date in ascending order", () => {
    store.upsert({ date: "2026-07-05", content: "b", sourcePath: "logs/2026-07-05.md" });
    store.upsert({ date: "2026-07-01", content: "a", sourcePath: "logs/2026-07-01.md" });
    store.upsert({ date: "2026-06-01", content: "old", sourcePath: "logs/2026-06-01.md" });
    const rows = store.listSince("2026-07-01");
    expect(rows.map((r) => r.date)).toEqual(["2026-07-01", "2026-07-05"]);
  });
});
