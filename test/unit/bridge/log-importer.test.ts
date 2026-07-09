import type { Database } from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importClaudeLogs } from "../../../src/bridge/log-importer.js";
import { ClaudeNotesStore } from "../../../src/storage/claude-notes-store.js";
import { openDatabase } from "../../../src/storage/db.js";

describe("importClaudeLogs", () => {
  let db: Database;
  let store: ClaudeNotesStore;
  let logsDir: string;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new ClaudeNotesStore(db);
    logsDir = mkdtempSync(join(tmpdir(), "aphrnts-logs-"));
  });

  afterEach(() => {
    rmSync(logsDir, { recursive: true, force: true });
  });

  it("imports YYYY-MM-DD.md files into the store", () => {
    writeFileSync(join(logsDir, "2026-07-08.md"), "# 2026-07-08\n\n## 体調・気分\nまずまず。", "utf8");
    writeFileSync(join(logsDir, "2026-07-09.md"), "# 2026-07-09\n\n## 体調・気分\n少し疲れ気味。", "utf8");

    const result = importClaudeLogs(logsDir, store);

    expect(result.imported).toBe(2);
    expect(store.listSince("2026-07-08")).toHaveLength(2);
  });

  it("skips README.md, bot-digest.md and other non-date files", () => {
    writeFileSync(join(logsDir, "README.md"), "説明", "utf8");
    writeFileSync(join(logsDir, "bot-digest.md"), "# 自動生成ダイジェスト", "utf8");
    writeFileSync(join(logsDir, "memo.md"), "メモ", "utf8");
    writeFileSync(join(logsDir, "2026-07-09.md"), "記録", "utf8");

    const result = importClaudeLogs(logsDir, store);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(3);
    expect(store.count()).toBe(1);
  });

  it("skips empty files", () => {
    writeFileSync(join(logsDir, "2026-07-09.md"), "   \n", "utf8");
    const result = importClaudeLogs(logsDir, store);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("returns zero counts when the logs directory does not exist", () => {
    const result = importClaudeLogs(join(logsDir, "missing"), store);
    expect(result).toEqual({ imported: 0, skipped: 0 });
  });

  it("re-importing an updated file overwrites the stored content", () => {
    const filePath = join(logsDir, "2026-07-09.md");
    writeFileSync(filePath, "旧内容", "utf8");
    importClaudeLogs(logsDir, store);
    writeFileSync(filePath, "新内容", "utf8");
    importClaudeLogs(logsDir, store);

    const rows = store.listSince("2026-07-09");
    expect(rows[0]?.content).toBe("新内容");
  });
});
