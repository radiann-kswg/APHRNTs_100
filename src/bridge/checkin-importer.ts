import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckinInput, CheckinStore } from "../storage/checkin-store.js";
import { parseCreativeLog } from "./creative-log-importer.js";
import { claudeLogDate } from "./log-importer.js";

/**
 * ログから読み取れたチェックインの数値項目。**見つかった項目だけ**を持つ。
 *
 * 気分は scripts/extract-mood.mjs の `気分: N/10` 書式を正典として読む
 * （パーサーの二重管理を避けるため、mood の書式を変えるときは両方を揃えること）。
 * エネルギー（活力）と眠りの質は Health Sheet／logs/README.md の書式に合わせる。
 */
export interface ParsedCheckinLog {
  /** 気分 1〜10（`気分: N/10`） */
  mood?: number;
  /** 活力・エネルギー 1〜10（`エネルギー N/10` / `活力 N/10`） */
  energy?: number;
  /** 眠りの質 1〜5（Health Sheet 5段階。`眠りの質 N`） */
  sleepQuality?: number;
}

/** 全角数字・全角スラッシュ/コロンを半角へ正規化してから数値を読む（ログの表記ゆれ対策） */
function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/／/g, "/")
    .replace(/：/g, ":");
}

function readScore(text: string, re: RegExp, min: number, max: number): number | undefined {
  const raw = normalize(text).match(re)?.[1];
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return n >= min && n <= max ? n : undefined;
}

// 気分: N/10（scripts/extract-mood.mjs の MOOD_RE と同じ。正規化後なので半角コロンで足りる）
const MOOD_RE = /気分\s*:\s*(\d{1,2})\s*\/\s*10/;
// エネルギー N/10 / 活力 N/10。`/10` を必須にして「エネルギーが1まで低下」等の散文を拾わない
const ENERGY_RE = /(?:エネルギー|活力)\s*:?\s*(\d{1,2})\s*\/\s*10/;
// 眠りの質 N（Health Sheet 5段階）。「眠りの質が低かった」等（数字が続かない）は拾わない
const SLEEP_QUALITY_RE = /眠りの質\s*(\d)/;

/**
 * セッション記録（YYYY-MM-DD.md）から気分・エネルギー・眠りの質の数値を読み取る。
 * 見つからない項目は undefined のまま（値を捏造しない）。
 */
export function parseCheckinLog(markdown: string): ParsedCheckinLog {
  const parsed: ParsedCheckinLog = {};
  const mood = readScore(markdown, MOOD_RE, 1, 10);
  if (mood !== undefined) parsed.mood = mood;
  const energy = readScore(markdown, ENERGY_RE, 1, 10);
  if (energy !== undefined) parsed.energy = energy;
  const sleepQuality = readScore(markdown, SLEEP_QUALITY_RE, 1, 5);
  if (sleepQuality !== undefined) parsed.sleepQuality = sleepQuality;
  return parsed;
}

/** creative_progress 補完用の1行要約の最大長（超過分は「…」で切り詰める） */
const CREATIVE_SUMMARY_MAX = 80;

/**
 * 「## 創作活動の進捗」の中身から、daily_checkins.creative_progress 補完用の1行要約を作る。
 * 先頭行（箇条書きの「- 」「* 」は除去）を最大80字に切り詰め、2行目以降があれば「（他N件）」を付す。
 * 全文は creative_logs テーブル（creative-log-importer）が保持するため、こちらは
 * ダイジェストの1行表示（`／ 創作: …`）や記録状況の○/✕判定に耐える短い要約でよい。
 * 内容の生成・言い換えはせず、先頭行の切り出しと件数の付記だけを機械的に行う。
 */
export function summarizeCreativeProgress(progress: string): string {
  const lines = progress
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const first = (lines[0] ?? "").replace(/^[-*]\s+/, "");
  const truncated = first.length > CREATIVE_SUMMARY_MAX ? `${first.slice(0, CREATIVE_SUMMARY_MAX)}…` : first;
  const rest = lines.length - 1;
  return rest > 0 ? `${truncated}（他${rest}件）` : truncated;
}

export interface CheckinMergeResult {
  /** 空いていた項目を1つ以上補完（upsert）した日数 */
  merged: number;
}

/**
 * Claude→Bot方向のチェックイン逆マージ: logs/ の YYYY-MM-DD.md から気分・エネルギー・
 * 眠りの質・創作進捗（1行要約）を読み、daily_checkins へ **「その項目がまだ空（NULL)の
 * 日だけ」** 補完する。
 *
 * 服薬の逆マージ（medication-importer）と対称だが、こちらは**非破壊を徹底**する:
 * Bot側（Misskeyでの直接報告や save_checkin）に既に値がある項目には一切触れない。
 * Claude側にしか記録が無い日（Misskeyへ報告していない日）の抜けだけを埋め、digestの
 * 「記録の抜け」誤検知（Claude側logsにはあるのにSQLiteがNULLで未記入と出る）を解消する。
 * moodEvents（瞬間値の推移）やチェックインのメモも上書き対象にしない。
 *
 * 創作進捗は「## 創作活動の進捗」（creative-log区間）の**先頭行の1行要約**だけを補完する。
 * 全文の取り込みは creative-log-importer（creative_logs テーブル）が担い、こちらは
 * 「創作○/✕」判定とダイジェスト1行表示の抜けを埋める役割に限定する。
 *
 * 日付キーのupsertで冪等。ownerUserId が空の場合は何もしない
 * （logs/ はオーナーの個人記録であり、帰属先を特定できないため）。
 */
export function importCheckinFromLogs(
  logsDir: string,
  store: CheckinStore,
  ownerUserId: string,
  now: Date = new Date(),
): CheckinMergeResult {
  const result: CheckinMergeResult = { merged: 0 };
  if (!ownerUserId || !existsSync(logsDir)) {
    return result;
  }

  for (const filename of readdirSync(logsDir).sort()) {
    const date = claudeLogDate(filename);
    if (!date) {
      continue;
    }
    const markdown = readFileSync(join(logsDir, filename), "utf8");
    const parsed = parseCheckinLog(markdown);
    const creativeProgress = parseCreativeLog(markdown).progress;
    if (
      parsed.mood === undefined &&
      parsed.energy === undefined &&
      parsed.sleepQuality === undefined &&
      creativeProgress === undefined
    ) {
      continue;
    }

    const existing = store.get(ownerUserId, date);
    const input: CheckinInput = { userId: ownerUserId, date };
    let fills = 0;
    if (parsed.mood !== undefined && (existing?.mood ?? null) === null) {
      input.mood = parsed.mood;
      fills += 1;
    }
    if (parsed.energy !== undefined && (existing?.energy ?? null) === null) {
      input.energy = parsed.energy;
      fills += 1;
    }
    if (parsed.sleepQuality !== undefined && (existing?.sleep_quality ?? null) === null) {
      input.sleepQuality = parsed.sleepQuality;
      fills += 1;
    }
    if (creativeProgress !== undefined && (existing?.creative_progress ?? null) === null) {
      input.creativeProgress = summarizeCreativeProgress(creativeProgress);
      fills += 1;
    }
    if (fills === 0) {
      continue; // Bot側に既に全項目そろっている日は触らない（冪等・非破壊）
    }

    store.upsert(input, now);
    result.merged += 1;
  }
  return result;
}
