import type { Database } from "better-sqlite3";

export interface MedicationInput {
  userId: string;
  date: string;
  morningTaken?: boolean;
  middayTaken?: boolean;
  afterMealTaken?: boolean;
  nightTaken?: boolean;
  prnCount?: number;
  prnNotes?: string;
  notes?: string;
}

export interface MedicationRow {
  id: number;
  user_id: string;
  date: string;
  morning_taken: number | null;
  midday_taken: number | null;
  after_meal_taken: number | null;
  night_taken: number | null;
  prn_count: number | null;
  prn_notes: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function boolToTristate(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0;
}

export class MedicationStore {
  constructor(private readonly db: Database) {}

  upsert(input: MedicationInput, now: Date = new Date()): MedicationRow {
    const nowIso = now.toISOString();
    this.db
      .prepare(
        `INSERT INTO medication_logs (user_id, date, morning_taken, midday_taken, after_meal_taken, night_taken, prn_count, prn_notes, notes, created_at, updated_at)
         VALUES (@userId, @date, @morningTaken, @middayTaken, @afterMealTaken, @nightTaken, @prnCount, @prnNotes, @notes, @now, @now)
         ON CONFLICT(user_id, date) DO UPDATE SET
           morning_taken = COALESCE(excluded.morning_taken, medication_logs.morning_taken),
           midday_taken = COALESCE(excluded.midday_taken, medication_logs.midday_taken),
           after_meal_taken = COALESCE(excluded.after_meal_taken, medication_logs.after_meal_taken),
           night_taken = COALESCE(excluded.night_taken, medication_logs.night_taken),
           prn_count = COALESCE(excluded.prn_count, medication_logs.prn_count),
           prn_notes = COALESCE(excluded.prn_notes, medication_logs.prn_notes),
           notes = COALESCE(excluded.notes, medication_logs.notes),
           updated_at = excluded.updated_at`,
      )
      .run({
        userId: input.userId,
        date: input.date,
        morningTaken: boolToTristate(input.morningTaken),
        middayTaken: boolToTristate(input.middayTaken),
        afterMealTaken: boolToTristate(input.afterMealTaken),
        nightTaken: boolToTristate(input.nightTaken),
        prnCount: input.prnCount ?? null,
        prnNotes: input.prnNotes ?? null,
        notes: input.notes ?? null,
        now: nowIso,
      });

    return this.db
      .prepare("SELECT * FROM medication_logs WHERE user_id = ? AND date = ?")
      .get(input.userId, input.date) as MedicationRow;
  }

  listSince(userId: string, sinceDate: string): MedicationRow[] {
    return this.db
      .prepare("SELECT * FROM medication_logs WHERE user_id = ? AND date >= ? ORDER BY date ASC")
      .all(userId, sinceDate) as MedicationRow[];
  }
}
