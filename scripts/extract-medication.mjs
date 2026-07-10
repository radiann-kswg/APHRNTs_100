// logs/YYYY-MM-DD.md 群から「## 服薬」セクションの服薬チェックボックス（朝🌄/日中☀️/食後🍽/夜🌙/発作時⚡）を
// 機械的に抽出し、気分×服薬の統合Artifact（.cbt-datas/mood-artifact.md 参照）の描画用データを
// JSONで出力する小さなスクリプト。extract-mood.mjs と同じ設計思想（読み取り専用・値を捏造しない）。
//
// 使い方:
//   node scripts/extract-medication.mjs                 # 全ログを対象にJSONをstdoutへ出力
//   node scripts/extract-medication.mjs --days=7        # 直近7日（週次）に絞る
//   node scripts/extract-medication.mjs --days=30       # 直近30日（月次）に絞る
//   node scripts/extract-medication.mjs --out=logs/medication.json
//
// 出力形式: { generatedAt, days, entries: [{ date, morningTaken, middayTaken, afterMealTaken, nightTaken, prn }] }
//   - 各 xxxTaken は true（済）/ false（未）/ null（その日の記録に当該スロットの記載が無い）
//   - prn は「発作時⚡」に続く自由記述の文字列、記載が無ければ null
//
// 注意: このスクリプトは logs/ を読むだけで、内容の書き換えや外部送信は一切行わない。
//       服薬の有無を推測・捏造しない（記録が無ければ null のまま）。

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const logsDir = join(rootDir, "logs");

const args = process.argv.slice(2);
const daysArg = args.find((a) => a.startsWith("--days="));
const outArg = args.find((a) => a.startsWith("--out="));
const days = daysArg ? Number.parseInt(daysArg.split("=")[1], 10) : null;
const outPath = outArg ? outArg.split("=")[1] : null;

const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const MEDICATION_SECTION_RE = /##\s*服薬\s*\n([\s\S]*?)(?=\n##\s|$)/;

const SLOT_LABELS = {
  morningTaken: "朝🌄",
  middayTaken: "日中☀️",
  afterMealTaken: "食後🍽",
  nightTaken: "夜🌙",
};

/** セクション本文の中から、指定ラベルのチェックボックス状態を読み取る（無ければ null） */
function slotState(sectionText, label) {
  const re = new RegExp(`${label}\\s*[:：]?\\s*\\[([ xX])\\]`);
  const m = sectionText.match(re);
  if (!m) return null;
  return m[1].trim().length > 0;
}

/** 「発作時⚡」に続く自由記述を取り出す（無ければ null） */
function prnNote(sectionText) {
  const m = sectionText.match(/発作時⚡\s*[:：]?\s*(.*)/);
  if (!m) return null;
  const text = m[1].replace(/^→\s*/, "").trim();
  return text.length > 0 ? text : null;
}

/** 「## 服薬」セクションを抽出し、各スロットの状態とPRN記述をまとめる（セクション自体が無ければ全項目 null） */
function extractMedication(markdown) {
  const sectionMatch = markdown.match(MEDICATION_SECTION_RE);
  if (!sectionMatch) {
    return { morningTaken: null, middayTaken: null, afterMealTaken: null, nightTaken: null, prn: null };
  }
  const section = sectionMatch[1];
  return {
    morningTaken: slotState(section, SLOT_LABELS.morningTaken),
    middayTaken: slotState(section, SLOT_LABELS.middayTaken),
    afterMealTaken: slotState(section, SLOT_LABELS.afterMealTaken),
    nightTaken: slotState(section, SLOT_LABELS.nightTaken),
    prn: prnNote(section),
  };
}

const files = readdirSync(logsDir)
  .filter((name) => DATE_FILE.test(name))
  .sort();

let entries = files.map((name) => {
  const date = name.replace(/\.md$/, "");
  const md = readFileSync(join(logsDir, name), "utf8");
  return { date, ...extractMedication(md) };
});

if (days && Number.isFinite(days)) {
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  entries = entries.filter((e) => e.date >= cutoffStr);
}

const result = {
  generatedAt: new Date().toISOString(),
  days: days ?? null,
  entries,
};

const json = JSON.stringify(result, null, 2);
if (outPath) {
  writeFileSync(join(rootDir, outPath), json + "\n");
  const withAny = entries.filter(
    (e) => e.morningTaken !== null || e.middayTaken !== null || e.afterMealTaken !== null || e.nightTaken !== null,
  ).length;
  console.error(`Wrote ${entries.length} entries (${withAny} with medication data) to ${outPath}`);
} else {
  console.log(json);
}
