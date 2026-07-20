#!/usr/bin/env node
// ---------------------------------------------------------------------------
// export-logs-pdf.mjs — logs/ の生活管理ログを1つのPDFにまとめて出力する
//
// 使い方（リポジトリルートで実行）:
//   npm run export:pdf                             # 全期間をPDF化
//   npm run export:pdf -- --from 2026-07-09 --to 2026-07-17
//   npm run export:pdf -- --to 2026-07-17 --output .cache/exports/mylogs.pdf
//
// 主なオプション:
//   --from YYYY-MM-DD   この日以降の記録を含める（省略時: 最古の記録から）
//   --to YYYY-MM-DD     この日以前の記録を含める（省略時: 今日まで）
//   --output <path>     出力PDFパス（省略時: .cache/exports/momo-logs_<from>_<to>.pdf）
//                       --split 時は出力ディレクトリとして扱う
//   --split             1つにまとめず、日付ごとに1PDFずつ出力する
//   --include-weekly    週間シート logs/weekly-YYYY-MM-DD.md も含める
//   --include-digest    logs/bot-digest.md（Misskey Bot記録ダイジェスト）も巻末に含める
//   --keep-html         中間生成物のHTMLを削除せず残す（デバッグ用）
//   --browser <path>    PDF化に使うブラウザ実行ファイルを明示指定
//
// 週間（日〜土）の傾向集計つきレポートは scripts/export-weekly-pdf.mjs
// （`npm run export:weekly-pdf`）を使うこと。
//
// PDF化には Chromium 系ブラウザのヘッドレス印刷機能を使う（追加のnpm依存なし）。
// Windows では Microsoft Edge（標準搭載）/ Google Chrome を自動検出する。
// 環境変数 EXPORT_PDF_BROWSER でも指定可能（--browser が優先）。
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logsDir = path.join(repoRoot, 'logs');

