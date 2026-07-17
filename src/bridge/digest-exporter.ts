import type { Database } from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CheckinRow } from "../storage/checkin-store.js";
import type { ThoughtRecordRow } from "../storage/thought-record-store.js";
import type { ActivityRow } from "../storage/behavioral-activation-store.js";
import type { GratitudeRow } from "../storage/gratitude-store.js";
import type { MedicationRow } from "../storage/medication-store.js";
import type { MoodEventRow } from "../storage/mood-event-store.js";
import { shiftJstDateString, toJstDateString } from "../utils/date.js";

export interface DigestOptions {
  /** 何日分をダイジェストに含めるか */
  days: number;
  now?: Date;
  /**
   * 指定した場合、このユーザーIDの記録のみをダイジェストに含める（複数ユーザー運用時のプライバシー保護）。
   * 未指定・空文字の場合は全ユーザーの記録を対象にする（単一ユーザー運用）。
   */
  ownerUserId?: string;
}

function fmt(value: number | null, suffix = "/10"): string {
  return value === null ? "—" : `${value}${suffix}`;
}

/**
 * Bot→Claude方向の連携: SQLiteに保存されたCBT記録（日次チェックイン・思考記録・
 * 行動活性化・感謝日記）から、Claude(Desktop等)がセッション開始時に読むための
 * Markdownダイジェストを組み立てる純関数。
 */
