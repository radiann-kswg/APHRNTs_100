const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000;

/**
 * 指定した時刻(hour)の枠に入っていて、かつ前回実行から20時間以上経っていれば実行対象とする純関数。
 * 週次・日次のスケジュールタスクで共通の「時刻ゲート + 再発火防止クールダウン」ロジック。
 */
export function shouldRunDailyNow(lastRunAt: Date | null, now: Date, hour: number): boolean {
  if (now.getHours() !== hour) {
    return false;
  }
  if (!lastRunAt) {
    return true;
  }
  return now.getTime() - lastRunAt.getTime() > TWENTY_HOURS_MS;
}
