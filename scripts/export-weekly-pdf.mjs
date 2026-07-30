#!/usr/bin/env node
// ---------------------------------------------------------------------------
// export-weekly-pdf.mjs — 日曜〜土曜の1週間の記録から週間レポートPDFを出力する
//
// 使い方（リポジトリルートで実行）:
//   npm run export:weekly-pdf                                  # 今日を含む週（日〜土）
//   npm run export:weekly-pdf -- --week 2026-07-15             # その日を含む週
//   npm run export:weekly-pdf -- --week 2026-07-15 --summary-file .cache/momo-shoken.md
//
// 主なオプション:
//   --week YYYY-MM-DD     この日を**含む**週（日曜はじまり）を対象にする（省略時: 今日）
//   --summary-file <path> 100(モモ)が書いた週間所見（Markdown）を「100(モモ)の所見」
//                         セクションとして差し込む
//   --no-daily            各日の記録本文を載せず、集計サマリー（＋所見）だけにする
//   --output <path>       出力PDFパス（省略時: .cache/exports/momo-weekly_<日曜>_<土曜>.pdf）
//   --keep-html           中間生成物のHTMLを削除せず残す（デバッグ用）
//   --browser <path>      PDF化に使うブラウザ実行ファイルを明示指定
//
// 集計内容（scripts/lib/weekly-aggregate.mjs）:
//   気分・エネルギー・眠りの質の平均/最低/最高、服薬スロット別の達成率（分母は
//   報告があった日のみ）、頓服回数、思考記録・行動活性化・感謝日記・創作進捗の日数、
//   日ごとの一覧表。
//
// ⚠ 出力PDFには機微な健康情報が含まれる。既定の出力先 .cache/ は
//    .gitignore 済みだが、生成物の共有・移動は必ずセンパイ本人の判断で行うこと。
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WEEKDAYS_JA,
  escapeHtml,
  findBrowser,
  markdownToHtml,
  printToPdf,
  wrapReportHtml,
} from './lib/pdf-common.mjs';
import {
  aggregateWeek,
  buildWeeklySummaryMarkdown,
  parseDailyLogForWeekly,
  weekRangeFor,
} from './lib/weekly-aggregate.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logsDir = path.join(repoRoot, 'logs');

function parseArgs(argv) {
  const opts = {
    week: null,
    summaryFile: null,
    includeDaily: true,
    output: null,
    keepHtml: false,
    browser: process.env.EXPORT_PDF_BROWSER || null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--week': opts.week = argv[++i]; break;
      case '--summary-file': opts.summaryFile = argv[++i]; break;
      case '--no-daily': opts.includeDaily = false; break;
      case '--output': opts.output = argv[++i]; break;
      case '--keep-html': opts.keepHtml = true; break;
      case '--browser': opts.browser = argv[++i]; break;
      case '--help':
      case '-h':
        console.log('使い方: node scripts/export-weekly-pdf.mjs [--week YYYY-MM-DD] [--summary-file <path>] [--no-daily] [--output <path>] [--keep-html] [--browser <path>]');
        process.exit(0);
        break;
      default:
        console.error(`不明なオプションです: ${a}（--help で使い方を表示）`);
        process.exit(1);
    }
  }
  if (opts.week != null && !/^\d{4}-\d{2}-\d{2}$/.test(opts.week)) {
    console.error(`--week は YYYY-MM-DD 形式で指定してください: ${opts.week}`);
    process.exit(1);
  }
  return opts;
}

/** ホストのタイムゾーンに関わらずJST(UTC+9)の今日(YYYY-MM-DD)を返す（src/utils/date.ts と同じ考え方） */
function todayJst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function weekdayOf(dateStr) {
  return WEEKDAYS_JA[new Date(`${dateStr}T00:00:00Z`).getUTCDay()] ?? '?';
}

const opts = parseArgs(process.argv.slice(2));

if (!fs.existsSync(logsDir)) {
  console.error(`logs/ ディレクトリが見つかりません: ${logsDir}`);
  process.exit(1);
}

const range = weekRangeFor(opts.week ?? todayJst());
const days = range.dates.map((date) => {
  const filePath = path.join(logsDir, `${date}.md`);
  if (!fs.existsSync(filePath)) return { date, parsed: null, markdown: null };
  const markdown = fs.readFileSync(filePath, 'utf8');
  if (markdown.trim().length === 0) return { date, parsed: null, markdown: null };
  return { date, parsed: parseDailyLogForWeekly(markdown), markdown };
});

const agg = aggregateWeek(days);
if (agg.recordedDays === 0) {
  console.error(`対象週（${range.start} 〜 ${range.end}）に記録が見つかりませんでした。`);
  process.exit(1);
}

// --- 本文HTMLの組み立て -----------------------------------------------------

const sections = [];

// 1. 週間の傾向（機械集計）
sections.push(`
  <section class="day">
    ${markdownToHtml(buildWeeklySummaryMarkdown(range, days, agg))}
  </section>`);

// 2. 100(モモ)の所見（--summary-file 指定時のみ）
if (opts.summaryFile) {
  const summaryPath = path.resolve(repoRoot, opts.summaryFile);
  if (!fs.existsSync(summaryPath)) {
    console.error(`--summary-file が見つかりません: ${summaryPath}`);
    process.exit(1);
  }
  const summaryMd = fs.readFileSync(summaryPath, 'utf8').trim();
  if (summaryMd.length > 0) {
    sections.push(`
  <section class="day">
    <h2 class="day-title">100(モモ)の所見</h2>
    ${markdownToHtml(summaryMd)}
  </section>`);
  }
}

// 3. 各日の記録本文（--no-daily で省略可）
if (opts.includeDaily) {
  for (const day of days) {
    if (day.markdown === null) continue;
    const body = markdownToHtml(day.markdown.replace(/^#\s+\S.*\r?\n/, ''));
    sections.push(`
  <section class="day">
    <h2 class="day-title">${escapeHtml(`${day.date}（${weekdayOf(day.date)}）`)}</h2>
    ${body}
  </section>`);
  }
}

const generatedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
const html = wrapReportHtml({
  title: '100(モモ) 週間レポート',
  metaLine: `対象週: ${range.start}（日） 〜 ${range.end}（土） ｜ 記録 ${agg.recordedDays}/7日 ｜ 生成日時: ${generatedAt}`,
  bodyHtml: sections.join('\n'),
});

// --- PDF化 ------------------------------------------------------------------

const browser = findBrowser(opts.browser);
const outPath = path.resolve(
  repoRoot,
  opts.output ?? path.join('.cache', 'exports', `momo-weekly_${range.start}_${range.end}.pdf`),
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const tmpDir = opts.keepHtml ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'momo-weekly-'));
const htmlPath = opts.keepHtml
  ? outPath.replace(/\.pdf$/i, '.html')
  : path.join(tmpDir, `${path.basename(outPath, '.pdf')}.html`);
fs.writeFileSync(htmlPath, html, 'utf8');
try {
  printToPdf(browser, htmlPath, outPath);
} catch (err) {
  console.error('PDF化に失敗しました。--keep-html でHTMLを確認するか、別のブラウザを--browserで指定してください。');
  console.error(String(err?.stderr ?? err));
  process.exit(1);
}
const size = fs.statSync(outPath).size;
console.log(`✅ ${path.relative(repoRoot, outPath)}（${(size / 1024).toFixed(1)} KB）`);
if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
