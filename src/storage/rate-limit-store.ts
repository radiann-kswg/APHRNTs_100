import type { Database } from "better-sqlite3";

export class RateLimitStore {
  constructor(private readonly db: Database) {}

  getLastReplyAt(userId: string): Date | null {
    const row = this.db.prepare("SELECT last_reply_at FROM rate_limit_state WHERE user_id = ?").get(userId) as
      | { last_reply_at: string }
      | undefined;
    return row ? new Date(row.last_reply_at) : null;
  }

  recordReply(userId: string, now: Date = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO rate_limit_state (user_id, last_reply_at) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET last_reply_at = excluded.last_reply_at`,
      )
      .run(userId, now.toISOString());
  }

  recordGlobalPost(now: Date = new Date()): void {
    this.db.prepare("INSERT INTO global_post_log (posted_at) VALUES (?)").run(now.toISOString());
  }

  countGlobalPostsSince(sinceIso: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM global_post_log WHERE posted_at >= ?")
      .get(sinceIso) as { count: number };
    return row.count;
  }

  pruneGlobalPostsBefore(beforeIso: string): void {
    this.db.prepare("DELETE FROM global_post_log WHERE posted_at < ?").run(beforeIso);
  }
}
