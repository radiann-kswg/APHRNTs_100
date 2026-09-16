import { POST_TREND_BASELINE_DAYS, summarizePostTrend } from "../../analysis/post-trend.js";
import type { BehavioralActivationStore } from "../../storage/behavioral-activation-store.js";
import type { BotStateStore } from "../../storage/bot-state-store.js";
import type { CheckinRow, CheckinStore } from "../../storage/checkin-store.js";
import type { GratitudeStore } from "../../storage/gratitude-store.js";
import type { MedicationRow, MedicationStore } from "../../storage/medication-store.js";
import type { MoodEventStore } from "../../storage/mood-event-store.js";
import { postAnalysisCursorKey, type PostMetricStore } from "../../storage/post-metric-store.js";
import type { ThoughtRecordStore } from "../../storage/thought-record-store.js";
import type { UserPreferenceStore } from "../../storage/user-preference-store.js";
import { shiftJstDateString, toJstDateString } from "../../utils/date.js";

export interface ToolHandlerDeps {
  checkinStore: CheckinStore;
  thoughtRecordStore: ThoughtRecordStore;
  gratitudeStore: GratitudeStore;
  activationStore: BehavioralActivationStore;
  medicationStore: MedicationStore;
  moodEventStore: MoodEventStore;
  /** ユーザーごとの設定（相談窓口案内の有効/無効など）。省略時は設定変更ツールが「未対応」を返す */
  userPreferenceStore?: UserPreferenceStore;
  /** 投稿由来の日次指標。省略時は投稿傾向のツールが「未対応」を返す */
  postMetricStore?: PostMetricStore;
  /** 取得カーソルの削除に使う（投稿傾向をOFFにしたとき） */
  botStateStore?: BotStateStore;
  /**
   * 投稿の集計対象にできる唯一のユーザー（= BOT_OWNER_USER_ID）。
   * 日次バッチはこのユーザーのぶんしか集めないため、他ユーザーには「有効にした」と答えない。
   */
  postAnalysisOwnerUserId?: string;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function todayIso(now: Date): string {
  return toJstDateString(now);
}

function clampRecentDays(value: number | undefined): number {
  const days = value === undefined ? 3 : Math.trunc(value);
  return Math.min(14, Math.max(1, days));
}

function clampTrendDays(value: number | undefined): number {
  const days = value === undefined ? 7 : Math.trunc(value);
  return Math.min(30, Math.max(1, days));
}

/**
 * 投稿の集計を扱える状態か（ストアが配線されていて、かつ対象ユーザー本人か）を確かめる。
 * 集められないユーザーに「有効にした」と答えてしまわないためのガード。
 */
function postAnalysisStores(
  userId: string,
  deps: ToolHandlerDeps,
): { metrics: PostMetricStore; preferences: UserPreferenceStore } | null {
  if (!deps.postMetricStore || !deps.userPreferenceStore) {
    return null;
  }
  if (deps.postAnalysisOwnerUserId && deps.postAnalysisOwnerUserId !== userId) {
    return null;
  }
  return { metrics: deps.postMetricStore, preferences: deps.userPreferenceStore };
}

const POST_ANALYSIS_UNAVAILABLE_MESSAGE = "すまない、この環境では投稿からの傾向集計は扱えないんだ。";

const POST_ANALYSIS_OFF_MESSAGE =
  "投稿からの傾向集計は、いまオフになってる（既定でオフだ）。オンにしたければ「投稿の傾向をオンにして」と言ってくれ。オンでも数えるのはセンパイ本人の投稿だけで、本文は保存しないし、いつでもオフにできる（そのときは溜めた集計も全部消す）。";

function formatRecentRecordsSummary(
  sinceDate: string,
  todayJst: string,
  days: number,
  checkinRows: CheckinRow[],
  medicationRows: MedicationRow[],
): string {
  const checkinByDate = new Map(checkinRows.map((row) => [row.date, row]));
  const medicationByDate = new Map(medicationRows.map((row) => [row.date, row]));

  const lines = [`直近${days}日間（${sinceDate}〜${todayJst}, JST）の記録状況:`];
  for (let i = 0; i < days; i++) {
    const date = shiftJstDateString(sinceDate, i);
    const checkin = checkinByDate.get(date);
    const medication = medicationByDate.get(date);

    if (!checkin && !medication) {
      lines.push(`${date}: 記録なし（全項目未記録）`);
      continue;
    }

    const medicationRecorded =
      medication != null &&
      (medication.morning_taken != null ||
        medication.midday_taken != null ||
        medication.after_meal_taken != null ||
        medication.night_taken != null ||
        medication.prn_count != null);

    lines.push(
      [
        `${date}:`,
        `気分${checkin?.mood != null ? "○" : "✕"}`,
        `睡眠${checkin?.sleep_hours != null || checkin?.sleep_quality != null ? "○" : "✕"}`,
        `エネルギー${checkin?.energy != null ? "○" : "✕"}`,
        `創作${checkin?.creative_progress != null ? "○" : "✕"}`,
        `服薬${medicationRecorded ? "○" : "✕"}`,
        `メモ${checkin?.notes != null ? "○" : "✕"}`,
      ].join(" "),
    );
  }
  return lines.join("\n");
}

export function createToolExecutor(
  userId: string,
  deps: ToolHandlerDeps,
  now: () => Date = () => new Date(),
): (name: string, input: Record<string, unknown>) => Promise<string> {
  return async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case "get_recent_records": {
        const days = clampRecentDays(numberOrUndefined(input.days));
        const today = toJstDateString(now());
        const sinceDate = shiftJstDateString(today, -(days - 1));
        const checkinRows = deps.checkinStore.listSince(userId, sinceDate);
        const medicationRows = deps.medicationStore.listSince(userId, sinceDate);
        return formatRecentRecordsSummary(sinceDate, today, days, checkinRows, medicationRows);
      }

      case "save_checkin": {
        const row = deps.checkinStore.upsert(
          {
            userId,
            date: stringOrUndefined(input.date) ?? todayIso(now()),
            mood: numberOrUndefined(input.mood),
            sleepHours: numberOrUndefined(input.sleepHours),
            sleepQuality: numberOrUndefined(input.sleepQuality),
            energy: numberOrUndefined(input.energy),
            notes: stringOrUndefined(input.notes),
            creativeProgress: stringOrUndefined(input.creativeProgress),
          },
          now(),
        );
        return `チェックインを${row.date}分として保存したぞ。`;
      }

      case "save_mood_event": {
        const mood = numberOrUndefined(input.mood);
        if (mood === undefined) {
          return "気分の数値が読み取れなかった。1〜10で教えてくれ。";
        }
        const date = stringOrUndefined(input.date) ?? todayIso(now());
        const timepoint = stringOrUndefined(input.timepoint);
        deps.moodEventStore.create(
          {
            userId,
            date,
            timepoint,
            mood,
            note: stringOrUndefined(input.note),
          },
          now(),
        );
        return `${date}の気分（${timepoint ?? "時点未指定"}: ${mood}/10）を時点記録として保存したぞ。`;
      }

      case "save_medication": {
        const date = stringOrUndefined(input.date) ?? todayIso(now());
        deps.medicationStore.upsert(
          {
            userId,
            date,
            morningTaken: booleanOrUndefined(input.morningTaken),
            middayTaken: booleanOrUndefined(input.middayTaken),
            afterMealTaken: booleanOrUndefined(input.afterMealTaken),
            nightTaken: booleanOrUndefined(input.nightTaken),
            prnCount: numberOrUndefined(input.prnCount),
            prnNotes: stringOrUndefined(input.prnNotes),
            notes: stringOrUndefined(input.notes),
          },
          now(),
        );
        return `服薬の記録を${date}分として保存したぞ。`;
      }

      case "save_thought_record": {
        deps.thoughtRecordStore.create(
          {
            userId,
            situation: stringOrUndefined(input.situation),
            automaticThought: stringOrUndefined(input.automaticThought),
            emotionLabel: stringOrUndefined(input.emotionLabel),
            emotionIntensity: numberOrUndefined(input.emotionIntensity),
            distortionId: stringOrUndefined(input.distortionId),
            evidenceFor: stringOrUndefined(input.evidenceFor),
            evidenceAgainst: stringOrUndefined(input.evidenceAgainst),
            balancedThought: stringOrUndefined(input.balancedThought),
            reRatedEmotionIntensity: numberOrUndefined(input.reRatedEmotionIntensity),
          },
          now(),
        );
        return "思考記録を保存したぞ。よく整理できたな。";
      }

      case "save_gratitude": {
        const date = stringOrUndefined(input.date) ?? todayIso(now());
        deps.gratitudeStore.create(
          {
            userId,
            date,
            item1: stringOrUndefined(input.item1) ?? "",
            item2: stringOrUndefined(input.item2) ?? "",
            item3: stringOrUndefined(input.item3) ?? "",
          },
          now(),
        );
        return `${date}の感謝日記を保存したぞ。`;
      }

      case "save_activity": {
        const activity = stringOrUndefined(input.activity);
        if (!activity) {
          return "活動の内容が読み取れなかった。もう一度教えてくれ。";
        }
        const status = stringOrUndefined(input.status);
        deps.activationStore.create(
          {
            userId,
            activity,
            predictedPleasure: numberOrUndefined(input.predictedPleasure),
            predictedMastery: numberOrUndefined(input.predictedMastery),
            actualPleasure: numberOrUndefined(input.actualPleasure),
            actualMastery: numberOrUndefined(input.actualMastery),
            status: status === "completed" || status === "skipped" ? status : "planned",
          },
          now(),
        );
        return "活動の記録を保存したぞ。";
      }

      case "set_crisis_hotline_preference": {
        const enabled = booleanOrUndefined(input.enabled);
        if (enabled === undefined) {
          return "有効にするか無効にするかが読み取れなかった。もう一度教えてくれ。";
        }
        if (!deps.userPreferenceStore) {
          return "すまない、この環境では相談窓口案内の設定を保存できない。";
        }
        deps.userPreferenceStore.setCrisisHotlineEnabled(userId, enabled, now());
        return enabled
          ? "相談窓口（ホットライン）の案内を「有効」にしたぞ。つらい言葉が出たときは、まず窓口を案内する。いつでも「オフにして」で切り替えられる。"
          : "相談窓口（ホットライン）の案内を「無効」にしたぞ。つらい言葉が出たときも番号を並べる前に、まずおれが話を聞くことを優先する。いつでも「オンにして」で戻せる。命に関わる緊急時だけは119番／110番を添えることがある。";
      }

      case "get_post_trend": {
        const stores = postAnalysisStores(userId, deps);
        if (!stores) {
          return POST_ANALYSIS_UNAVAILABLE_MESSAGE;
        }
        if (!stores.preferences.isPostAnalysisEnabled(userId)) {
          return POST_ANALYSIS_OFF_MESSAGE;
        }
        const days = clampTrendDays(numberOrUndefined(input.days));
        const today = toJstDateString(now());
        // 「平常時との差」を出すため、表示期間よりさらに前の期間ぶんも読む
        const sinceDate = shiftJstDateString(today, -(days - 1 + POST_TREND_BASELINE_DAYS));
        return summarizePostTrend(stores.metrics.listSince(userId, sinceDate), { days, today });
      }

      case "set_post_analysis_preference": {
        const enabled = booleanOrUndefined(input.enabled);
        if (enabled === undefined) {
          return "有効にするか無効にするかが読み取れなかった。もう一度教えてくれ。";
        }
        const stores = postAnalysisStores(userId, deps);
        if (!stores) {
          return POST_ANALYSIS_UNAVAILABLE_MESSAGE;
        }
        stores.preferences.setPostAnalysisEnabled(userId, enabled, now());
        if (enabled) {
          return "投稿からの傾向集計を「有効」にしたぞ。これから1日1回、センパイ本人の投稿だけを数えて、投稿数や深夜帯の投稿みたいな数字を残す。本文は保存しないし、他の人の投稿は取りに行かない。おれから投稿の話を切り出すこともしない——「最近の投稿の様子は？」と聞いてくれたときだけ返す。いつでも「オフにして」で止められるし、そのときは溜めた集計も全部消すぞ。";
        }
        // 「止めたのにデータは残っている」状態を作らない（P2）
        const deletedDays = stores.metrics.deleteAllForUser(userId);
        deps.botStateStore?.delete(postAnalysisCursorKey(userId));
        return `投稿からの傾向集計を「無効」にしたぞ。溜めてあった集計${deletedDays}日分と取得位置も、その場で消した。これ以上投稿を取りに行くことはない。また見たくなったら「オンにして」と言ってくれ。`;
      }

      default:
        return `不明なツール呼び出し: ${name}`;
    }
  };
}
