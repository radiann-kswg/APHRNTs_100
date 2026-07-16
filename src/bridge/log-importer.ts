import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeNotesStore } from "../storage/claude-notes-store.js";

/** logs/ 配下でClaudeのセッション記録として扱うファイル名（YYYY-MM-DD.md のみ） */
const LOG_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.md$/;

/**
 * ファイル名がClaudeのセッション記録（YYYY-MM-DD.md）であればその日付を返す。
 * 対象外（README.md・bot-digest.md・weekly-YYYY-MM-DD.md 等）なら undefined。
 * 取り込み（本ファイル）と本番VMへの転送（remote-push）で対象範囲を揃えるために共有する。
 */
export function claudeLogDate(filename: string): string | undefined {
  return LOG_FILE_PATTERN.exec(filename)?.[1];
}

export interface ImportResult {
  /** 取り込んだ（新規または上書きした）ファイル数 */
  imported: number;
  /** パターン不一致・空ファイルなどでスキップした .md ファイル数 */
  skipped: number;
}

/**
 * Claude→Bot方向の連携: logs/ 配下の YYYY-MM-DD.md を claude_session_notes へ取り込む。
 *
 * - `README.md` や `bot-digest.md`（Bot→Claude方向の自動生成物）など、
 *   日付形式でないファイルは対象外。
 * - 空ファイルはスキップする。
 * - logs/ ディレクトリ自体が存在しない場合は何もしない（エラーにしない）。
 */
export function importClaudeLogs(
  logsDir: string,
  store: ClaudeNotesStore,
  now: Date = new Date(),
): ImportResult {
  const result: ImportResult = { imported: 0, skipped: 0 };
  if (!existsSync(logsDir)) {
    return result;
  }

  const filenames = readdirSync(logsDir).filter((name) => name.endsWith(".md")).sort();
  for (const filename of filenames) {
    const date = claudeLogDate(filename);
    if (!date) {
      result.skipped += 1;
      continue;
    }
    const sourcePath = join(logsDir, filename);
    const content = readFileSync(sourcePath, "utf8");
    if (content.trim().length === 0) {
      result.skipped += 1;
      continue;
    }
    store.upsert({ date, content, sourcePath }, now);
    result.imported += 1;
  }
  return result;
}
