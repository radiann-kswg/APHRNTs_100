import type { BehavioralActivationStore } from "../../storage/behavioral-activation-store.js";
import type { CheckinRow, CheckinStore } from "../../storage/checkin-store.js";
import type { GratitudeStore } from "../../storage/gratitude-store.js";
import type { MedicationRow, MedicationStore } from "../../storage/medication-store.js";
import type { ThoughtRecordStore } from "../../storage/thought-record-store.js";
import { shiftJstDateString, toJstDateString } from "../../utils/date.js";

export interface ToolHandlerDeps {
  checkinStore: CheckinStore;
  thoughtRecordStore: ThoughtRecordStore;
  gratitudeStore: GratitudeStore;
  activationStore: BehavioralActivationStore;
  medicationStore: MedicationStore;
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

      default:
        return `不明なツール呼び出し: ${name}`;
    }
  };
}