// ---------------------------------------------------------------------------
// CLI引数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    from: null,
    to: null,
    output: null,
    split: false,
    includeWeekly: false,
    includeDigest: false,
    keepHtml: false,
    browser: process.env.EXPORT_PDF_BROWSER || null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--from': opts.from = argv[++i]; break;
      case '--to': opts.to = argv[++i]; break;
      case '--output': opts.output = argv[++i]; break;
      case '--split': opts.split = true; break;
      case '--include-weekly': opts.includeWeekly = true; break;
      case '--include-digest': opts.includeDigest = true; break;
      case '--keep-html': opts.keepHtml = true; break;
      case '--browser': opts.browser = argv[++i]; break;
      case '--help':
      case '-h':
        console.log('使い方: node scripts/export-logs-pdf.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--output <path>] [--split] [--include-weekly] [--include-digest] [--keep-html] [--browser <path>]');
        process.exit(0);
        break;
      default:
        console.error(`不明なオプションです: ${a}（--help で使い方を表示）`);
        process.exit(1);
    }
  }
  for (const key of ['from', 'to']) {
    if (opts[key] != null && !/^\d{4}-\d{2}-\d{2}$/.test(opts[key])) {
      console.error(`--${key} は YYYY-MM-DD 形式で指定してください: ${opts[key]}`);
      process.exit(1);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// 対象ファイルの収集
// ---------------------------------------------------------------------------

function collectLogFiles(opts) {
  if (!fs.existsSync(logsDir)) {
    console.error(`logs/ ディレクトリが見つかりません: ${logsDir}`);
    process.exit(1);
  }
  const entries = fs.readdirSync(logsDir);
  const daily = [];
  const weekly = [];
  for (const name of entries) {
    const dailyMatch = name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    const weeklyMatch = name.match(/^weekly-(\d{4}-\d{2}-\d{2})\.md$/);
    const m = dailyMatch ?? weeklyMatch;
    if (!m) continue;
    const date = m[1];
    if (opts.from && date < opts.from) continue;
    if (opts.to && date > opts.to) continue;
    (dailyMatch ? daily : weekly).push({ name, date, kind: dailyMatch ? 'daily' : 'weekly' });
  }
  daily.sort((a, b) => a.date.localeCompare(b.date));
  weekly.sort((a, b) => a.date.localeCompare(b.date));
  const files = opts.includeWeekly ? [...daily, ...weekly] : daily;
  if (opts.includeDigest) {
    const digestPath = path.join(logsDir, 'bot-digest.md');
    if (fs.existsSync(digestPath)) {
      files.push({ name: 'bot-digest.md', date: null, kind: 'digest' });
    } else {
      console.warn('（logs/bot-digest.md が無いためダイジェストはスキップします）');
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// レポートHTMLの組み立て
// ---------------------------------------------------------------------------

function sectionTitle(file) {
  if (file.kind === 'digest') return 'Misskey Bot記録ダイジェスト（bot-digest.md）';
  const [y, m, d] = file.date.split('-').map(Number);
  const wd = WEEKDAYS_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
  const base = `${file.date}（${wd}）`;
  return file.kind === 'weekly' ? `週間シート ${base}〜` : base;
}

function buildReportHtml(files, opts, generatedAt, periodOverride = null) {
  const first = files.find((f) => f.date)?.date ?? '—';
  const last = [...files].reverse().find((f) => f.date)?.date ?? '—';
  const period = periodOverride ?? `${opts.from ?? first} 〜 ${opts.to ?? last}`;
  const metaLine = periodOverride
    ? `${period} ｜ 生成日時: ${generatedAt}`
    : `期間: ${period} ｜ 記録ファイル: ${files.length}件 ｜ 生成日時: ${generatedAt}`;

  const sections = files.map((file) => {
    const md = fs.readFileSync(path.join(logsDir, file.name), 'utf8');
    // 各ファイル冒頭の「# YYYY-MM-DD」見出しはセクション見出しと重複するため除去
    const body = markdownToHtml(md.replace(/^#\s+\S.*\r?\n/, ''));
    return `
      <section class="day">
        <h2 class="day-title">${escapeHtml(sectionTitle(file))}</h2>
        ${body}
      </section>`;
  }).join('\n');

  return wrapReportHtml({ title: '100(モモ) 生活管理ログ', metaLine, bodyHtml: sections });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
const files = collectLogFiles(opts);

if (files.length === 0) {
  console.error('指定期間に該当する記録が logs/ に見つかりませんでした。');
  process.exit(1);
}

const first = files.find((f) => f.date)?.date ?? 'all';
const last = [...files].reverse().find((f) => f.date)?.date ?? 'all';
const rangeLabel = `${opts.from ?? first}_${opts.to ?? last}`;

const now = new Date();
const generatedAt = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
const browser = findBrowser(opts.browser);
console.log(`対象: ${files.length}件（${first} 〜 ${last}） / ブラウザ: ${browser}`);

const tmpDir = opts.keepHtml ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'momo-logs-'));

function exportOne(htmlContent, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const htmlPath = opts.keepHtml
    ? outPath.replace(/\.pdf$/i, '.html')
    : path.join(tmpDir, `${path.basename(outPath, '.pdf')}.html`);
  fs.writeFileSync(htmlPath, htmlContent, 'utf8');
  try {
    printToPdf(browser, htmlPath, outPath);
  } catch (err) {
    console.error('PDF化に失敗しました。--keep-html でHTMLを確認するか、別のブラウザを--browserで指定してください。');
    console.error(String(err?.stderr ?? err));
    process.exit(1);
  }
  const size = fs.statSync(outPath).size;
  console.log(`✅ ${path.relative(repoRoot, outPath)}（${(size / 1024).toFixed(1)} KB）`);
}

if (opts.split) {
  // 日付ごとに1PDFずつ出力（--output は出力ディレクトリ扱い）
  const outDir = path.resolve(repoRoot, opts.output ?? path.join('.cache', 'exports', `momo-logs_${rangeLabel}`));
  for (const file of files) {
    const stem = file.kind === 'digest' ? 'bot-digest'
      : file.kind === 'weekly' ? `weekly-${file.date}`
      : file.date;
    const html = buildReportHtml([file], opts, generatedAt, sectionTitle(file));
    exportOne(html, path.join(outDir, `momo-log_${stem}.pdf`));
  }
  console.log(`出力先ディレクトリ: ${path.relative(repoRoot, outDir)}`);
} else {
  const outPath = path.resolve(repoRoot, opts.output ?? path.join('.cache', 'exports', `momo-logs_${rangeLabel}.pdf`));
  exportOne(buildReportHtml(files, opts, generatedAt), outPath);
}

if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
