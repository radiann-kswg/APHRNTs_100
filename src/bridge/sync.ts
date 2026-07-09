import type { Database } from "better-sqlite3";
import { CLAUDE_BRIDGE_DIGEST_DAYS } from "../config/constants.js";
import { ClaudeNotesStore } from "../storage/claude-notes-store.js";
import { buildBotDigest, writeBotDigest } from "./digest-exporter.js";
import { importClaudeLogs, type ImportResult } from "./log-importer.js";

export interface BridgeSyncDeps {
  db: Database;
  /** Claudeのセッション記録が置かれるディレクトリ（既定: logs/） */
  logsDir: string;
  /** Bot記録ダイジェストの出力先（既定: logs/bot-digest.md） */
  digestPath: string;
  /** ダイジェストに含める日数（既定: CLAUDE_BRIDGE_DIGEST_DAYS） */
  digestDays?: number;
  now?: () => Date;
}

export interface BridgeSyncResult {
  import: ImportResult;
  digestPath: string;
}

/** Claude→Bot（logs/取り込み）のみを実行する */
export function runImport(deps: BridgeSyncDeps): ImportResult {
  const store = new ClaudeNotesStore(deps.db);
  return importClaudeLogs(deps.logsDir, store, deps.now?.() ?? new Date());
}

/** Bot→Claude（ダイジェスト書き出し）のみを実行する */
export function runExport(deps: BridgeSyncDeps): string {
  const digest = buildBotDigest(deps.db, {
    days: deps.digestDays ?? CLAUDE_BRIDGE_DIGEST_DAYS,
    now: deps.now?.() ?? new Date(),
  });
  writeBotDigest(deps.digestPath, digest);
  return deps.digestPath;
}

/** 双方向同期: logs/ の取り込み → ダイジェストの書き出し の順で実行する */
export function runSync(deps: BridgeSyncDeps): BridgeSyncResult {
  const importResult = runImport(deps);
  const digestPath = runExport(deps);
  return { import: importResult, digestPath };
}
