import type { Database } from "better-sqlite3";

export interface ActivityInput {
  userId: string;
  activity: string;
  predictedPleasure?: number;
  predictedMastery?: number;
  actualPleasure?: number;
  actualMastery?: number;
  status?: "planned" | "completed" | "skipped";
}

export interface ActivityRow {
  id: number;
  user_id: string;
  activity: string;
  predicted_pleasure: number | null;
  predicted_mastery: number | null;
  actual_pleasure: number | null;
  actual_mastery: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export class BehavioralActivationStore {
  constructor(private readonly db: Database) {}

  create(input: ActivityInput, now: Date = new Date()): ActivityRow {
    const nowIso = now.toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO behavioral_activation_logs
           (user_id, activity, predicted_pleasure, predicted_mastery, actual_pleasure, actual_mastery, status, created_at, updated_at)
         VALUES (@userId, @activity, @predictedPleasure, @predictedMastery, @actualPleasure, @actualMastery, @status, @now, @now)`,
      )
      .run({
        userId: input.userId,
        activity: input.activity,
        predictedPleasure: input.predictedPleasure ?? null,
        predictedMastery: input.predictedMastery ?? null,
        actualPleasure: input.actualPleasure ?? null,
        actualMastery: input.actualMastery ?? null,
        status: input.status ?? "planned",
        now: nowIso,
      });

    return this.db
      .prepare("SELECT * FROM behavioral_activation_logs WHERE id = ?")
      .get(result.lastInsertRowid) as ActivityRow;
  }

  listSince(userId: string, sinceIso: string): ActivityRow[] {
    return this.db
      .prepare("SELECT * FROM behavioral_activation_logs WHERE user_id = ? AND created_at >= ? ORDER BY created_at ASC")
      .all(userId, sinceIso) as ActivityRow[];
  }
}
