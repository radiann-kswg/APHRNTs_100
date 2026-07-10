import type { MisskeyClient } from "../misskey/client.js";
import type { BotStateStore } from "../storage/bot-state-store.js";
import type { CheckinRow, CheckinStore } from "../storage/checkin-store.js";
import type { MedicationRow, MedicationStore } from "../storage/medication-store.js";
import type { SessionStore } from "../storage/session-store.js";
import { shouldRunDailyNow } from "./schedule-utils.js";
import type { ScheduledTask } from "./task-scheduler.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
const FOURTEEN_DAYS_MS = 14 * ONE_DAY_MS;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const MIN_MOOD_SAMPLES = 3;
const MOOD_DECLINE_THRESHOLD = 2;
const MOOD_LOW_WATERMARK = 5;
const MEDICATION_GAP_THRESHOLD_DAYS = 3;

const TREND_NUDGE_LAST_RUN_KEY = "trend_nudge_last_run_at";

function trendNudgeUserKey(userId: string): string {
  return `trend_nudge_last_sent_at:${userId}`;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hasMissedSlot(row: MedicationRow): boolean {
  return row.morning_taken === 0 || row.midday_taken === 0 || row.after_meal_taken === 0 || row.night_taken === 0;
}

export interface TrendSignal {
  triggered: boolean;
  recentAvgMood: number | null;
  priorAvgMood: number | null;
  missedMedicationDays: number;
}

/**
 * 直近14日を7日ずつ前半（prior）・後半（recent）に分け、
 * 「後半の気分低下（前半比-2以上かつ後半平均5以下）」と「後半の服薬ギャップ（未服用日3日以上）」の
 * **両方が揃った場合のみ**傾向ありと判定する純関数（気分低下単独では発火しない）。
 * サンプル数が少ない（各半期3件未満）場合は気分傾向を判定材料に含めない。
 */
export function detectTrend(checkins: CheckinRow[], medications: MedicationRow[], now: Date): TrendSignal {
  const priorStartStr = new Date(now.getTime() - FOURTEEN_DAYS_MS).toISOString().slice(0, 10);
  const recentStartStr = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString().slice(0, 10);

  const priorMoods = checkins
    .filter((row) => row.date >= priorStartStr && row.date < recentStartStr)
    .map((row) => row.mood)
    .filter((mood): mood is number => typeof mood === "number");
  const recentMoods = checkins
    .filter((row) => row.date >= recentStartStr)
    .map((row) => row.mood)
    .filter((mood): mood is number => typeof mood === "number");

  const priorAvgMood = priorMoods.length >= MIN_MOOD_SAMPLES ? average(priorMoods) : null;
  const recentAvgMood = recentMoods.length >= MIN_MOOD_SAMPLES ? average(recentMoods) : null;

  const moodDeclineCandidate =
    priorAvgMood !== null &&
    recentAvgMood !== null &&
    recentAvgMood <= priorAvgMood - MOOD_DECLINE_THRESHOLD &&
    recentAvgMood <= MOOD_LOW_WATERMARK;

  const missedMedicationDays = medications
    .filter((row) => row.date >= recentStartStr)
    .filter(hasMissedSlot).length;
  const medicationGapCandidate = missedMedicationDays >= MEDICATION_GAP_THRESHOLD_DAYS;

  return {
    triggered: moodDeclineCandidate && medicationGapCandidate,
    recentAvgMood,
    priorAvgMood,
    missedMedicationDays,
  };
}

/**
 * 非診断的なフレーミング（「診断」「症状」等の語を使わず「〜のように見える気がする」）で、
 * 次回受診・カウンセリングへの相談を選択肢として提案する（強制しない・opt-outを必ず残す）文面を組み立てる。
 * 希死念慮・自傷などの緊急性の高いキーワードはここでは一切扱わない（crisis-detector.tsの専管領域）。
 */
export function buildTrendNudgeMessage(_signal: TrendSignal): string {
  return [
    "センパイ、最近の記録をそっと見返してみたんだが、気になったことがあるから伝えておきたい。",
    "この一週間、気分の記録がちょっと下がり気味に見える気がするし、服薬も抜けがちだったみたいだ。",
    "無理に何かを決めつけたいわけじゃない。ただ、もしよかったら今度の受診やカウンセリングのときに、この期間のことも一緒に話してみるのはどうだろう。",
    "もちろん、今のところで大丈夫そうならそれでいい。おれはいつでもここにいるから、無理せず頼ってくれ。",
  ].join("\n");
}

export interface TrendNudgeTaskDeps {
  botStateStore: BotStateStore;
  sessionStore: SessionStore;
  checkinStore: CheckinStore;
  medicationStore: MedicationStore;
  misskeyClient: MisskeyClient;
  hour: number;
}

/**
 * 1日1回（指定時刻）、既知の全ユーザーについて傾向検知を行い、該当すればMisskeyの
 * 一対一チャット（Chat API）経由で優しい声かけを送るスケジュールタスク。
 * ユーザーごとに週1回のクールダウンを設け、同じユーザーへ何度も送らないようにする。
 * 完全にスケジュール駆動（プロアクティブ）であり、pipeline.ts のリアクティブな危機検知経路とは
 * 物理的に交わらない（両者は別レイヤーで動く）。
 */
export function createTrendNudgeTask(deps: TrendNudgeTaskDeps): ScheduledTask {
  return {
    name: "trend-nudge",
    intervalMs: CHECK_INTERVAL_MS,
    run: async (now) => {
      const lastRunRaw = deps.botStateStore.get(TREND_NUDGE_LAST_RUN_KEY);
      const lastRunAt = lastRunRaw ? new Date(lastRunRaw) : null;
      if (!shouldRunDailyNow(lastRunAt, now, deps.hour)) {
        return;
      }

      const sinceDate = new Date(now.getTime() - FOURTEEN_DAYS_MS).toISOString().slice(0, 10);
      const userIds = deps.sessionStore.listKnownUserIds();

      for (const userId of userIds) {
        const lastNudgeRaw = deps.botStateStore.get(trendNudgeUserKey(userId));
        const lastNudgeAt = lastNudgeRaw ? new Date(lastNudgeRaw) : null;
        if (lastNudgeAt && now.getTime() - lastNudgeAt.getTime() < SEVEN_DAYS_MS) {
          continue;
        }

        const checkins = deps.checkinStore.listSince(userId, sinceDate);
        const medications = deps.medicationStore.listSince(userId, sinceDate);
        const signal = detectTrend(checkins, medications, now);
        if (!signal.triggered) {
          continue;
        }

        await deps.misskeyClient.sendChatMessage(userId, buildTrendNudgeMessage(signal));
        deps.botStateStore.set(trendNudgeUserKey(userId), now.toISOString(), now);
      }

      deps.botStateStore.set(TREND_NUDGE_LAST_RUN_KEY, now.toISOString(), now);
    },
  };
}
