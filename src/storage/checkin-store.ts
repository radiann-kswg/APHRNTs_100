import type { Database } from "better-sqlite3";

export interface CheckinInput {
  userId: string;
  date: string;
  mood?: number;
  sleepHours?: number;
  sleepQuality?: number;
  energy?: number;
  notes?: string;
  creativeProgress?: string;
}

export interface CheckinRow {
  id: number;
  user_id: string;
  date: string;
  mood: number | null;
  sleep_hours: number | null;
  sleep_quality: number | null;
  energy: number | null;
  notes: string | null;
  creative_progress: string | null;
  created_at: string;
  updated_at: string;
}

export class CheckinStore {
  constructor(private readonly db: Database) {}

  upsert(input: CheckinInput, now: Date = new Date()): CheckinRow {
    const nowIso = now.toISOString();
    this.db
      .prepare(
        `INSERT INTO daily_checkins (user_id, date, mood, sleep_hours, sleep_quality, energy, notes, creative_progress, created_at, updated_at)
         VALUES (@userId, @date, @mood, @sleepHours, @sleepQuality, @energy, @notes, @creativeProgress, @now, @now)
         ON CONFLICT(user_id, date) DO UPDATE SET
           mood = COALESCE(excluded.mood, daily_checkins.mood),
           sleep_hours = COALESCE(excluded.sleep_hours, daily_checkins.sleep_hours),
           sleep_quality = COALESCE(excluded.sleep_quality, daily_checkins.sleep_quality),
           energy = COALESCE(excluded.energy, daily_checkins.energy),
           notes = COALESCE(excluded.notes, daily_checkins.notes),
           creative_progress = COALESCE(excluded.creative_progress, daily_checkins.creative_progress),
           updated_at = excluded.updated_at`,
      )
      .run({
        userId: input.userId,
        date: input.date,
        mood: input.mood ?? null,
        sleepHours: input.sleepHours ?? null,
        sleepQuality: input.sleepQuality ?? null,
        energy: input.energy ?? null,
        notes: input.notes ?? null,
        creativeProgress: input.creativeProgress ?? null,
        now: nowIso,
      });

    return this.db
      .prepare("SELECT * FROM daily_checkins WHERE user_id = ? AND date = ?")
      .get(input.userId, input.date) as CheckinRow;
  }

  listSince(userId: string, sinceDate: string): CheckinRow[] {
    return this.db
      .prepare("SELECT * FROM daily_checkins WHERE user_id = ? AND date >= ? ORDER BY date ASC")
      .all(userId, sinceDate) as CheckinRow[];
  }
}
