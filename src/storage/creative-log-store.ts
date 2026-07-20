import type { Database } from "better-sqlite3";

export interface CreativeLogInput {
  userId: string;
  /** 対象日（YYYY-MM-DD） */
  date: string;
  /** 「## 創作活動の進捗」の中身（Markdown）。無い日は undefined */
  progress?: string;
  /** 「## 取り組んだタスク」の中身（Markdown）。無い日は undefined */
  tasks?: string;
}

export interface CreativeLogRow {
  id: number;
  user_id: string;
  date: string;
  progress: string | null;
  tasks: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Claude連携ブリッジが logs/ の creative-log 区間から取り込む、創作進捗・タスク記録のストア。
 * Claude側の記録が正のため、日付キーの上書きupsert（冪等）とする。
 */
export class CreativeLogStore {
  constructor(private readonly db: Database) {}

  upsert(input: CreativeLogInput, now: Date = new Date()): CreativeLogRow {
    const nowIso = now.toISOString();
    this.db
      .prepare(
        `INSERT INTO creative_logs (user_id, date, progress, tasks, created_at, updated_at)
         VALUES (@userId, @date, @progress, @tasks, @now, @now)
         ON CONFLICT(user_id, date) DO UPDATE SET
           progress = excluded.progress,
           tasks = excluded.tasks,
           updated_at = excluded.updated_at`,
      )
      .run({
        userId: input.userId,
        date: input.date,
        progress: input.progress ?? null,
        tasks: input.tasks ?? null,
        now: nowIso,
      });

    return this.get(input.userId, input.date) as CreativeLogRow;
  }

  get(userId: string, date: string): CreativeLogRow | undefined {
    return this.db
      .prepare("SELECT * FROM creative_logs WHERE user_id = ? AND date = ?")
      .get(userId, date) as CreativeLogRow | undefined;
  }

  listSince(userId: string, sinceDate: string): CreativeLogRow[] {
    return this.db
      .prepare("SELECT * FROM creative_logs WHERE user_id = ? AND date >= ? ORDER BY date ASC")
      .all(userId, sinceDate) as CreativeLogRow[];
  }
}
