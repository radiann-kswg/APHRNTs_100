import { toJstHour } from "../utils/date.js";

const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000;

/**
 * 指定した時刻(hour・JST基準)の枠に入っていて、かつ前回実行から20時間以上経っていれば実行対象とする純関数。
 * 週次・日次のスケジュールタスクで共通の「時刻ゲート + 再発火防止クールダウン」ロジック。
 *
 * 時刻の判定は**ホストのタイムゾーンに依らずJST(UTC+9)**で行う。本番VM（GCE）はTZ未設定＝UTCのため、
 * ホストローカル時間で判定すると「18時のリマインド」がJST 03時に発火してしまう（2026-07-18に実機で確認した不具合）。
 */
export function shouldRunDailyNow(lastRunAt: Date | null, now: Date, hour: number): boolean {
  if (toJstHour(now) !== hour) {
    return false;
  }
  if (!lastRunAt) {
    return true;
  }
  return now.getTime() - lastRunAt.getTime() > TWENTY_HOURS_MS;
}
