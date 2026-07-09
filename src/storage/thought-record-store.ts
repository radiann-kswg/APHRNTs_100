import type { Database } from "better-sqlite3";

export interface ThoughtRecordInput {
  userId: string;
  situation?: string;
  automaticThought?: string;
  emotionLabel?: string;
  emotionIntensity?: number;
  distortionId?: string;
  evidenceFor?: string;
  evidenceAgainst?: string;
  balancedThought?: string;
  reRatedEmotionIntensity?: number;
}

export interface ThoughtRecordRow {
  id: number;
  user_id: string;
  situation: string | null;
  automatic_thought: string | null;
  emotion_label: string | null;
  emotion_intensity: number | null;
  distortion_id: string | null;
  evidence_for: string | null;
  evidence_against: string | null;
  balanced_thought: string | null;
  re_rated_emotion_intensity: number | null;
  created_at: string;
}

export class ThoughtRecordStore {
  constructor(private readonly db: Database) {}

  create(input: ThoughtRecordInput, now: Date = new Date()): ThoughtRecordRow {
    const result = this.db
      .prepare(
        `INSERT INTO thought_records (user_id, situation, automatic_thought, emotion_label, emotion_intensity,
           distortion_id, evidence_for, evidence_against, balanced_thought, re_rated_emotion_intensity, created_at)
         VALUES (@userId, @situation, @automaticThought, @emotionLabel, @emotionIntensity,
           @distortionId, @evidenceFor, @evidenceAgainst, @balancedThought, @reRatedEmotionIntensity, @now)`,
      )
      .run({
        userId: input.userId,
        situation: input.situation ?? null,
        automaticThought: input.automaticThought ?? null,
        emotionLabel: input.emotionLabel ?? null,
        emotionIntensity: input.emotionIntensity ?? null,
        distortionId: input.distortionId ?? null,
        evidenceFor: input.evidenceFor ?? null,
        evidenceAgainst: input.evidenceAgainst ?? null,
        balancedThought: input.balancedThought ?? null,
        reRatedEmotionIntensity: input.reRatedEmotionIntensity ?? null,
        now: now.toISOString(),
      });

    return this.db
      .prepare("SELECT * FROM thought_records WHERE id = ?")
      .get(result.lastInsertRowid) as ThoughtRecordRow;
  }

  listSince(userId: string, sinceIso: string): ThoughtRecordRow[] {
    return this.db
      .prepare("SELECT * FROM thought_records WHERE user_id = ? AND created_at >= ? ORDER BY created_at ASC")
      .all(userId, sinceIso) as ThoughtRecordRow[];
  }
}
