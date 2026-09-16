import type { Database } from "better-sqlite3";
import type { DailyPostMetrics } from "../analysis/post-metrics.js";

export interface PostMetricRow {
  id: number;
  user_id: string;
  date: string;
  post_count: number;
  reply_count: number;
  night_post_count: number;
  first_post_at: string | null;
  last_post_at: string | null;
  total_chars: number;
  cw_count: number;
  attachment_post_count: number;
  max_burst_per_hour: number;
  created_at: string;
  updated_at: string;
}

/** 取得カーソル（bot_state）のキー。停止時はこれも消す（「止めたのにデータは残っている」を作らない）。 */
export function postAnalysisCursorKey(userId: string): string {
  return `post_analysis_last_note_id:${userId}`;
}

/**
 * 投稿由来の日次指標（misskey_post_metrics）。**投稿本文は保存しない**（数えた結果だけを持つ）。
 * 取得はカーソル方式で「前回の続き」しか来ないため、同じ日への書き込みは上書きではなく加算でマージする。
 */
export class PostMetricStore {
  constructor(private readonly db: Database) {}

  /**
   * 1日分の指標を加算マージする。同じ日に複数回走っても、カーソル以降の新着分だけが足される。
   * ponytail: max_burst_per_hour は「1回の取得で見えた範囲」の最大値。連投が取得の切れ目を
   * またぐと過小評価になるが、日次バッチでは1日ぶんが1回で入るため実害がない。
   * 厳密に数えたくなったら、日付単位で再集計するバックフィルを足すこと。
   */
  addDaily(userId: string, metrics: DailyPostMetrics, now: Date = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO misskey_post_metrics (
           user_id, date, post_count, reply_count, night_post_count, first_post_at, last_post_at,
           total_chars, cw_count, attachment_post_count, max_burst_per_hour, created_at, updated_at
         ) VALUES (
           @userId, @date, @postCount, @replyCount, @nightPostCount, @firstPostAt, @lastPostAt,
           @totalChars, @cwCount, @attachmentPostCount, @maxBurstPerHour, @now, @now
         )
         ON CONFLICT(user_id, date) DO UPDATE SET
           post_count = misskey_post_metrics.post_count + excluded.post_count,
           reply_count = misskey_post_metrics.reply_count + excluded.reply_count,
           night_post_count = misskey_post_metrics.night_post_count + excluded.night_post_count,
           total_chars = misskey_post_metrics.total_chars + excluded.total_chars,
           cw_count = misskey_post_metrics.cw_count + excluded.cw_count,
           attachment_post_count = misskey_post_metrics.attachment_post_count + excluded.attachment_post_count,
           max_burst_per_hour = MAX(misskey_post_metrics.max_burst_per_hour, excluded.max_burst_per_hour),
           first_post_at = MIN(
             COALESCE(misskey_post_metrics.first_post_at, excluded.first_post_at),
             COALESCE(excluded.first_post_at, misskey_post_metrics.first_post_at)
           ),
           last_post_at = MAX(
             COALESCE(misskey_post_metrics.last_post_at, excluded.last_post_at),
             COALESCE(excluded.last_post_at, misskey_post_metrics.last_post_at)
           ),
           updated_at = excluded.updated_at`,
      )
      .run({
        userId,
        date: metrics.date,
        postCount: metrics.postCount,
        replyCount: metrics.replyCount,
        nightPostCount: metrics.nightPostCount,
        firstPostAt: metrics.firstPostAt,
        lastPostAt: metrics.lastPostAt,
        totalChars: metrics.totalChars,
        cwCount: metrics.cwCount,
        attachmentPostCount: metrics.attachmentPostCount,
        maxBurstPerHour: metrics.maxBurstPerHour,
        now: now.toISOString(),
      });
  }

  listSince(userId: string, sinceDate: string): PostMetricRow[] {
    return this.db
      .prepare("SELECT * FROM misskey_post_metrics WHERE user_id = ? AND date >= ? ORDER BY date ASC")
      .all(userId, sinceDate) as PostMetricRow[];
  }

  /** 保持期間を過ぎた指標を消す（日次バッチの冒頭で呼ぶ）。 */
  deleteBefore(userId: string, date: string): number {
    return this.db
      .prepare("DELETE FROM misskey_post_metrics WHERE user_id = ? AND date < ?")
      .run(userId, date).changes;
  }

  /** 機能をOFFにしたときに、そのユーザーの蓄積をその場で全部消す（P2）。 */
  deleteAllForUser(userId: string): number {
    return this.db.prepare("DELETE FROM misskey_post_metrics WHERE user_id = ?").run(userId).changes;
  }
}
