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
//   --include-weekly    週間シート logs/weekly-YYYY-MM-DD.md も含める
//   --include-digest    logs/bot-digest.md（Misskey Bot記録ダイジェスト）も巻末に含める
//   --keep-html         中間生成物のHTMLを削除せず残す（デバッグ用）
//   --browser <path>    PDF化に使うブラウザ実行ファイルを明示指定
//
// PDF化には Chromium 系ブラウザのヘッドレス印刷機能を使う（追加のnpm依存なし）。
// Windows では Microsoft Edge（標準搭載）/ Google Chrome を自動検出する。
// 環境変数 EXPORT_PDF_BROWSER でも指定可能（--browser が優先）。
//
// ⚠ 出力PDFには機微な健康情報が含まれる。既定の出力先 .cache/ は
//    .gitignore 済みだが、生成物の共有・移動は必ずセンパイ本人の判断で行うこと。
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
      case '--include-weekly': opts.includeWeekly = true; break;
      case '--include-digest': opts.includeDigest = true; break;
      case '--keep-html': opts.keepHtml = true; break;
      case '--browser': opts.browser = argv[++i]; break;
      case '--help':
      case '-h':
        console.log('使い方: node scripts/export-logs-pdf.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--output <path>] [--include-weekly] [--include-digest] [--keep-html] [--browser <path>]');
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
// Markdown → HTML（このリポジトリのログで使う範囲だけの簡易レンダラ）
// 見出し・箇条書き・番号付きリスト・表・引用・水平線・チェックボックス・
// **強調**・*斜体*・`コード`・リンクに対応。HTMLコメント（マーカー行）は除去。
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderInline(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\[x\]/gi, '<span class="cb cb-on">☑</span>');
  out = out.replace(/\[ \]/g, '<span class="cb cb-off">☐</span>');
  return out;
}

