import type { BehavioralActivationStore } from "../storage/behavioral-activation-store.js";
import type { CheckinStore } from "../storage/checkin-store.js";
import type { GratitudeStore } from "../storage/gratitude-store.js";
import type { MedicationStore } from "../storage/medication-store.js";
import type { ThoughtRecordStore } from "../storage/thought-record-store.js";
import { shouldRunDailyNow } from "./schedule-utils.js";

export interface WeeklySummaryDeps {
  checkinStore: CheckinStore;
  activationStore: BehavioralActivationStore;
  gratitudeStore: GratitudeStore;
  thoughtRecordStore: ThoughtRecordStore;
  medicationStore: MedicationStore;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** 指定した曜日・時刻の枠に入っていて、かつ前回実行から20時間以上経っていれば実行対象とする純関数 */
export function shouldRunNow(lastRunAt: Date | null, now: Date, dayOfWeek: number, hour: number): boolean {
  if (now.getDay() !== dayOfWeek) {
    return false;
  }
  return shouldRunDailyNow(lastRunAt, now, hour);
}

export function buildWeeklyTrend(userId: string, deps: WeeklySummaryDeps, now: Date = new Date()): string {
  const sinceDate = new Date(now.getTime() - SEVEN_DAYS_MS);
  const sinceDateStr = sinceDate.toISOString().slice(0, 10);
  const sinceIso = sinceDate.toISOString();

  const checkins = deps.checkinStore.listSince(userId, sinceDateStr);
  const activities = deps.activationStore.listSince(userId, sinceIso);
  const gratitudeEntries = deps.gratitudeStore.listSince(userId, sinceDateStr);
  const thoughtRecords = deps.thoughtRecordStore.listSince(userId, sinceIso);
  const medications = deps.medicationStore.listSince(userId, sinceDateStr);

  const hasAnyRecord =
    checkins.length > 0 ||
    activities.length > 0 ||
    gratitudeEntries.length > 0 ||
    thoughtRecords.length > 0 ||
    medications.length > 0;

  if (!hasAnyRecord) {
    return "センパイ、この一週間はまだ記録がないみたいだな。無理にとは言わないが、気が向いたら今日の調子から聞かせてくれ。";
  }

  const moodValues = checkins.map((row) => row.mood).filter((mood): mood is number => typeof mood === "number");
  const avgMood =
    moodValues.length > 0 ? (moodValues.reduce((a, b) => a + b, 0) / moodValues.length).toFixed(1) : null;

  const lines = ["センパイ、今週も一週間お疲れ様。ここまでの記録を振り返ってみよう。"];
  if (avgMood) {
    lines.push(`気分の記録は${checkins.length}件、平均は${avgMood}/10くらいだった。`);
  }
  if (activities.length > 0) {
    lines.push(`行動の計画・記録は${activities.length}件あった。`);
  }
  if (gratitudeEntries.length > 0) {
    lines.push(`感謝日記は${gratitudeEntries.length}日分残せてたな。`);
  }
  if (thoughtRecords.length > 0) {
    lines.push(`思考記録にも${thoughtRecords.length}回向き合えてた。`);
  }
  if (medications.length > 0) {
    const prnTotal = medications.reduce((sum, row) => sum + (row.prn_count ?? 0), 0);
    const prnNote = prnTotal > 0 ? `（頓服は計${prnTotal}回）` : "";
    lines.push(`服薬の記録は${medications.length}日分あった${prnNote}。`);
  }
  lines.push("この調子で、無理のない範囲でまた来週も一緒にやっていこう。");

  return lines.join("\n");
}
