import type { Database } from "better-sqlite3";
import { CLAUDE_BRIDGE_DIGEST_DAYS } from "../config/constants.js";
import { ClaudeNotesStore } from "../storage/claude-notes-store.js";
import { MedicationStore } from "../storage/medication-store.js";
import { buildBotDigest, writeBotDigest } from "./digest-exporter.js";
import { importClaudeLogs, type ImportResult } from "./log-importer.js";
import { importMedicationFromLogs } from "./medication-importer.js";

export interface BridgeSyncDeps {
  db: Database;
  /** Claudeのセッション記録が置かれるディレクトリ（既定: logs/） */
  logsDir: string;
  /** Bot記録ダイジェストの出力先（既定: logs/bot-digest.md） */
  digestPath: string;
  /** ダイジェストに含める日数（既定: CLAUDE_BRIDGE_DIGEST_DAYS） */
  digestDays?: number;
  /** Bot管理者のMisskeyユーザーID。指定時はダイジェスト出力をこのユーザーの記録に限定する */
  ownerUserId?: string;
  now?: () => Date;
}

/** runImport の結果。セッション記録の取り込みに加え、服薬の逆マージ件数を持つ */
export interface ImportSummary extends ImportResult {
  /** 服薬チェックをbot DBへ逆マージした日数（ownerUserId 未設定時は常に0） */
  medicationMerged: number;
}

export interface BridgeSyncResult {
  import: ImportSummary;
  digestPath: string;
}

/**
 * Claude→Bot（logs/取り込み）のみを実行する。
 * セッション記録の取り込みに加えて、ownerUserId が設定されていれば
 * 「## 服薬」セクションのチェック済みスロットを medication_logs へ逆マージする
 * （Claude/Health Sheet側の服薬記録を正とする仕様変更）。
 */
export function runImport(deps: BridgeSyncDeps): ImportSummary {
  const store = new ClaudeNotesStore(deps.db);
  const now = deps.now?.() ?? new Date();
  const result = importClaudeLogs(deps.logsDir, store, now);
  const medication = deps.ownerUserId
    ? importMedicationFromLogs(deps.logsDir, new MedicationStore(deps.db), deps.ownerUserId, now)
    : { merged: 0 };
  return { ...result, medicationMerged: medication.merged };
}

/** Bot→Claude（ダイジェスト書き出し）のみを実行する */
export function runExport(deps: BridgeSyncDeps): string {
  const digest = buildBotDigest(deps.db, {
    days: deps.digestDays ?? CLAUDE_BRIDGE_DIGEST_DAYS,
    now: deps.now?.() ?? new Date(),
    ownerUserId: deps.ownerUserId,
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
