import { readFileSync } from "node:fs";

/**
 * 復帰報告（recovery notice）。
 *
 * Bot起動時に、前回プロセスが書き残した heartbeat.json の最終更新時刻（ts）を読み、
 * 起動時刻との間隔が閾値（RECOVERY_NOTICE_THRESHOLD_MS・既定10分）以上空いていた場合に
 * 「長時間のダウンから復帰した」とみなしてオーナーへ一対一チャットで一言報告する。
 *
 * 狙い: VMごと停止・フリーズしてGCE外部ウォッチドッグ（レイヤー3）や
 * automaticRestart で復旧したケースでは、VM内watchdog（レイヤー2）の再起動通知が
 * 飛ばないため、復帰したことをBot自身がオーナーへ伝える手段がなかった。
 * この報告があることで「返事がなかったのは落ちていたからで、いまは戻っている」と
 * オーナーが確認でき、安心感につながる。
 *
 * 注意:
 * - 判定に使う「前回のts」は、heartbeat writer が起動して heartbeat.json を
 *   上書きする**前**に読み取ること（src/index.ts の呼び出し順を参照）。
 * - レイヤー2のwatchdog再起動（数十秒程度のダウン）は閾値未満のため発火せず、
 *   既存のwatchdog通知と二重にはならない。
 */

/** heartbeat.json から前回の最終更新時刻を読み取る。無い・壊れている場合は null */
export function readPreviousHeartbeatTs(path: string): Date | null {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const ts = (parsed as { ts?: unknown }).ts;
    if (typeof ts !== "string") return null;
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * ダウン時間（ミリ秒）を返す。閾値未満・判定不能なら null（＝報告しない）。
 * thresholdMs が 0 以下の場合は機能無効とみなし常に null。
 */
export function evaluateDowntimeMs(
  previousTs: Date | null,
  now: Date,
  thresholdMs: number,
): number | null {
  if (thresholdMs <= 0) return null;
  if (previousTs === null) return null;
  const downtimeMs = now.getTime() - previousTs.getTime();
  if (downtimeMs < thresholdMs) return null;
  return downtimeMs;
}

/** ダウン時間を「約N分」「約N時間M分」の日本語表記にする */
export function formatDowntimeJa(downtimeMs: number): string {
  const totalMinutes = Math.round(downtimeMs / 60_000);
  if (totalMinutes < 60) return `約${Math.max(totalMinutes, 1)}分`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `約${hours}時間` : `約${hours}時間${minutes}分`;
}

/** 復帰報告のメッセージ本文（100(モモ)口調） */
export function buildRecoveryMessage(downtimeMs: number): string {
  const duration = formatDowntimeJa(downtimeMs);
  return (
    `センパイ、待たせたな。おれの応答が${duration}ほど止まっていたみたいだが、いま復帰したぞ。` +
    `止まっている間に届いたメッセージは、これから順に回収して返事するから少し待っていてくれ。` +
    `体調に変わりがないかも、あとで聞かせてくれよな。`
  );
}

export interface RecoveryNoticeDeps {
  /** heartbeat writer 起動前に readPreviousHeartbeatTs で読んだ値 */
  previousTs: Date | null;
  thresholdMs: number;
  ownerUserId: string;
  sendChatMessage: (toUserId: string, text: string) => Promise<void>;
  logger: { info: (msg: string) => void; warn: (msg: string, error?: unknown) => void };
  now?: Date;
}

/**
 * 長時間ダウンからの復帰を検知したらオーナーへ報告する。
 * 送信失敗しても投げない（起動処理を止めない）。
 */
export async function notifyRecoveryIfLongDowntime(deps: RecoveryNoticeDeps): Promise<boolean> {
  const now = deps.now ?? new Date();
  const downtimeMs = evaluateDowntimeMs(deps.previousTs, now, deps.thresholdMs);
  if (downtimeMs === null) return false;
  if (!deps.ownerUserId) {
    deps.logger.info(
      `長時間ダウン（${formatDowntimeJa(downtimeMs)}）からの復帰を検知したが、BOT_OWNER_USER_ID未設定のため復帰報告はスキップする。`,
    );
    return false;
  }
  try {
    await deps.sendChatMessage(deps.ownerUserId, buildRecoveryMessage(downtimeMs));
    deps.logger.info(`長時間ダウン（${formatDowntimeJa(downtimeMs)}）からの復帰をオーナーへ報告した。`);
    return true;
  } catch (error) {
    deps.logger.warn("復帰報告の送信に失敗した（起動処理は継続する）", error);
    return false;
  }
}
