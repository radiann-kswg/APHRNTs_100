import type { Database } from "better-sqlite3";
import { CLAUDE_BRIDGE_DIGEST_DAYS } from "../config/constants.js";
import { BehavioralActivationStore } from "../storage/behavioral-activation-store.js";
import { CheckinStore } from "../storage/checkin-store.js";
import { ClaudeNotesStore } from "../storage/claude-notes-store.js";
import { CreativeLogStore } from "../storage/creative-log-store.js";
import { GratitudeStore } from "../storage/gratitude-store.js";
import { MedicationStore } from "../storage/medication-store.js";
import { ThoughtRecordStore } from "../storage/thought-record-store.js";
import { importCbtRecordsFromLogs } from "./cbt-importer.js";
import { importCheckinFromLogs } from "./checkin-importer.js";
import { importCreativeLogsFromLogs } from "./creative-log-importer.js";
import { buildBotDigest, writeBotDigest } from "./digest-exporter.js";
import { importClaudeLogs, type ImportResult } from "./log-importer.js";
import { importMedicationFromLogs } from "./medication-importer.js";

export interface BridgeSyncDeps {
  db: Database;
  /** Claudeのセッション記録が置かれるディレクトリ（既定: logs/） */
  logsDir: string;
  /** Bot記録ダイジェストの出力先（既定: logs/bot-digest.md） */
  digestPath: string;
  /** ダイジェストに含める日数（既定: CLAUDE_BRIDGE_DIGEST_DAYS） */
  digestDays?: number;
  /** Bot管理者のMisskeyユーザーID。指定時はダイジェスト出力をこのユーザーの記録に限定する */
  ownerUserId?: string;
  now?: () => Date;
}

/** runImport の結果。セッション記録の取り込みに加え、服薬・チェックイン等の逆マージ件数を持つ */
export interface ImportSummary extends ImportResult {
  /** 服薬チェックをbot DBへ逆マージした日数（ownerUserId 未設定時は常に0） */
  medicationMerged: number;
  /** 気分・活力・眠りの質の空きをbot DBへ補完した日数（ownerUserId 未設定時は常に0・非破壊） */
  checkinMerged: number;
  /** CBT記録（思考記録・行動活性化・感謝日記）をbot DBへ逆マージした日数の合計（同上・非破壊） */
  cbtMerged: number;
  /** 創作進捗・タスク記録をbot DBへ取り込んだ日数（同上・Claude側が正の上書きupsert） */
  creativeMerged: number;
}

export interface BridgeSyncResult {
  import: ImportSummary;
  digestPath: string;
}

/**
 * Claude→Bot（logs/取り込み）のみを実行する。
 * セッション記録の取り込みに加えて、ownerUserId が設定されていれば次の逆マージを行う:
 * - 「## 服薬」のチェック済みスロットを medication_logs へ（Claude/Health Sheet側を正とする）。
 * - 「気分: N/10」・エネルギー・眠りの質を daily_checkins の**空き項目だけ**へ（非破壊で補完）。
 * - 「## 思考記録」「## 行動活性化」「## 感謝日記」を各テーブルへ（Bot側に同じ日の記録が
 *   無い日だけ・非破壊）。
 * - creative-log 区間（「## 創作活動の進捗」「## 取り組んだタスク」）を creative_logs へ
 *   （Claude側が正の上書きupsert）。
 * これによりClaude側logsの記録が、digest・週次サマリー等のBot側の集計から一元的に参照できる。
 */
export function runImport(deps: BridgeSyncDeps): ImportSummary {
  const store = new ClaudeNotesStore(deps.db);
  const now = deps.now?.() ?? new Date();
  const result = importClaudeLogs(deps.logsDir, store, now);
  const medication = deps.ownerUserId
    ? importMedicationFromLogs(deps.logsDir, new MedicationStore(deps.db), deps.ownerUserId, now)
    : { merged: 0 };
  const checkin = deps.ownerUserId
    ? importCheckinFromLogs(deps.logsDir, new CheckinStore(deps.db), deps.ownerUserId, now)
    : { merged: 0 };
  const cbt = deps.ownerUserId
    ? importCbtRecordsFromLogs(
        deps.logsDir,
        {
          thoughtRecordStore: new ThoughtRecordStore(deps.db),
          activationStore: new BehavioralActivationStore(deps.db),
          gratitudeStore: new GratitudeStore(deps.db),
        },
        deps.ownerUserId,
      )
    : { thoughtRecords: 0, activations: 0, gratitudes: 0 };
  const creative = deps.ownerUserId
    ? importCreativeLogsFromLogs(deps.logsDir, new CreativeLogStore(deps.db), deps.ownerUserId, now)
    : { merged: 0 };
  return {
    ...result,
    medicationMerged: medication.merged,
    checkinMerged: checkin.merged,
    cbtMerged: cbt.thoughtRecords + cbt.activations + cbt.gratitudes,
    creativeMerged: creative.merged,
  };
}

/** Bot→Claude（ダイジェスト書き出し）のみを実行する */
export function runExport(deps: BridgeSyncDeps): string {
  const digest = buildBotDigest(deps.db, {
    days: deps.digestDays ?? CLAUDE_BRIDGE_DIGEST_DAYS,
    now: deps.now?.() ?? new Date(),
    ownerUserId: deps.ownerUserId,
  });
  writeBotDigest(deps.digestPath, digest);
  return deps.digestPath;
}

/** 双方向同期: logs/ の取り込み → ダイジェストの書き出し の順で実行する */
export function runSync(deps: BridgeSyncDeps): BridgeSyncResult {
  const importResult = runImport(deps);
  const digestPath = runExport(deps);
  return { import: importResult, digestPath };
}
