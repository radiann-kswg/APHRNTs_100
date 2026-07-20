// ---------------------------------------------------------------------------
// weekly-aggregate.mjs — 週間レポートのための logs/ 集計（純関数のみ）
//
// 日曜〜土曜の1週間ぶんの logs/YYYY-MM-DD.md から、気分・エネルギー・睡眠・
// 服薬・CBT記録の傾向を機械集計する。export-weekly-pdf.mjs から使う。
//
// ⚠ パーサーの正典書式は logs/README.md。気分・エネルギー・眠りの質は
//    src/bridge/checkin-importer.ts、服薬は src/bridge/medication-importer.ts と
//    同じ読み方に揃えてある（書式を変えるときは両方を揃えること）。
// ---------------------------------------------------------------------------

/** 全角数字・全角スラッシュ/コロンを半角へ正規化する（ログの表記ゆれ対策） */
function normalize(text) {
  return text
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/／/g, '/')
    .replace(/：/g, ':');
}

function readScore(text, re, min, max) {
  const raw = normalize(text).match(re)?.[1];
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return n >= min && n <= max ? n : undefined;
}

// src/bridge/checkin-importer.ts と同じ正規表現
const MOOD_RE = /気分\s*:\s*(\d{1,2})\s*\/\s*10/;
const ENERGY_RE = /(?:エネルギー|活力)\s*:?\s*(\d{1,2})\s*\/\s*10/;
// 実ログには「眠りの質 4（5段階）」と「眠りの質: 2/5」の両表記があるため、コロンも許容する
const SLEEP_QUALITY_RE = /眠りの質\s*:?\s*(\d)/;
// 起床時刻: 6:00 / 起床時刻: 06:30（正規化後なので半角コロン）
const WAKE_TIME_RE = /起床時刻\s*:?\s*(\d{1,2}:\d{2})/;

// src/bridge/medication-importer.ts と同じセクション・ラベル定義
const MEDICATION_SECTION_RE = /##\s*服薬\s*\n([\s\S]*?)(?=\n##\s|$)/;
const MED_SLOTS = [
  ['morning', '朝🌄'],
  ['midday', '日中☀️'],
  ['afterMeal', '食後🍽'],
  ['night', '夜🌙'],
];

