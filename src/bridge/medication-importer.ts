import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MedicationStore } from "../storage/medication-store.js";
import { claudeLogDate } from "./log-importer.js";

// scripts/extract-medication.mjs と同じセクション・ラベル定義（logs/README.md の正典書式）。
// パーサーの二重管理を避けるため、変更時は両方を揃えること。
const MEDICATION_SECTION_RE = /##\s*服薬\s*\n([\s\S]*?)(?=\n##\s|$)/;

const SLOT_LABELS = {
  morningTaken: "朝🌄",
  middayTaken: "日中☀️",
  afterMealTaken: "食後🍽",
  nightTaken: "夜🌙",
} as const;

type SlotKey = keyof typeof SLOT_LABELS;

/**
 * ログから読み取れた服薬情報。**チェック済み（[x]）のスロットだけ** true を持つ。
 *
 * Health Sheetのテンプレートは全スロットを `[ ]` で事前に並べるため、未チェックは
 * 「意図的な未服用の報告」と「まだ記入していないだけ」を区別できない。そのため
 * `[ ]` と記載なしはどちらも undefined（bot DBへ触らない）として扱い、
 * digestの「記録の抜け」検知（NULL＝未記入）と、Botへ直接報告した記録を壊さない。
 */
export interface ParsedMedicationLog {
  morningTaken?: true;
  middayTaken?: true;
  afterMealTaken?: true;
  nightTaken?: true;
  prnCount?: number;
  prnNotes?: string;
}

function slotChecked(sectionText: string, label: string): boolean {
  const re = new RegExp(`${label}\\s*[:：]?\\s*\\[([xX])\\]`);
  return re.test(sectionText);
}

function parsePrn(sectionText: string): { prnCount?: number; prnNotes?: string } {
  const m = sectionText.match(/発作時⚡\s*[:：]?\s*(.*)/);
  const raw = m?.[1];
  if (raw === undefined) {
    return {};
  }
  const text = raw.replace(/^→\s*/, "").trim();
  if (text.length === 0) {
    return {};
  }
  const count = text.match(/(\d+)\s*回/)?.[1];
  return {
    prnNotes: text,
    ...(count !== undefined ? { prnCount: Number.parseInt(count, 10) } : {}),
  };
}

/**
 * セッション記録（YYYY-MM-DD.md）の「## 服薬」セクションから、服薬済みチェックとPRN記述を読み取る。
 * セクションが無い・チェックが1つも無い場合は空のオブジェクトを返す（呼び出し側で反映をスキップする）。
 */
export function parseMedicationLog(markdown: string): ParsedMedicationLog {
  const section = markdown.match(MEDICATION_SECTION_RE)?.[1];
  if (section === undefined) {
    return {};
  }
  const parsed: ParsedMedicationLog = { ...parsePrn(section) };
  for (const key of Object.keys(SLOT_LABELS) as SlotKey[]) {
    if (slotChecked(section, SLOT_LABELS[key])) {
      parsed[key] = true;
    }
  }
  return parsed;
}

export interface MedicationMergeResult {
  /** 服薬情報を1件以上読み取り、bot DBへ反映（upsert）した日数 */
  merged: number;
}

/**
 * Claude→Bot方向の服薬逆マージ: logs/ 配下の YYYY-MM-DD.md から服薬チェックを読み取り、
 * medication_logs へ upsert する。Claude（Health Sheet）側の記録を正とする仕様変更に基づき、
 * **チェック済み（[x]）のスロットとPRN記述だけ**をbot DBへ上書きし、
 * 未チェック・記載なしのスロットはbot側の既存記録（Misskeyでの直接報告を含む）に一切触れない。
 *
 * 取り込みは日付キーのupsertで冪等。ownerUserId が空の場合は何もしない
 * （logs/ はオーナーの個人記録であり、帰属先を特定できないため）。
 */
export function importMedicationFromLogs(
  logsDir: string,
  store: MedicationStore,
  ownerUserId: string,
  now: Date = new Date(),
): MedicationMergeResult {
  const result: MedicationMergeResult = { merged: 0 };
  if (!ownerUserId || !existsSync(logsDir)) {
    return result;
  }

  const filenames = readdirSync(logsDir).sort();
  for (const filename of filenames) {
    const date = claudeLogDate(filename);
    if (!date) {
      continue;
    }
    const parsed = parseMedicationLog(readFileSync(join(logsDir, filename), "utf8"));
    if (Object.keys(parsed).length === 0) {
      continue;
    }
    store.upsert({ userId: ownerUserId, date, ...parsed }, now);
    result.merged += 1;
  }
  return result;
}
