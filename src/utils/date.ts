const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const JST_WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function toJstShifted(date: Date): Date {
  return new Date(date.getTime() + JST_OFFSET_MS);
}

/** ホストのタイムゾーンに関わらず、常にJST(UTC+9)のカレンダー日付(YYYY-MM-DD)を返す */
export function toJstDateString(date: Date): string {
  const jst = toJstShifted(date);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 例: "2026-07-11(土)" */
export function formatJstDateWithWeekday(date: Date): string {
  const jst = toJstShifted(date);
  const weekday = JST_WEEKDAY_LABELS[jst.getUTCDay()] ?? "?";
  return `${toJstDateString(date)}(${weekday})`;
}

/** "YYYY-MM-DD"文字列をdeltaDays日シフトする（月末・年末・うるう年も正しく繰り上がる） */
export function shiftJstDateString(dateStr: string, deltaDays: number): string {
  const base = new Date(`${dateStr}T00:00:00Z`);
  const shifted = new Date(base.getTime() + deltaDays * 24 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
