import type { Database } from "better-sqlite3";

export interface GratitudeInput {
  userId: string;
  date: string;
  item1: string;
  item2: string;
  item3: string;
}

export interface GratitudeRow {
  id: number;
  user_id: string;
  date: string;
  item1: string;
  item2: string;
  item3: string;
  created_at: string;
}

export class GratitudeStore {
  constructor(private readonly db: Database) {}

  create(input: GratitudeInput, now: Date = new Date()): GratitudeRow {
    const result = this.db
      .prepare(
        `INSERT INTO gratitude_logs (user_id, date, item1, item2, item3, created_at)
         VALUES (@userId, @date, @item1, @item2, @item3, @now)`,
      )
      .run({
        userId: input.userId,
        date: input.date,
        item1: input.item1,
        item2: input.item2,
        item3: input.item3,
        now: now.toISOString(),
      });

    return this.db.prepare("SELECT * FROM gratitude_logs WHERE id = ?").get(result.lastInsertRowid) as GratitudeRow;
  }

  listSince(userId: string, sinceDate: string): GratitudeRow[] {
    return this.db
      .prepare("SELECT * FROM gratitude_logs WHERE user_id = ? AND date >= ? ORDER BY date ASC")
      .all(userId, sinceDate) as GratitudeRow[];
  }

  /** 指定日の記録が1件でもあるか（連携ブリッジの重複取り込み防止に使う） */
  hasAnyOnDate(userId: string, date: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM gratitude_logs WHERE user_id = ? AND date = ? LIMIT 1")
      .get(userId, date);
    return row !== undefined;
  }
}
