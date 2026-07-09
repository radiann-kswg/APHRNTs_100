import type { Database } from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CheckinRow } from "../storage/checkin-store.js";
import type { ThoughtRecordRow } from "../storage/thought-record-store.js";
import type { ActivityRow } from "../storage/behavioral-activation-store.js";
import type { GratitudeRow } from "../storage/gratitude-store.js";

export interface DigestOptions {
  /** 何日分をダイジェストに含めるか */
  days: number;
  now?: Date;
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

  const checkins = db
    .prepare("SELECT * FROM daily_checkins WHERE date >= ? ORDER BY date ASC, user_id ASC")
    .all(sinceDate) as CheckinRow[];
  const thoughtRecords = db
    .prepare("SELECT * FROM thought_records WHERE created_at >= ? ORDER BY created_at ASC")
    .all(sinceIso) as ThoughtRecordRow[];
  const activities = db
    .prepare("SELECT * FROM behavioral_activation_logs WHERE created_at >= ? ORDER BY created_at ASC")
    .all(sinceIso) as ActivityRow[];
  const gratitudeEntries = db
    .prepare("SELECT * FROM gratitude_logs WHERE date >= ? ORDER BY date ASC")
    .all(sinceDate) as GratitudeRow[];

  const lines: string[] = [
    "# Misskey Bot 記録ダイジェスト（自動生成）",
    "",
    "> このファイルはClaude連携ブリッジ（`npm run sync` / Bot実行時）が自動生成する。**手動で編集しないこと**（次回の同期で上書きされる）。",
    "> Claude(Desktop / Code)はセッション開始時にこのファイルを読み、Misskey Bot側で記録された内容を会話の文脈に反映する。",
    "",
    `- 生成日時: ${now.toISOString()}`,
    `- 対象期間: ${sinceDate} 〜 ${now.toISOString().slice(0, 10)}（直近${options.days}日）`,
    "",
  ];

  const hasAny =
    checkins.length > 0 || thoughtRecords.length > 0 || activities.length > 0 || gratitudeEntries.length > 0;
  if (!hasAny) {
    lines.push("対象期間内にMisskey Bot側の記録はない。");
    return lines.join("\n") + "\n";
  }

  if (checkins.length > 0) {
    lines.push("## 日次チェックイン", "");
    for (const row of checkins) {
      const parts = [
        `気分 ${fmt(row.mood)}`,
        `睡眠 ${row.sleep_hours === null ? "—" : `${row.sleep_hours}h`}（質 ${fmt(row.sleep_quality)}）`,
        `活力 ${fmt(row.energy)}`,
      ];
      let line = `- ${row.date}: ${parts.join("、")}`;
      if (row.creative_progress) line += ` ／ 創作: ${row.creative_progress}`;
      if (row.notes) line += ` ／ メモ: ${row.notes}`;
      lines.push(line);
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

  return lines.join("\n");
}

/** ダイジェストをファイルへ書き出す（親ディレクトリがなければ作成する） */
export function writeBotDigest(digestPath: string, content: string): void {
  mkdirSync(dirname(digestPath), { recursive: true });
  writeFileSync(digestPath, content, "utf8");
}
