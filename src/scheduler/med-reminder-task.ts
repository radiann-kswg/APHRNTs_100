import type { MisskeyClient } from "../misskey/client.js";
import type { BotStateStore } from "../storage/bot-state-store.js";
import type { MedicationStore } from "../storage/medication-store.js";
import type { SessionStore } from "../storage/session-store.js";
import { toJstDateString } from "../utils/date.js";
import { shouldRunDailyNow } from "./schedule-utils.js";
import type { ScheduledTask } from "./task-scheduler.js";

const MED_REMINDER_LAST_RUN_KEY = "med_reminder_last_run_at";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// 服薬の有無を確認するだけのリマインド。薬の増減・変更に類する助言は行わない
// （.cbt-datas/README.md の共通ルール参照）。
const MED_REMINDER_MESSAGE =
  "センパイ、そろそろ夜🌙の薬の時間だ。飲んだら「夜の薬飲んだ」って一言くれれば、おれが記録しておくぞ。もう飲んでいたら、そのまま教えてくれよな。";

export interface MedicationReminderTaskDeps {
  botStateStore: BotStateStore;
  sessionStore: SessionStore;
  medicationStore: MedicationStore;
  misskeyClient: MisskeyClient;
  /** リマインドを送る時刻（時・JST基準。既定は env.MED_REMINDER_HOUR＝18） */
  hour: number;
  /** 設定時はオーナーだけに送る（服薬記録は個人のものなので、通常はこちらを使う） */
  ownerUserId?: string;
}

/**
 * 毎日指定した時刻（既定18時台）に、その日の夜🌙の服薬がまだ記録されていないユーザーへ
 * Misskeyの一対一チャットでリマインドを送るタスクを生成する。
 *
 * - その日の記録で night_taken が「服用済み(1)」なら送らない（済んでいる人へ催促しない）。
 * - 未記録(NULL)・未服用と報告済み(0)の場合は送る（記録し忘れ・飲み忘れの両方を拾う）。
 * - センシティブな内容のため、公開ノートではなくネイティブChat API経由で送る
 *   （weekly-summary と同じ方針）。
 */
export function createMedicationReminderTask(deps: MedicationReminderTaskDeps): ScheduledTask {
  return {
    name: "med-reminder",
    intervalMs: CHECK_INTERVAL_MS,
    run: async (now) => {
      const lastRunRaw = deps.botStateStore.get(MED_REMINDER_LAST_RUN_KEY);
      const lastRunAt = lastRunRaw ? new Date(lastRunRaw) : null;
      if (!shouldRunDailyNow(lastRunAt, now, deps.hour)) {
        return;
      }

      const userIds = deps.ownerUserId ? [deps.ownerUserId] : deps.sessionStore.listKnownUserIds();
      const today = toJstDateString(now);
      for (const userId of userIds) {
        const todayRow = deps.medicationStore
          .listSince(userId, today)
          .find((row) => row.date === today);
        if (todayRow?.night_taken === 1) {
          continue;
        }
        await deps.misskeyClient.sendChatMessage(userId, MED_REMINDER_MESSAGE);
      }

      deps.botStateStore.set(MED_REMINDER_LAST_RUN_KEY, now.toISOString(), now);
    },
  };
}
