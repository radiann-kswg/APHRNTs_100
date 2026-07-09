import type { Database } from "better-sqlite3";

export type SafetyChannel = "misskey" | "cli";

export class SafetyIncidentStore {
  constructor(private readonly db: Database) {}

  record(userId: string, matchedTerms: string[], channel: SafetyChannel, now: Date = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO safety_incidents (user_id, triggered_at, matched_terms, channel)
         VALUES (?, ?, ?, ?)`,
      )
      .run(userId, now.toISOString(), JSON.stringify(matchedTerms), channel);
  }
}
