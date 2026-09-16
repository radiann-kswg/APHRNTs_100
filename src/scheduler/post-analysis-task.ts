import { aggregateDailyMetrics, type UserNote } from "../analysis/post-metrics.js";
import type { BotStateStore } from "../storage/bot-state-store.js";
import { postAnalysisCursorKey, type PostMetricStore } from "../storage/post-metric-store.js";
import type { UserPreferenceStore } from "../storage/user-preference-store.js";
import { shiftJstDateString, toJstDateString } from "../utils/date.js";
import { shouldRunDailyNow } from "./schedule-utils.js";
import type { ScheduledTask } from "./task-scheduler.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const POST_ANALYSIS_LAST_RUN_KEY = "post_analysis_last_run_at";

/** 取得に使う口。HTLは購読せず、本人の投稿だけを返す users/notes に限定する（P1）。 */
export interface PostNoteSource {
  fetchUserNotes(
    userId: string,
    options?: { sinceId?: string | null; maxNotes?: number },
  ): Promise<UserNote[]>;
}

export interface PostAnalysisTaskDeps {
  botStateStore: BotStateStore;
  preferenceStore: UserPreferenceStore;
  postMetricStore: PostMetricStore;
  noteSource: PostNoteSource;
  /** センパイ本人のMisskeyユーザーID。空なら機能ごと動かさない（対象を特定できないため） */
  ownerUserId: string;
  hour: number;
  maxNotesPerRun: number;
  visibilities: readonly string[];
  retentionDays: number;
  logger?: { info(message: string, ...args: unknown[]): void; warn(message: string, ...args: unknown[]): void };
}

/**
 * 1日1回（既定05:00 JST）、センパイ本人のMisskey投稿を前回の続きから取得し、日次の行動指標へ
 * 集計して保存するバッチ。**設定がONのときしか1件も取得しない**（オプトイン・既定OFF＝P2）。
 *
 * 投稿本文はこのタスクのメモリ内で数えられるだけで、DBにもログにも残さない（P3）。
 * 投稿を根拠にBotから声をかけることはしない（P6）。結果はセンパイに聞かれたときだけ
 * get_post_trend ツールで返す。
 */
export function createPostAnalysisTask(deps: PostAnalysisTaskDeps): ScheduledTask {
  return {
    name: "post-analysis",
    intervalMs: CHECK_INTERVAL_MS,
    run: async (now) => {
      if (!deps.ownerUserId) {
        return;
      }
      // 設定の確認を取得より前に置く。OFFのあいだはMisskeyへ1リクエストも飛ばさない。
      if (!deps.preferenceStore.isPostAnalysisEnabled(deps.ownerUserId)) {
        return;
      }
      const lastRunRaw = deps.botStateStore.get(POST_ANALYSIS_LAST_RUN_KEY);
      const lastRunAt = lastRunRaw ? new Date(lastRunRaw) : null;
      if (!shouldRunDailyNow(lastRunAt, now, deps.hour)) {
        return;
      }

      const today = toJstDateString(now);
      deps.postMetricStore.deleteBefore(deps.ownerUserId, shiftJstDateString(today, -deps.retentionDays));

      const cursorKey = postAnalysisCursorKey(deps.ownerUserId);
      const sinceId = deps.botStateStore.get(cursorKey);
      const notes = await deps.noteSource.fetchUserNotes(deps.ownerUserId, {
        sinceId,
        maxNotes: deps.maxNotesPerRun,
      });

      const metrics = aggregateDailyMetrics(notes, {
        ownerUserId: deps.ownerUserId,
        visibilities: deps.visibilities,
      });
      for (const daily of metrics) {
        deps.postMetricStore.addDaily(deps.ownerUserId, daily, now);
      }

      // カーソルは「集計対象外だったノートも含めた」最大IDまで進める。
      // 除外したノートの分を戻すと、毎回同じものを取り直し続けることになる。
      // Misskeyのidは時系列順の文字列なので辞書順比較でよい。
      const maxNoteId = notes.reduce((max, note) => (note.id > max ? note.id : max), sinceId ?? "");
      if (maxNoteId && maxNoteId !== sinceId) {
        deps.botStateStore.set(cursorKey, maxNoteId, now);
      }

      deps.botStateStore.set(POST_ANALYSIS_LAST_RUN_KEY, now.toISOString(), now);
      // 本文は出さない。件数だけを残す。
      if (notes.length > 0) {
        deps.logger?.info(`投稿の集計を更新した（取得${notes.length}件 / 対象日${metrics.length}日）。`);
      }
    },
  };
}
