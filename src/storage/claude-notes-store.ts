import type { Database } from "better-sqlite3";

export interface ClaudeNoteInput {
  /** logs/YYYY-MM-DD.md のファイル名に対応する日付（YYYY-MM-DD） */
  date: string;
  /** ログファイルの本文（Markdown） */
  content: string;
  /** 取り込み元ファイルのパス */
  sourcePath: string;
}

export interface ClaudeNoteRow {
  date: string;
  content: string;
  source_path: string;
  imported_at: string;
}

/**
 * Claude連携ブリッジ用ストア。
 * Claude(Desktop等)が logs/ に残した生活管理セッション記録（YYYY-MM-DD.md）を
 * 日付単位で保持する。同じ日付の再取り込みは上書き（最新のファイル内容を正とする）。
 */
export class ClaudeNotesStore {
  constructor(private readonly db: Database) {}

  upsert(input: ClaudeNoteInput, now: Date = new Date()): ClaudeNoteRow {
    this.db
      .prepare(
        `INSERT INTO claude_session_notes (date, content, source_path, imported_at)
         VALUES (@date, @content, @sourcePath, @now)
         ON CONFLICT(date) DO UPDATE SET
           content = excluded.content,
           source_path = excluded.source_path,
           imported_at = excluded.imported_at`,
      )
      .run({
        date: input.date,
        content: input.content,
        sourcePath: input.sourcePath,
        now: now.toISOString(),
      });

    return this.db
      .prepare("SELECT * FROM claude_session_notes WHERE date = ?")
      .get(input.date) as ClaudeNoteRow;
  }

  /** sinceDate（YYYY-MM-DD）以降の記録を日付昇順で返す */
  listSince(sinceDate: string): ClaudeNoteRow[] {
    return this.db
      .prepare("SELECT * FROM claude_session_notes WHERE date >= ? ORDER BY date ASC")
      .all(sinceDate) as ClaudeNoteRow[];
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM claude_session_notes").get() as { n: number };
    return row.n;
  }
}
