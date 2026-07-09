import type { MisskeyClient } from "../misskey/client.js";
import type { BehavioralActivationStore } from "../storage/behavioral-activation-store.js";
import type { BotStateStore } from "../storage/bot-state-store.js";
import type { CheckinStore } from "../storage/checkin-store.js";
import type { GratitudeStore } from "../storage/gratitude-store.js";
import type { SessionStore } from "../storage/session-store.js";
import type { ThoughtRecordStore } from "../storage/thought-record-store.js";
import { shouldRunDailyNow } from "./schedule-utils.js";
import type { ScheduledTask } from "./task-scheduler.js";
import { buildWeeklyTrend, shouldRunNow } from "./weekly-summary-task.js";

const WEEKLY_SUMMARY_LAST_RUN_KEY = "weekly_summary_last_run_at";
const DAILY_REFLECTION_LAST_RUN_KEY = "daily_reflection_last_run_at";
const DAILY_REFLECTION_MESSAGE =
  "センパイ、そろそろ一日の振り返りの時間だ。今日の体調・気分や取り組んだことを、logs/に残すか話すだけでもいいから聞かせてくれ。";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export interface WeeklySummaryTaskDeps {
  botStateStore: BotStateStore;
  sessionStore: SessionStore;
  checkinStore: CheckinStore;
  activationStore: BehavioralActivationStore;
  gratitudeStore: GratitudeStore;
  thoughtRecordStore: ThoughtRecordStore;
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
          },
          now,
        );
        await deps.misskeyClient.postNote(trend, [userId]);
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

/** 毎日指定した時刻に、既知の全ユーザーへ一日の振り返りを促すリマインドをMisskeyへ送るタスクを生成する */
export function createDailyReflectionTask(deps: DailyReflectionTaskDeps): ScheduledTask {
  return {
    name: "daily-reflection",
    intervalMs: CHECK_INTERVAL_MS,
    run: async (now) => {
      const lastRunRaw = deps.botStateStore.get(DAILY_REFLECTION_LAST_RUN_KEY);
      const lastRunAt = lastRunRaw ? new Date(lastRunRaw) : null;
      if (!shouldRunDailyNow(lastRunAt, now, deps.hour)) {
        return;
      }

      const userIds = deps.sessionStore.listKnownUserIds();
      for (const userId of userIds) {
        await deps.misskeyClient.postNote(DAILY_REFLECTION_MESSAGE, [userId]);
      }

      deps.botStateStore.set(DAILY_REFLECTION_LAST_RUN_KEY, now.toISOString(), now);
    },
  };
}
