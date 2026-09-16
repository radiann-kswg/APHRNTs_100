import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/storage/db.js";

describe("openDatabase", () => {
  it("adds post_analysis_enabled to a user_preferences table created before the column existed", () => {
    // 稼働中の本番DBを作り直さずに済ませるための最小マイグレーションの回帰テスト。
    // schema.sql の CREATE TABLE IF NOT EXISTS は既存テーブルの列追加には効かない。
    const dir = mkdtempSync(join(tmpdir(), "aphrnts-db-"));
    const dbPath = join(dir, "legacy.db");
    try {
      const legacy = new Database(dbPath);
      legacy.exec(
        `CREATE TABLE user_preferences (
           user_id TEXT PRIMARY KEY,
           crisis_hotline_enabled INTEGER NOT NULL DEFAULT 1,
           updated_at TEXT NOT NULL
         );
         INSERT INTO user_preferences (user_id, crisis_hotline_enabled, updated_at)
         VALUES ('u1', 0, '2026-09-01T00:00:00.000Z');`,
      );
      legacy.close();

      const db = openDatabase(dbPath);
      const row = db.prepare("SELECT * FROM user_preferences WHERE user_id = ?").get("u1") as {
        crisis_hotline_enabled: number;
        post_analysis_enabled: number;
      };
      // 既存の設定は保たれ、新しい列は既定OFFで埋まる
      expect(row.crisis_hotline_enabled).toBe(0);
      expect(row.post_analysis_enabled).toBe(0);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