export function buildBotDigest(db: Database, options: DigestOptions): string {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - options.days * 24 * 60 * 60 * 1000);
  const sinceDate = since.toISOString().slice(0, 10);
  const sinceIso = since.toISOString();

  const owner = options.ownerUserId ?? "";
  const ownerFilter = owner ? " AND user_id = ?" : "";
  const params = (first: string): string[] => (owner ? [first, owner] : [first]);

  const checkins = db
    .prepare(`SELECT * FROM daily_checkins WHERE date >= ?${ownerFilter} ORDER BY date ASC, user_id ASC`)
    .all(...params(sinceDate)) as CheckinRow[];
  const thoughtRecords = db
    .prepare(`SELECT * FROM thought_records WHERE created_at >= ?${ownerFilter} ORDER BY created_at ASC`)
    .all(...params(sinceIso)) as ThoughtRecordRow[];
  const activities = db
    .prepare(`SELECT * FROM behavioral_activation_logs WHERE created_at >= ?${ownerFilter} ORDER BY created_at ASC`)
    .all(...params(sinceIso)) as ActivityRow[];
  const gratitudeEntries = db
    .prepare(`SELECT * FROM gratitude_logs WHERE date >= ?${ownerFilter} ORDER BY date ASC`)
    .all(...params(sinceDate)) as GratitudeRow[];
  const medications = db
    .prepare(`SELECT * FROM medication_logs WHERE date >= ?${ownerFilter} ORDER BY date ASC, user_id ASC`)
    .all(...params(sinceDate)) as MedicationRow[];
  const moodEvents = db
    .prepare(
      `SELECT * FROM mood_events WHERE date >= ?${ownerFilter} ORDER BY date ASC, recorded_at ASC, id ASC`,
    )
    .all(...params(sinceDate)) as MoodEventRow[];

  // 日付（＋ユーザー）ごとの気分推移（例: 朝7→昼4→夜6）。checkinのmood（一日の総括）とは別に瞬間値の流れを示す
  const moodTimelineByKey = new Map<string, string>();
  for (const event of moodEvents) {
    const key = `${event.user_id}|${event.date}`;
    const label = event.timepoint ?? `${event.recorded_at.slice(11, 16)}時点`;
    const piece = `${label}${event.mood}`;
    moodTimelineByKey.set(key, moodTimelineByKey.has(key) ? `${moodTimelineByKey.get(key)}→${piece}` : piece);
  }

  const lines: string[] = [
    "# Misskey Bot 記録ダイジェスト（自動生成）",
    "",
    "> このファイルはClaude連携ブリッジ（`npm run sync` / Bot実行時）が自動生成する。**手動で編集しないこと**（次回の同期で上書きされる）。",
    "> Claude(Desktop / Code)はセッション開始時にこのファイルを読み、Misskey Bot側で記録された内容を会話の文脈に反映する。",
    "",
    `- 生成日時: ${now.toISOString()}`,
    `- 対象期間: ${sinceDate} 〜 ${now.toISOString().slice(0, 10)}（直近${options.days}日）`,
    ...(owner ? [`- 対象ユーザー: ${owner}（BOT_OWNER_USER_ID による限定）`] : []),
    "",
  ];

  const hasAny =
    checkins.length > 0 ||
    thoughtRecords.length > 0 ||
    activities.length > 0 ||
    gratitudeEntries.length > 0 ||
    medications.length > 0 ||
    moodEvents.length > 0;
  if (!hasAny) {
    lines.push("対象期間内にMisskey Bot側の記録はない。");
    return lines.join("\n") + "\n";
  }

  if (checkins.length > 0 || moodEvents.length > 0) {
    lines.push("## 日次チェックイン", "");
    const datesCoveredByCheckin = new Set<string>();
    for (const row of checkins) {
      const key = `${row.user_id}|${row.date}`;
      datesCoveredByCheckin.add(key);
      const timeline = moodTimelineByKey.get(key);
      const parts = [
        // 眠りの質はHealth Sheetの5段階（5 ぐっすり〜1 あまり眠れず）が正典（/10表記は誤解釈だった）
        `気分 ${fmt(row.mood)}${timeline ? `（推移: ${timeline}）` : ""}`,
        `睡眠 ${row.sleep_hours === null ? "—" : `${row.sleep_hours}h`}（質 ${fmt(row.sleep_quality, "/5")}）`,
        `活力 ${fmt(row.energy)}`,
      ];
      let line = `- ${row.date}: ${parts.join("、")}`;
      if (row.creative_progress) line += ` ／ 創作: ${row.creative_progress}`;
      if (row.notes) line += ` ／ メモ: ${row.notes}`;
      lines.push(line);
    }
    // チェックイン（総括）が未記入で、時点記録だけがある日も推移として示す
    for (const [key, timeline] of moodTimelineByKey) {
      if (datesCoveredByCheckin.has(key)) continue;
      const date = key.slice(key.indexOf("|") + 1);
      lines.push(`- ${date}: 気分 —（総括未記入・推移: ${timeline}）`);
    }
    lines.push("");
  }

  if (thoughtRecords.length > 0) {
    lines.push("## 思考記録", "");
    for (const row of thoughtRecords) {
      const date = row.created_at.slice(0, 10);
      const emotion =
        row.emotion_label !== null
          ? `（${row.emotion_label} ${fmt(row.emotion_intensity, "")}${
              row.re_rated_emotion_intensity !== null ? `→${row.re_rated_emotion_intensity}` : ""
            }/10）`
          : "";
      lines.push(
        `- ${date}: ${row.situation ?? "（状況未記入）"} → 自動思考「${row.automatic_thought ?? "—"}」${emotion}` +
          (row.balanced_thought ? ` → バランス思考「${row.balanced_thought}」` : ""),
      );
    }
    lines.push("");
  }

  if (activities.length > 0) {
    lines.push("## 行動活性化", "");
    for (const row of activities) {
      const date = row.created_at.slice(0, 10);
      const predicted = `予測 P${fmt(row.predicted_pleasure, "")}/M${fmt(row.predicted_mastery, "")}`;
      const actual =
        row.actual_pleasure !== null || row.actual_mastery !== null
          ? ` → 実績 P${fmt(row.actual_pleasure, "")}/M${fmt(row.actual_mastery, "")}`
          : "";
      lines.push(`- ${date}: [${row.status}] ${row.activity}（${predicted}${actual}）`);
    }
    lines.push("");
  }

  if (gratitudeEntries.length > 0) {
    lines.push("## 感謝日記", "");
    for (const row of gratitudeEntries) {
      lines.push(`- ${row.date}: ${[row.item1, row.item2, row.item3].filter(Boolean).join(" ／ ")}`);
    }
    lines.push("");
  }

  if (medications.length > 0) {
    lines.push("## 服薬記録", "");
    for (const row of medications) {
      const slot = (value: number | null): string => (value === null ? "—" : value ? "済" : "未");
      const parts = [
        `朝${slot(row.morning_taken)}`,
        `日中${slot(row.midday_taken)}`,
        `食後${slot(row.after_meal_taken)}`,
        `夜${slot(row.night_taken)}`,
      ];
      let line = `- ${row.date}: ${parts.join("／")}`;
      if (row.prn_count !== null) line += ` ／ 顬服${row.prn_count}回`;
      if (row.prn_notes) line += `（${row.prn_notes}）`;
      if (row.notes) line += ` ／ メモ: ${row.notes}`;
      lines.push(line);
    }
    lines.push("");
  }

  // 記録の抜け（未記入）の自動検知: 直近days日（JST・今日を含む）のうち、
  // チェックイン・服薬の主要項目が欠けている日を列挙する。
  // Claude(Desktop)がセッション開始時にこのダイジェストを読んで「どこがまだか」を即答できるようにするのが目的。
  // ※単一ユーザー運用（BOT_OWNER_USER_ID設定時はそのユーザーのみ）を前提に、日付単位で判定する。
  const todayJst = toJstDateString(now);
  const gapStartDate = shiftJstDateString(todayJst, -(options.days - 1));
  const checkinByDate = new Map(checkins.map((row) => [row.date, row]));
  const medicationByDate = new Map(medications.map((row) => [row.date, row]));
  const gapLines: string[] = [];
  for (let i = 0; i < options.days; i++) {
    const date = shiftJstDateString(gapStartDate, i);
    if (date > todayJst) break;
    const checkin = checkinByDate.get(date);
    const medication = medicationByDate.get(date);
    const missing: string[] = [];
    if (!checkin || checkin.mood === null) missing.push("気分");
    if (!checkin || (checkin.sleep_hours === null && checkin.sleep_quality === null)) missing.push("睡眠");
    if (!checkin || checkin.energy === null) missing.push("活力");
    const missingSlots: string[] = [];
    if (!medication || medication.morning_taken === null) missingSlots.push("朝");
    if (!medication || medication.midday_taken === null) missingSlots.push("日中");
    if (!medication || medication.after_meal_taken === null) missingSlots.push("食後");
    if (!medication || medication.night_taken === null) missingSlots.push("夜");
    if (missingSlots.length === 4) {
      missing.push("服薬");
    } else if (missingSlots.length > 0) {
      missing.push(`服薬（${missingSlots.join("/")}）`);
    }
    if (missing.length > 0) {
      gapLines.push(`- ${date}: ${missing.join("・")} が未記入`);
    }
  }
  lines.push("## 記録の抜け（未記入の項目）", "");
  lines.push(
    "> Bot側SQLite基準の自動判定。当日ぶんは記入途中の可能性がある。Claude側のlogs/やHealth Sheetにのみ記録がある場合もここに出るため、埋める前に両方を確認すること。",
    "",
  );
  if (gapLines.length > 0) {
    lines.push(...gapLines);
  } else {
    lines.push("- 対象期間内に未記入の項目はない。");
  }
  lines.push("");

  return lines.join("\n");
}

/** ダイジェストをファイルへ書き出す（親ディレクトリがなければ作成する） */
export function writeBotDigest(digestPath: string, content: string): void {
  mkdirSync(dirname(digestPath), { recursive: true });
  writeFileSync(digestPath, content, "utf8");
}
