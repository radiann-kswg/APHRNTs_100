// logs/YYYY-MM-DD.md 群から「気分: N/10」の数値を機械的に抽出し、
// 気分推移Artifact（.cbt-datas/mood-artifact.md 参照）の描画用データをJSONで出力する小さなスクリプト。
//
// 使い方:
//   node scripts/extract-mood.mjs                 # 全ログを対象にJSONをstdoutへ出力
//   node scripts/extract-mood.mjs --days=7        # 直近7日（週次）に絞る
//   node scripts/extract-mood.mjs --days=30       # 直近30日（月次）に絞る
//   node scripts/extract-mood.mjs --out=logs/mood.json
//
// 出力形式: { generatedAt, days, entries: [{ date, mood, note }] }
//   - mood は 1〜10 の整数、数値記録が無い日は null（自由記述のみの日）
//   - note は「## 体調・気分」セクション先頭の箇条書き1行（あれば）
//
// 注意: このスクリプトは logs/ を読むだけで、内容の書き換えや外部送信は一切行わない。
//       気分の数値を推測・捏造しない（記録が無ければ null のまま）。

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
// 全角コロン「：」/半角コロン「:」の両方、前後の空白を許容して N を取る
const MOOD_RE = /気分\s*[:：]\s*(\d{1,2})\s*\/\s*10/;

/** 「## 体調・気分」セクションの最初の箇条書き行を取り出す（無ければ null） */
function firstMoodNote(markdown) {
  const lines = markdown.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      inSection = /体調・気分/.test(line);
      continue;
    }
    if (inSection) {
      const m = line.match(/^\s*[-*]\s+(.*\S)\s*$/);
      if (m) return m[1];
    }
  }
  return null;
}

const files = readdirSync(logsDir)
  .filter((name) => DATE_FILE.test(name))
  .sort();

let entries = files.map((name) => {
  const date = name.replace(/\.md$/, "");
  const md = readFileSync(join(logsDir, name), "utf8");
  const moodMatch = md.match(MOOD_RE);
  let mood = moodMatch ? Number.parseInt(moodMatch[1], 10) : null;
  if (mood !== null && (mood < 1 || mood > 10)) mood = null; // 範囲外は無効扱い
  return { date, mood, note: firstMoodNote(md) };
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
  const withMood = entries.filter((e) => e.mood !== null).length;
  console.error(`Wrote ${entries.length} entries (${withMood} with mood) to ${outPath}`);
} else {
  console.log(json);
}
