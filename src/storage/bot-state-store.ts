import type { Database } from "better-sqlite3";

export class BotStateStore {
  constructor(private readonly db: Database) {}

  get(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM bot_state WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  set(key: string, value: string, now: Date = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO bot_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now.toISOString());
  }
}
