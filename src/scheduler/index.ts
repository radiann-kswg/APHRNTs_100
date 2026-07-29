import type { MisskeyClient } from "../misskey/client.js";
import type { BehavioralActivationStore } from "../storage/behavioral-activation-store.js";
import type { BotStateStore } from "../storage/bot-state-store.js";
import type { CheckinStore } from "../storage/checkin-store.js";
import type { GratitudeStore } from "../storage/gratitude-store.js";
import type { MedicationStore } from "../storage/medication-store.js";
import type { SessionStore } from "../storage/session-store.js";
import type { ThoughtRecordStore } from "../storage/thought-record-store.js";
import { shouldRunDailyNow } from "./schedule-utils.js";
import type { ScheduledTask } from "./task-scheduler.js";
import { buildWeeklyTrend, shouldRunNow } from "./weekly-summary-task.js";

const WEEKLY_SUMMARY_LAST_RUN_KEY = "weekly_summary_last_run_at";
const DAILY_REFLECTION_LAST_RUN_KEY = "daily_reflection_last_run_at";
const DAILY_REFLECTION_MESSAGE =
  "センパイ、そろそろ一日の振り返りの時間だ。今日の体調・気分や取り組んだことを、logs/に残すか話すだけでもいいから聞かせてくれ。";
// 朝のリマインドは夜の振り返りとは別枠。last-runキーを分けているので、
// 20時間クールダウン（shouldRunDailyNow）に阻まれず同じ日に朝・夜の両方が発火する。
const DAILY_MORNING_REMINDER_LAST_RUN_KEY = "daily_morning_reminder_last_run_at";
const DAILY_MORNING_REMINDER_MESSAGE =
  "おはよう、センパイ。今朝の体調と気分はどうだ？朝の服薬と、今日やろうと思ってることも、話せる範囲でいいから聞かせてくれ。logs/に残しておくのも忘れずにな。";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export interface WeeklySummaryTaskDeps {
  botStateStore: BotStateStore;
  sessionStore: SessionStore;
  checkinStore: CheckinStore;
  activationStore: BehavioralActivationStore;
  gratitudeStore: GratitudeStore;
  thoughtRecordStore: ThoughtRecordStore;
  medicationStore: MedicationStore;
  misskeyClient: MisskeyClient;
  dayOfWeek: number;
  hour: number;
}

export function createWeeklySummaryTask(deps: WeeklySummaryTaskDeps): ScheduledTask {
  return {
    name: "weekly-summary",
    intervalMs: CHECK_INTERVAL_MS,
    run: async (now) => {
      const lastRunRaw = deps.botStateStore.get(WEEKLY_SUMMARY_LAST_RUN_KEY);
      const lastRunAt = lastRunRaw ? new Date(lastRunRaw) : null;
      if (!shouldRunNow(lastRunAt, now, deps.dayOfWeek, deps.hour)) {
        return;
      }

      const userIds = deps.sessionStore.listKnownUserIds();
      for (const userId of userIds) {
        const trend = buildWeeklyTrend(
          userId,
          {
            checkinStore: deps.checkinStore,
            activationStore: deps.activationStore,
            gratitudeStore: deps.gratitudeStore,
            thoughtRecordStore: deps.thoughtRecordStore,
            medicationStore: deps.medicationStore,
          },
          now,
        );
        // センシティブな内容（気分・服薬の傾向）のため、公開の specified ノートではなく
        // Misskeyのネイティブ Chat API（一対一メッセージ）経由で送る。
        await deps.misskeyClient.sendChatMessage(userId, trend);
      }

      deps.botStateStore.set(WEEKLY_SUMMARY_LAST_RUN_KEY, now.toISOString(), now);
    },
  };
}

export interface DailyReflectionTaskDeps {
  botStateStore: BotStateStore;
  sessionStore: SessionStore;
  misskeyClient: MisskeyClient;
  hour: number;
}

/** 指定時刻(JST)に既知の全ユーザーへ定型メッセージを一対一チャットで送る日次タスクを生成する共通処理 */
function createDailyChatReminderTask(
  deps: DailyReflectionTaskDeps,
  options: { name: string; lastRunKey: string; message: string },
): ScheduledTask {
  return {
    name: options.name,
    intervalMs: CHECK_INTERVAL_MS,
    run: async (now) => {
      const lastRunRaw = deps.botStateStore.get(options.lastRunKey);
      const lastRunAt = lastRunRaw ? new Date(lastRunRaw) : null;
      if (!shouldRunDailyNow(lastRunAt, now, deps.hour)) {
        return;
      }

      const userIds = deps.sessionStore.listKnownUserIds();
      for (const userId of userIds) {
        await deps.misskeyClient.sendChatMessage(userId, options.message);
      }

      deps.botStateStore.set(options.lastRunKey, now.toISOString(), now);
    },
  };
}

/** 毎日指定した時刻に、既知の全ユーザーへ一日の振り返りを促すリマインドをMisskeyへ送るタスクを生成する */
export function createDailyReflectionTask(deps: DailyReflectionTaskDeps): ScheduledTask {
  return createDailyChatReminderTask(deps, {
    name: "daily-reflection",
    lastRunKey: DAILY_REFLECTION_LAST_RUN_KEY,
    message: DAILY_REFLECTION_MESSAGE,
  });
}

/**
 * 毎朝指定した時刻に、既知の全ユーザーへ朝の記録（体調・気分・朝の服薬・今日の予定）を促す
 * リマインドをMisskeyへ送るタスクを生成する。夜の振り返りとはlast-runキーが独立している。
 */
export function createDailyMorningReminderTask(deps: DailyReflectionTaskDeps): ScheduledTask {
  return createDailyChatReminderTask(deps, {
    name: "daily-morning-reminder",
    lastRunKey: DAILY_MORNING_REMINDER_LAST_RUN_KEY,
    message: DAILY_MORNING_REMINDER_MESSAGE,
  });
}