function markdownToHtml(md) {
  // マーカー等のHTMLコメントを除去（複数行コメントにも対応）
  const src = md.replace(/<!--[\s\S]*?-->/g, '');
  const lines = src.split(/\r?\n/);
  const html = [];
  let listStack = []; // 'ul' | 'ol'
  let inTable = false;

  const closeLists = () => {
    while (listStack.length) html.push(`</${listStack.pop()}>`);
  };
  const closeTable = () => {
    if (inTable) { html.push('</tbody></table>'); inTable = false; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') { closeLists(); closeTable(); continue; }

    // 表
    if (/^\|.*\|$/.test(trimmed)) {
      const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // 区切り行
      closeLists();
      if (!inTable) {
        const next = (lines[i + 1] ?? '').trim();
        const isHeader = /^\|(\s*:?-{2,}:?\s*\|)+$/.test(next);
        html.push('<table>');
        if (isHeader) {
          html.push('<thead><tr>' + cells.map((c) => `<th>${renderInline(c)}</th>`).join('') + '</tr></thead><tbody>');
          inTable = true;
          continue;
        }
        html.push('<tbody>');
        inTable = true;
      }
      html.push('<tr>' + cells.map((c) => `<td>${renderInline(c)}</td>`).join('') + '</tr>');
      continue;
    }
    closeTable();

    // 見出し
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      const level = h[1].length;
      html.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      continue;
    }

    // 水平線
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { closeLists(); html.push('<hr>'); continue; }

    // 引用
    if (trimmed.startsWith('&gt;') || trimmed.startsWith('>')) {
      closeLists();
      html.push(`<blockquote>${renderInline(trimmed.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    // リスト（ネストはインデント2スペース単位）
    const li = line.match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
    if (li) {
      const depth = Math.floor(li[1].replace(/\t/g, '  ').length / 2) + 1;
      const type = /[-*]/.test(li[2]) ? 'ul' : 'ol';
      while (listStack.length > depth) html.push(`</${listStack.pop()}>`);
      while (listStack.length < depth) { html.push(`<${type}>`); listStack.push(type); }
      html.push(`<li>${renderInline(li[3])}</li>`);
      continue;
    }

    // 通常段落
    closeLists();
    html.push(`<p>${renderInline(trimmed)}</p>`);
  }
  closeLists();
  closeTable();
  return html.join('\n');
}

// ---------------------------------------------------------------------------
// レポートHTMLの組み立て
// ---------------------------------------------------------------------------

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

function sectionTitle(file) {
  if (file.kind === 'digest') return 'Misskey Bot記録ダイジェスト（bot-digest.md）';
  const [y, m, d] = file.date.split('-').map(Number);
  const wd = WEEKDAYS_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
  const base = `${file.date}（${wd}）`;
  return file.kind === 'weekly' ? `週間シート ${base}〜` : base;
}

function buildReportHtml(files, opts, generatedAt) {
  const first = files.find((f) => f.date)?.date ?? '—';
  const last = [...files].reverse().find((f) => f.date)?.date ?? '—';
  const period = `${opts.from ?? first} 〜 ${opts.to ?? last}`;

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

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>100(モモ) 生活管理ログ</title>
<style>
  :root {
    --momo: #d4547a;
    --momo-soft: #fbe9ef;
    --ink: #2b2b33;
    --sub: #6b6b76;
    --line: #e4e4ea;
  }
  @page { size: A4; margin: 16mm 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Yu Gothic UI", "Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Noto Sans JP", sans-serif, "Segoe UI Emoji", "Noto Color Emoji";
    color: var(--ink);
    font-size: 10.5pt;
    line-height: 1.65;
    margin: 0;
  }
  .cover { border-bottom: 3px solid var(--momo); padding-bottom: 12px; margin-bottom: 18px; }
  .cover h1 { font-size: 19pt; margin: 0 0 4px; color: var(--momo); }
  .cover .meta { color: var(--sub); font-size: 9.5pt; }
  .cover .caution {
    margin-top: 8px; padding: 6px 10px; background: var(--momo-soft);
    border-radius: 6px; font-size: 8.5pt; color: #8a3a55;
  }
  .day { margin-bottom: 16px; }
  .day-title {
    font-size: 13pt; color: #fff; background: var(--momo);
    padding: 3px 12px; border-radius: 6px; margin: 0 0 8px;
    break-after: avoid;
  }
  h2:not(.day-title), h3 {
    font-size: 11pt; margin: 10px 0 4px; padding-left: 8px;
    border-left: 4px solid var(--momo); break-after: avoid;
  }
  h4, h5, h6 { font-size: 10.5pt; margin: 8px 0 3px; break-after: avoid; }
  p { margin: 3px 0; }
  ul, ol { margin: 3px 0 6px; padding-left: 22px; }
  li { margin: 1px 0; }
  table { border-collapse: collapse; margin: 6px 0; font-size: 9.5pt; }
  th, td { border: 1px solid var(--line); padding: 3px 8px; text-align: left; }
  th { background: var(--momo-soft); }
  code {
    font-family: Consolas, "Courier New", monospace; font-size: 9pt;
    background: #f4f4f7; padding: 1px 4px; border-radius: 4px;
  }
  blockquote {
    margin: 4px 0; padding: 2px 10px; color: var(--sub);
    border-left: 3px solid var(--line);
  }
  a { color: var(--momo); text-decoration: none; }
  hr { border: none; border-top: 1px solid var(--line); margin: 10px 0; }
  .cb { font-size: 11pt; }
  .cb-on { color: var(--momo); }
  .cb-off { color: var(--sub); }
</style>
</head>
<body>
  <header class="cover">
    <h1>100(モモ) 生活管理ログ</h1>
    <div class="meta">期間: ${escapeHtml(period)} ｜ 記録ファイル: ${files.length}件 ｜ 生成日時: ${escapeHtml(generatedAt)}</div>
    <div class="caution">⚠ このPDFには体調・服薬など機微な個人情報が含まれます。取り扱い・共有はセンパイ本人の判断で慎重に。</div>
  </header>
${sections}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// ブラウザ検出とPDF化
// ---------------------------------------------------------------------------

function findBrowser(explicit) {
  if (explicit) {
    if (fs.existsSync(explicit)) return explicit;
    console.error(`指定されたブラウザが見つかりません: ${explicit}`);
    process.exit(1);
  }
  const candidates = [];
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] ?? '';
    candidates.push(
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium', '/usr/bin/chromium-browser',
      '/opt/pw-browsers/chromium',
    );
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  console.error(
    'PDF化に使えるブラウザ（Edge / Chrome / Chromium）が見つかりませんでした。\n' +
    '--browser <実行ファイルパス> か環境変数 EXPORT_PDF_BROWSER で指定してください。'
  );
  process.exit(1);
}

function printToPdf(browser, htmlPath, pdfPath) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--print-to-pdf=${pdfPath}`,
    '--no-pdf-header-footer',
    '--virtual-time-budget=10000',
  ];
  // Linuxのroot実行（コンテナ等）ではサンドボックスを無効化しないと起動できない
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
    args.push('--no-sandbox');
  }
  args.push(`file://${htmlPath.replaceAll('\\', '/')}`);
  execFileSync(browser, args, { stdio: ['ignore', 'ignore', 'pipe'] });
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
const outPath = path.resolve(
  repoRoot,
  opts.output ?? path.join('.cache', 'exports', `momo-logs_${opts.from ?? first}_${opts.to ?? last}.pdf`),
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const now = new Date();
const generatedAt = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
const htmlContent = buildReportHtml(files, opts, generatedAt);

const htmlPath = opts.keepHtml
  ? outPath.replace(/\.pdf$/i, '.html')
  : path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'momo-logs-')), 'report.html');
fs.writeFileSync(htmlPath, htmlContent, 'utf8');

const browser = findBrowser(opts.browser);
console.log(`対象: ${files.length}件（${first} 〜 ${last}） / ブラウザ: ${browser}`);

try {
  printToPdf(browser, htmlPath, outPath);
} catch (err) {
  console.error('PDF化に失敗しました。--keep-html でHTMLを確認するか、別のブラウザを--browserで指定してください。');
  console.error(String(err?.stderr ?? err));
  process.exit(1);
} finally {
  if (!opts.keepHtml) fs.rmSync(path.dirname(htmlPath), { recursive: true, force: true });
}

const size = fs.statSync(outPath).size;
console.log(`✅ PDFを出力しました: ${path.relative(repoRoot, outPath)}（${(size / 1024).toFixed(1)} KB）`);
if (opts.keepHtml) console.log(`（中間HTML: ${path.relative(repoRoot, htmlPath)}）`);
