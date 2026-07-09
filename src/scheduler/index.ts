import type { MisskeyClient } from "../misskey/client.js";
import type { BehavioralActivationStore } from "../storage/behavioral-activation-store.js";
import type { BotStateStore } from "../storage/bot-state-store.js";
import type { CheckinStore } from "../storage/checkin-store.js";
import type { GratitudeStore } from "../storage/gratitude-store.js";
import type { SessionStore } from "../storage/session-store.js";
import type { ThoughtRecordStore } from "../storage/thought-record-store.js";
import type { ScheduledTask } from "./task-scheduler.js";
import { buildWeeklyTrend, shouldRunNow } from "./weekly-summary-task.js";

const WEEKLY_SUMMARY_LAST_RUN_KEY = "weekly_summary_last_run_at";
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
