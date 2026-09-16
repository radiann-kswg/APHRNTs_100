import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export function openDatabase(dbPath: string): Database.Database {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  const schema = readFileSync(join(moduleDir, "schema.sql"), "utf8");
  db.exec(schema);
  addMissingColumns(db);
  return db;
}

/**
 * schema.sql の CREATE TABLE IF NOT EXISTS は**既存テーブルへの列追加には効かない**ため、
 * 後から増えた列だけをここで補う（稼働中のDBを作り直さずに済ませるための最小のマイグレーション）。
 */
function addMissingColumns(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(user_preferences)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "post_analysis_enabled")) {
    db.exec("ALTER TABLE user_preferences ADD COLUMN post_analysis_enabled INTEGER NOT NULL DEFAULT 0");
  }
}
