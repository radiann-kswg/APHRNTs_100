import type { BehavioralActivationStore } from "../../storage/behavioral-activation-store.js";
import type { CheckinStore } from "../../storage/checkin-store.js";
import type { GratitudeStore } from "../../storage/gratitude-store.js";
import type { ThoughtRecordStore } from "../../storage/thought-record-store.js";

export interface ToolHandlerDeps {
  checkinStore: CheckinStore;
  thoughtRecordStore: ThoughtRecordStore;
  gratitudeStore: GratitudeStore;
  activationStore: BehavioralActivationStore;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function createToolExecutor(
  userId: string,
  deps: ToolHandlerDeps,
  now: () => Date = () => new Date(),
): (name: string, input: Record<string, unknown>) => Promise<string> {
  return async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
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