/** 見出し（`## 思考記録` 等・接尾辞つき見出しも許容）のセクション本文を取り出す */
function sectionBody(markdown, headingRe) {
  const re = new RegExp(`##\\s*${headingRe.source}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  return markdown.match(re)?.[1];
}

/** マーカーコメントを除いた本文に意味のある行（箇条書き・文章）があるか */
function hasContent(sectionText) {
  if (sectionText === undefined) return false;
  const stripped = sectionText.replace(/<!--[\s\S]*?-->/g, '').trim();
  return stripped.length > 0;
}

/**
 * 1日ぶんのログ（YYYY-MM-DD.md の中身）から週間集計に使う項目を読み取る。
 * 見つからない項目は undefined（値を捏造しない）。
 */
export function parseDailyLogForWeekly(markdown) {
  const parsed = {
    mood: readScore(markdown, MOOD_RE, 1, 10),
    energy: readScore(markdown, ENERGY_RE, 1, 10),
    sleepQuality: readScore(markdown, SLEEP_QUALITY_RE, 1, 5),
    wakeTime: normalize(markdown).match(WAKE_TIME_RE)?.[1],
    meds: {},
    prnCount: undefined,
    hasThoughtRecord: hasContent(sectionBody(markdown, /思考記録/)),
    hasGratitude: hasContent(sectionBody(markdown, /感謝日記/)),
    hasActivation: hasContent(sectionBody(markdown, /行動活性化/)),
    hasCreative: hasContent(sectionBody(markdown, /創作活動の進捗/)),
  };

  const medSection = markdown.match(MEDICATION_SECTION_RE)?.[1];
  if (medSection !== undefined) {
    for (const [key, label] of MED_SLOTS) {
      // [x]=服用済み・[ ]=未服用・記載なし=未報告（undefined）
      if (new RegExp(`${label}\\s*[:：]?\\s*\\[[xX]\\]`).test(medSection)) parsed.meds[key] = true;
      else if (new RegExp(`${label}\\s*[:：]?\\s*\\[ \\]`).test(medSection)) parsed.meds[key] = false;
    }
    const prn = medSection.match(/発作時⚡\s*[:：]?\s*(?:→\s*)?.*?(\d+)\s*回/);
    if (prn) parsed.prnCount = Number.parseInt(prn[1], 10);
  }
  return parsed;
}

/** "YYYY-MM-DD" を deltaDays 日シフトする（UTC演算なのでDSTの影響を受けない） */
export function shiftDateString(dateStr, deltaDays) {
  const base = new Date(`${dateStr}T00:00:00Z`);
  const shifted = new Date(base.getTime() + deltaDays * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * 指定日（YYYY-MM-DD）を含む「日曜はじまり」の週の範囲を返す。
 * @returns {{ start: string, end: string, dates: string[] }} start=日曜, end=土曜, dates=7日ぶん
 */
export function weekRangeFor(dateStr) {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=日〜6=土
  const start = shiftDateString(dateStr, -day);
  const dates = Array.from({ length: 7 }, (_, i) => shiftDateString(start, i));
  return { start, end: dates[6], dates };
}

function stats(values) {
  if (values.length === 0) return undefined;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    avg: Math.round((sum / values.length) * 10) / 10,
    min: Math.min(...values),
    max: Math.max(...values),
    count: values.length,
  };
}

/**
 * 週間（日〜土）の集計。
 * @param {Array<{ date: string, parsed: ReturnType<typeof parseDailyLogForWeekly> | null }>} days
 *   dates順の7要素。ログファイルが無い日は parsed: null。
 */
export function aggregateWeek(days) {
  const present = days.filter((d) => d.parsed !== null);
  const moods = present.map((d) => d.parsed.mood).filter((v) => v !== undefined);
  const energies = present.map((d) => d.parsed.energy).filter((v) => v !== undefined);
  const sleeps = present.map((d) => d.parsed.sleepQuality).filter((v) => v !== undefined);

  const meds = {};
  for (const [key] of MED_SLOTS) {
    // 分母は「そのスロットの報告があった日」（[x] または [ ]）。未報告日は含めない
    const reported = present.filter((d) => d.parsed.meds[key] !== undefined);
    const taken = reported.filter((d) => d.parsed.meds[key] === true);
    meds[key] = { taken: taken.length, reported: reported.length };
  }
  const prnTotal = present.reduce((sum, d) => sum + (d.parsed.prnCount ?? 0), 0);

  return {
    recordedDays: present.length,
    mood: stats(moods),
    energy: stats(energies),
    sleepQuality: stats(sleeps),
    meds,
    prnTotal,
    thoughtRecordDays: present.filter((d) => d.parsed.hasThoughtRecord).length,
    gratitudeDays: present.filter((d) => d.parsed.hasGratitude).length,
    activationDays: present.filter((d) => d.parsed.hasActivation).length,
    creativeDays: present.filter((d) => d.parsed.hasCreative).length,
  };
}

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

function weekdayOf(dateStr) {
  return WEEKDAYS_JA[new Date(`${dateStr}T00:00:00Z`).getUTCDay()] ?? '?';
}

function fmtSlot(value) {
  if (value === true) return '☑';
  if (value === false) return '☐';
  return '—';
}

function fmtStats(s, denom) {
  return s === undefined ? '記録なし' : `平均 ${s.avg}/${denom}（最低 ${s.min}・最高 ${s.max}・${s.count}日分）`;
}

function fmtRate(slot) {
  if (slot.reported === 0) return '報告なし';
  const pct = Math.round((slot.taken / slot.reported) * 100);
  return `${slot.taken}/${slot.reported}日（${pct}%）`;
}

/**
 * 週間サマリーをMarkdownとして組み立てる（PDF側で共通レンダラによりHTML化する）。
 * @param {{ start: string, end: string, dates: string[] }} range
 * @param {Array<{ date: string, parsed: object | null }>} days dates順の7要素
 * @param {ReturnType<typeof aggregateWeek>} agg
 */
export function buildWeeklySummaryMarkdown(range, days, agg) {
  const lines = [];
  lines.push('## 週間の傾向（機械集計）');
  lines.push('');
  lines.push(`- 記録のある日: ${agg.recordedDays}/7日`);
  lines.push(`- 気分: ${fmtStats(agg.mood, 10)}`);
  lines.push(`- エネルギー: ${fmtStats(agg.energy, 10)}`);
  lines.push(`- 眠りの質: ${fmtStats(agg.sleepQuality, 5)}`);
  const medParts = MED_SLOTS
    .filter(([key]) => agg.meds[key].reported > 0)
    .map(([key, label]) => `${label} ${fmtRate(agg.meds[key])}`);
  lines.push(`- 服薬: ${medParts.length > 0 ? medParts.join(' ／ ') : '報告なし'}（分母は報告があった日のみ）`);
  if (agg.prnTotal > 0) lines.push(`- 発作時⚡（頓服）: 合計 ${agg.prnTotal}回`);
  lines.push(
    `- CBT・活動記録: 思考記録 ${agg.thoughtRecordDays}日 ／ 行動活性化 ${agg.activationDays}日 ／ 感謝日記 ${agg.gratitudeDays}日 ／ 創作進捗 ${agg.creativeDays}日`,
  );
  lines.push('');
  lines.push('### 日ごとの一覧');
  lines.push('');
  lines.push('| 日付 | 気分/10 | ｴﾈﾙｷﾞｰ/10 | 眠り/5 | 起床 | 朝🌄 | 日中☀️ | 食後🍽 | 夜🌙 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const day of days) {
    const label = `${day.date.slice(5)}（${weekdayOf(day.date)}）`;
    if (day.parsed === null) {
      lines.push(`| ${label} | 記録なし |  |  |  |  |  |  |  |`);
      continue;
    }
    const p = day.parsed;
    lines.push(
      `| ${label} | ${p.mood ?? '—'} | ${p.energy ?? '—'} | ${p.sleepQuality ?? '—'} | ${p.wakeTime ?? '—'} | ` +
      `${fmtSlot(p.meds.morning)} | ${fmtSlot(p.meds.midday)} | ${fmtSlot(p.meds.afterMeal)} | ${fmtSlot(p.meds.night)} |`,
    );
  }
  lines.push('');
  lines.push('（服薬: ☑=服用済み・☐=未服用の報告・—=未報告）');
  return lines.join('\n');
}
