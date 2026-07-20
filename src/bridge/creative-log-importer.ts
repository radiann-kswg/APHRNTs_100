import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CreativeLogStore } from "../storage/creative-log-store.js";
import { claudeLogDate } from "./log-importer.js";

// ---------------------------------------------------------------------------
// Claude→Bot方向の創作進捗・タスク記録の取り込み: logs/ の creative-log 区間
// （## 創作活動の進捗・## 取り組んだタスク）を creative_logs テーブルへ upsert する。
//
// - 書式の正典は logs/README.md（creative-log:start〜:end マーカー。
//   マーカーが無い日は見出しから直接読む）。
// - この区間の書き手はClaude作業ログ自動記録（Claude側が正）のため、
//   服薬の逆マージと同じく**日付キーの上書きupsert（冪等）**とする。
// ---------------------------------------------------------------------------

export interface ParsedCreativeLog {
  /** 「## 創作活動の進捗」の中身（トリム済みMarkdown）。セクションが無い/空なら undefined */
  progress?: string;
  /** 「## 取り組んだタスク」の中身（トリム済みMarkdown）。セクションが無い/空なら undefined */
  tasks?: string;
}

function sectionBody(markdown: string, headingPattern: string): string | undefined {
  const re = new RegExp(`##\\s*${headingPattern}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  const body = markdown.match(re)?.[1];
  if (body === undefined) return undefined;
  const stripped = body.replace(/<!--[\s\S]*?-->/g, "").trim();
  return stripped.length > 0 ? stripped : undefined;
}

/**
 * セッション記録（YYYY-MM-DD.md）から創作進捗・タスク記録を読み取る。
 * creative-log マーカー区間があればその中を優先し、無ければファイル全体から見出しで探す
 * （マーカー導入前の過去ログも取り込めるようにするため）。
 */
export function parseCreativeLog(markdown: string): ParsedCreativeLog {
  const marker = markdown.match(/<!--\s*creative-log:start\s*-->([\s\S]*?)<!--\s*creative-log:end\s*-->/);
  const scope = marker?.[1] ?? markdown;
  const parsed: ParsedCreativeLog = {};
  const progress = sectionBody(scope, "創作活動の進捗");
  if (progress !== undefined) parsed.progress = progress;
  const tasks = sectionBody(scope, "取り組んだタスク");
  if (tasks !== undefined) parsed.tasks = tasks;
  return parsed;
}

export interface CreativeLogMergeResult {
  /** 創作進捗・タスク記録を取り込み（upsert）した日数 */
  merged: number;
}

/**
 * logs/ 配下の YYYY-MM-DD.md から創作進捗・タスク記録を読み取り、creative_logs へ upsert する。
 * Claude側の記録が正のため上書きで反映する（冪等）。どちらのセクションも無い日はスキップ。
 * ownerUserId が空の場合は何もしない（logs/ はオーナーの個人記録であり、帰属先を特定できないため）。
 */
export function importCreativeLogsFromLogs(
  logsDir: string,
  store: CreativeLogStore,
  ownerUserId: string,
  now: Date = new Date(),
): CreativeLogMergeResult {
  const result: CreativeLogMergeResult = { merged: 0 };
  if (!ownerUserId || !existsSync(logsDir)) {
    return result;
  }

  for (const filename of readdirSync(logsDir).sort()) {
    const date = claudeLogDate(filename);
    if (!date) continue;
    const parsed = parseCreativeLog(readFileSync(join(logsDir, filename), "utf8"));
    if (parsed.progress === undefined && parsed.tasks === undefined) continue;

    // 内容が変わっていない日のupsertはスキップ（updated_atを無駄に進めない）
    const existing = store.get(ownerUserId, date);
    if (existing && existing.progress === (parsed.progress ?? null) && existing.tasks === (parsed.tasks ?? null)) {
      continue;
    }
    store.upsert({ userId: ownerUserId, date, ...parsed }, now);
    result.merged += 1;
  }
  return result;
}
