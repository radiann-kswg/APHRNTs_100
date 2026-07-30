// ---------------------------------------------------------------------------
// pdf-common.mjs — logs/ のPDF出力スクリプト共通部品
//
// export-logs-pdf.mjs（期間指定の全文出力）と export-weekly-pdf.mjs（週間レポート）で
// 共有する Markdown→HTML 簡易レンダラ・レポートHTML外枠・ブラウザ検出・PDF印刷。
// レンダラはこのリポジトリのログで使う範囲だけに対応する（見出し・箇条書き・
// 番号付きリスト・表・引用・水平線・チェックボックス・**強調**・*斜体*・
// `コード`・リンク）。HTMLコメント（マーカー行）は除去する。
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

export function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderInline(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\[x\]/gi, '<span class="cb cb-on">☑</span>');
  out = out.replace(/\[ \]/g, '<span class="cb cb-off">☐</span>');
  return out;
}

export function markdownToHtml(md) {
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

/**
 * レポートHTMLの外枠（スタイル・表紙ヘッダー込み）を組み立てる。
 * @param {{ title: string, metaLine: string, bodyHtml: string }} params
 */
export function wrapReportHtml({ title, metaLine, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
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
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">${escapeHtml(metaLine)}</div>
    <div class="caution">⚠ このPDFには体調・服薬など機微な個人情報が含まれます。取り扱い・共有はセンパイ本人の判断で慎重に。</div>
  </header>
${bodyHtml}
</body>
</html>`;
}

export function findBrowser(explicit) {
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

export function printToPdf(browser, htmlPath, pdfPath) {
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
