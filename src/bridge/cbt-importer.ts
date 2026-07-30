import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BehavioralActivationStore } from "../storage/behavioral-activation-store.js";
import type { GratitudeStore } from "../storage/gratitude-store.js";
import type { ThoughtRecordStore } from "../storage/thought-record-store.js";
import { claudeLogDate } from "./log-importer.js";

// ---------------------------------------------------------------------------
// Claude→Bot方向のCBT記録逆マージ: logs/ の「## 思考記録」「## 行動活性化」「## 感謝日記」を
// thought_records / behavioral_activation_logs / gratitude_logs へ取り込む。
//
// - 書式の正典は logs/README.md（思考記録はHealth Sheetの health-sheet:tr 区間の
//   ラベル付き箇条書き。例は logs/2026-07-18.md）。
// - 逆マージは**非破壊**: Bot側（save_thought_record 等のツール経由）に同じ日の記録が
//   既にある日は一切触れない。Claude側にしか記録が無い日の抜けだけを埋める。
// - 冪等: 取り込んだ記録の created_at はその日の正午（JST）に固定するため、
//   2回目以降の実行では「同じ日に記録あり」と判定されてスキップされる。
// ---------------------------------------------------------------------------

/** 対象日Dの JST 一日ぶんの [開始, 終了) をISOで返す（created_at の重複判定用） */
export function jstDayRange(date: string): { fromIso: string; toIso: string } {
  const from = new Date(`${date}T00:00:00+09:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

/** 取り込んだ記録に与える created_at（その日の正午JST。時刻情報はログに無いため固定値） */
export function jstNoonOf(date: string): Date {
  return new Date(`${date}T12:00:00+09:00`);
}

/** 見出し（`## 思考記録` など・「（モヤモヤがあった日だけ）」等の接尾辞も許容）の中身を取り出す */
function sectionBody(markdown: string, headingPattern: string): string | undefined {
  const re = new RegExp(`##\\s*${headingPattern}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  return markdown.match(re)?.[1];
}

/** マーカーコメントを除いた実質的な中身（空なら undefined） */
function meaningfulBody(section: string | undefined): string | undefined {
  if (section === undefined) return undefined;
  const stripped = section.replace(/<!--[\s\S]*?-->/g, "").trim();
  return stripped.length > 0 ? stripped : undefined;
}

/** 「（未確認）」「（未記入）」などのプレースホルダーは「値なし」として扱う */
function meaningfulValue(raw: string | undefined): string | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  if (/^[（(]?(未確認|未記入|なし|—|-)/.test(text)) return undefined;
  return text;
}

// --- 思考記録（TR） ---------------------------------------------------------

export interface ParsedThoughtRecord {
  situation?: string;
  automaticThought?: string;
  emotionLabel?: string;
  emotionIntensity?: number;
  distortionId?: string;
  evidenceFor?: string;
  evidenceAgainst?: string;
  balancedThought?: string;
  reRatedEmotionIntensity?: number;
}

/** そのまま文字列として取り込むフィールドのラベル対応（Health Sheetのhealth-sheet:tr区間の書式） */
type TrTextField = "situation" | "automaticThought" | "distortionId" | "evidenceFor" | "evidenceAgainst" | "balancedThought";
const TR_TEXT_LABELS: Array<[RegExp, TrTextField]> = [
  [/^状況/, "situation"],
  [/^自動思考/, "automaticThought"],
  [/^認知の歪み/, "distortionId"],
  [/^根拠/, "evidenceFor"],
  [/^反証/, "evidenceAgainst"],
  [/^バランス思考/, "balancedThought"],
];

function parsePercent(text: string): number | undefined {
  const m = text.match(/(\d{1,3})\s*[%％]/);
  if (!m) return undefined;
  const n = Number.parseInt(m[1] as string, 10);
  return n >= 0 && n <= 100 ? n : undefined;
}

/**
 * 「## 思考記録」セクション（ラベル付き箇条書き）をパースする。
 * ラベルに対応する値が「（未確認）」等の場合はそのフィールドを持たない。
 * 状況・自動思考のどちらも読み取れない場合は undefined（意味のある記録なし）。
 */
export function parseThoughtRecordSection(markdown: string): ParsedThoughtRecord | undefined {
  const body = meaningfulBody(sectionBody(markdown, "思考記録"));
  if (body === undefined) return undefined;

  const parsed: ParsedThoughtRecord = {};
  for (const line of body.split(/\r?\n/)) {
    // 例: 「- 状況（いつ・どこで・何が）: 16時ごろ、...」→ ラベル部と値部に分ける
    const m = line.match(/^\s*[-*]\s*(?:\*\*)?([^:：]+?)(?:\*\*)?\s*[:：]\s*(.*)$/);
    if (!m) continue;
    const label = (m[1] as string).replace(/（[^）]*）/g, "").trim();
    const value = meaningfulValue(m[2]);
    if (value === undefined) continue;

    if (/^そのときの気分/.test(label)) {
      // 「不安 70%」→ ラベルと強さに分解（%が無ければ全文をラベルとして保持）
      const intensity = parsePercent(value);
      if (intensity !== undefined) parsed.emotionIntensity = intensity;
      const labelText = value.replace(/(\d{1,3})\s*[%％]/, "").replace(/[・、\s]+$/, "").trim();
      if (labelText.length > 0) parsed.emotionLabel = labelText;
      else if (intensity === undefined) parsed.emotionLabel = value;
      continue;
    }
    if (/^再評価後の気分/.test(label)) {
      // 数値（%）だけを取り込む。散文のみの場合は数値を捏造しない
      const intensity = parsePercent(value);
      if (intensity !== undefined) parsed.reRatedEmotionIntensity = intensity;
      continue;
    }
    for (const [re, field] of TR_TEXT_LABELS) {
      if (!re.test(label)) continue;
      parsed[field] = value;
      break;
    }
  }

  if (parsed.situation === undefined && parsed.automaticThought === undefined) return undefined;
  return parsed;
}

// --- 行動活性化 -------------------------------------------------------------

export interface ParsedActivity {
  activity: string;
  predictedPleasure?: number;
  predictedMastery?: number;
  actualPleasure?: number;
  actualMastery?: number;
  status: "planned" | "completed";
}

function readScore(text: string, re: RegExp): number | undefined {
  const raw = text.match(re)?.[1];
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return n >= 0 && n <= 10 ? n : undefined;
}

const PLEASURE_RE = /楽しさ\s*:?\s*(\d{1,2})/;
const MASTERY_RE = /(?:やり遂げた感|達成感)\s*:?\s*(\d{1,2})/;

/**
 * 「## 行動活性化」セクションをパースする。トップレベルの箇条書き1行を1活動として扱い、
 * 「楽しさ N」「達成感（やり遂げた感） N」の数値と、実施済みの手がかり
 * （「実際」「実施」「完了」「できた」）があれば actual / completed として読む。
 */
export function parseActivationSection(markdown: string): ParsedActivity[] {
  const body = meaningfulBody(sectionBody(markdown, "行動活性化"));
  if (body === undefined) return [];

  const activities: ParsedActivity[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^[-*]\s+(.*)$/);
    if (!m) continue;
    const text = (m[1] as string).trim();
    if (text.length === 0) continue;

    const done = /実際|実施済|完了|できた|やった/.test(text);
    const pleasure = readScore(text, PLEASURE_RE);
    const mastery = readScore(text, MASTERY_RE);
    const activity: ParsedActivity = { activity: text, status: done ? "completed" : "planned" };
    if (done) {
      if (pleasure !== undefined) activity.actualPleasure = pleasure;
      if (mastery !== undefined) activity.actualMastery = mastery;
    } else {
      if (pleasure !== undefined) activity.predictedPleasure = pleasure;
      if (mastery !== undefined) activity.predictedMastery = mastery;
    }
    activities.push(activity);
  }
  return activities;
}

// --- 感謝日記 ---------------------------------------------------------------

/** 「## 感謝日記」セクションから箇条書き（最大3件）を取り出す。無ければ空配列 */
export function parseGratitudeSection(markdown: string): string[] {
  const body = meaningfulBody(sectionBody(markdown, "感謝日記"));
  if (body === undefined) return [];
  const items: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^[-*]\s+(.*)$/);
    if (!m) continue;
    const text = (m[1] as string).trim();
    if (text.length > 0) items.push(text);
    if (items.length === 3) break;
  }
  return items;
}

// --- 逆マージ本体 -----------------------------------------------------------

export interface CbtMergeResult {
  /** 思考記録を取り込んだ日数 */
  thoughtRecords: number;
  /** 行動活性化を取り込んだ日数 */
  activations: number;
  /** 感謝日記を取り込んだ日数 */
  gratitudes: number;
}

export interface CbtImportStores {
  thoughtRecordStore: ThoughtRecordStore;
  activationStore: BehavioralActivationStore;
  gratitudeStore: GratitudeStore;
}

/**
 * logs/ 配下の YYYY-MM-DD.md からCBT記録（思考記録・行動活性化・感謝日記）を読み取り、
 * **Bot側に同じ日の記録が無い日だけ**を各テーブルへ取り込む（非破壊・冪等）。
 * ownerUserId が空の場合は何もしない（logs/ はオーナーの個人記録であり、帰属先を特定できないため）。
 */
export function importCbtRecordsFromLogs(
  logsDir: string,
  stores: CbtImportStores,
  ownerUserId: string,
): CbtMergeResult {
  const result: CbtMergeResult = { thoughtRecords: 0, activations: 0, gratitudes: 0 };
  if (!ownerUserId || !existsSync(logsDir)) {
    return result;
  }

  for (const filename of readdirSync(logsDir).sort()) {
    const date = claudeLogDate(filename);
    if (!date) continue;
    const markdown = readFileSync(join(logsDir, filename), "utf8");
    const { fromIso, toIso } = jstDayRange(date);
    const noon = jstNoonOf(date);

    const tr = parseThoughtRecordSection(markdown);
    if (tr !== undefined && !stores.thoughtRecordStore.hasAnyBetween(ownerUserId, fromIso, toIso)) {
      stores.thoughtRecordStore.create({ userId: ownerUserId, ...tr }, noon);
      result.thoughtRecords += 1;
    }

    const activities = parseActivationSection(markdown);
    if (activities.length > 0 && !stores.activationStore.hasAnyBetween(ownerUserId, fromIso, toIso)) {
      for (const activity of activities) {
        stores.activationStore.create({ userId: ownerUserId, ...activity }, noon);
      }
      result.activations += 1;
    }

    const items = parseGratitudeSection(markdown);
    if (items.length > 0 && !stores.gratitudeStore.hasAnyOnDate(ownerUserId, date)) {
      stores.gratitudeStore.create(
        {
          userId: ownerUserId,
          date,
          item1: items[0] ?? "",
          item2: items[1] ?? "",
          item3: items[2] ?? "",
        },
        noon,
      );
      result.gratitudes += 1;
    }
  }
  return result;
}
