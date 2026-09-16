import type { PostMetricRow } from "../storage/post-metric-store.js";
import { formatJstDateTime, shiftJstDateString } from "../utils/date.js";

/**
 * 日次指標（misskey_post_metrics）から、直近N日の「投稿の様子」を組み立てる純関数。
 *
 * 文面の制約（docs/misskey-post-mood-trend.md「出力とUXの要件」）:
 * - 合成スコアを作らない。素の数値と「平常時との差」だけを並べる。
 * - 評価・判定の言葉を使わない（「よく頑張った」「ダメだった」の類）。
 * - 「Botから見えている範囲の集計であること」を必ず添える。
 * - 記録や投稿が途切れている期間を責めない。最後は必ずセンパイに解釈を委ねて閉じる。
 */

/** 平常時の比較に使う、直近期間より前の日数（約4週間）。 */
export const POST_TREND_BASELINE_DAYS = 28;

export interface PostTrendOptions {
  /** 提示する直近の日数 */
  days: number;
  /** 今日（JSTのYYYY-MM-DD） */
  today: string;
  baselineDays?: number;
}

function sum(rows: PostMetricRow[], pick: (row: PostMetricRow) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

/** 今日から遡って、投稿が1件も無い日が何日続いているか（途切れの可視化）。 */
function countSilentStreak(rows: PostMetricRow[], today: string, days: number): number {
  const postedDates = new Set(rows.filter((row) => row.post_count > 0).map((row) => row.date));
  let streak = 0;
  for (let i = 0; i < days; i++) {
    if (postedDates.has(shiftJstDateString(today, -i))) {
      break;
    }
    streak += 1;
  }
  return streak;
}

export function summarizePostTrend(rows: PostMetricRow[], options: PostTrendOptions): string {
  const days = Math.max(1, Math.trunc(options.days));
  const baselineDays = options.baselineDays ?? POST_TREND_BASELINE_DAYS;
  const windowStart = shiftJstDateString(options.today, -(days - 1));
  const baselineStart = shiftJstDateString(windowStart, -baselineDays);
  const baselineEnd = shiftJstDateString(windowStart, -1);

  const recent = rows.filter((row) => row.date >= windowStart && row.date <= options.today);
  const baseline = rows.filter((row) => row.date >= baselineStart && row.date <= baselineEnd);

  const header = `直近${days}日（${windowStart}〜${options.today}, JST）の投稿の様子だ。`;
  const footer = [
    "数えたのはBotから見えている範囲（公開・ホームの投稿）の、センパイ本人の投稿だけだ。本文は保存してない。",
    "これは調子の良し悪しを決めるものじゃないから、数字の意味はセンパイ自身の実感と突き合わせて読んでくれ。",
  ];

  if (recent.length === 0) {
    const silent = countSilentStreak(recent, options.today, days);
    return [
      header,
      `- この期間に数えられた投稿は無かった（直近${silent}日は投稿が見えていない）。`,
      "- 別の場所に書いていたか、フォロワー限定などでBotから見えていないだけ、ということもある。",
      ...footer,
    ].join("\n");
  }

  const postCount = sum(recent, (row) => row.post_count);
  const nightCount = sum(recent, (row) => row.night_post_count);
  const replyCount = sum(recent, (row) => row.reply_count);
  const totalChars = sum(recent, (row) => row.total_chars);
  const cwCount = sum(recent, (row) => row.cw_count);
  const attachmentCount = sum(recent, (row) => row.attachment_post_count);
  const maxBurst = recent.reduce((max, row) => Math.max(max, row.max_burst_per_hour), 0);
  const postedDays = recent.filter((row) => row.post_count > 0).length;
  const silentStreak = countSilentStreak(recent, options.today, days);
  const lastPostAt = recent.reduce<string | null>(
    (latest, row) => (row.last_post_at && (latest === null || row.last_post_at > latest) ? row.last_post_at : latest),
    null,
  );

  const baselinePosts = sum(baseline, (row) => row.post_count);
  const baselineHasData = baseline.length > 0;
  const perDay = postCount / days;
  const baselinePerDay = baselinePosts / baselineDays;
  const avgChars = postCount > 0 ? totalChars / postCount : 0;
  const baselineAvgChars = baselinePosts > 0 ? sum(baseline, (row) => row.total_chars) / baselinePosts : 0;
  const baselineNightPerDay = sum(baseline, (row) => row.night_post_count) / baselineDays;

  const compare = (label: string, value: number): string =>
    baselineHasData ? `（その前の${baselineDays}日間は${label}${round1(value)}）` : "（比較できる前の期間の記録はまだ無い）";

  const lines = [
    header,
    `- 投稿数: 合計${postCount}件 / 1日あたり${round1(perDay)}件${compare("1日あたり", baselinePerDay)}`,
    `- 投稿のあった日: ${days}日のうち${postedDays}日`,
    `- 深夜(00:00〜04:59)の投稿: ${nightCount}件${compare("1日あたり", baselineNightPerDay)}`,
    `- 1投稿あたりの文字数: 平均${round1(avgChars)}文字${compare("平均", baselineAvgChars)}`,
    `- リプライ: ${replyCount}件 / CW付き: ${cwCount}件 / 添付あり: ${attachmentCount}件`,
    `- 1時間あたりの最大投稿数: ${maxBurst}件`,
  ];
  if (silentStreak > 0) {
    lines.push(`- 直近${silentStreak}日は投稿が見えていない（書いていないとは限らない）。`);
  }
  if (lastPostAt) {
    lines.push(`- 最後に見えた投稿: ${formatJstDateTime(lastPostAt) ?? lastPostAt}`);
  }
  return [...lines, ...footer].join("\n");
}
