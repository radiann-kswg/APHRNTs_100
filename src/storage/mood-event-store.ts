import type { Database } from "better-sqlite3";

export interface MoodEventInput {
  userId: string;
  /** 対象日（JSTのYYYY-MM-DD） */
  date: string;
  /** 記録時刻（ISO 8601）。省略時はnowを使う */
  recordedAt?: string;
  /** 「朝」「昼」「夕方」「夜」「HH:MM」等の時点ラベル */
  timepoint?: string;
  /** 1〜10 */
  mood: number;
  note?: string;
}

export interface MoodEventRow {
  id: number;
  user_id: string;
  date: string;
  recorded_at: string;
  timepoint: string | null;
  mood: number;
  note: string | null;
  created_at: string;
}

/**
 * 気分の時点記録（瞬間値）ストア。
 * daily_checkins.mood（一日の総括）とは別に、「その時点の気分」を複数残すことで
 * 一日の浮き沈み（推移）を記録する。総括と瞬間値の混同
 * （例: CBT直前の落ち込みが一日の気分として記録される）を防ぐのが目的。
 */
export class MoodEventStore {
  constructor(private readonly db: Database) {}

  create(input: MoodEventInput, now: Date = new Date()): MoodEventRow {
    const nowIso = now.toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO mood_events (user_id, date, recorded_at, timepoint, mood, note, created_at)
         VALUES (@userId, @date, @recordedAt, @timepoint, @mood, @note, @now)`,
      )
      .run({
        userId: input.userId,
        date: input.date,
        recordedAt: input.recordedAt ?? nowIso,
        timepoint: input.timepoint ?? null,
        mood: input.mood,
        note: input.note ?? null,
        now: nowIso,
      });

    return this.db
      .prepare("SELECT * FROM mood_events WHERE id = ?")
      .get(result.lastInsertRowid) as MoodEventRow;
  }

  listSince(userId: string, sinceDate: string): MoodEventRow[] {
    return this.db
      .prepare(
        "SELECT * FROM mood_events WHERE user_id = ? AND date >= ? ORDER BY date ASC, recorded_at ASC, id ASC",
      )
      .all(userId, sinceDate) as MoodEventRow[];
  }
}
