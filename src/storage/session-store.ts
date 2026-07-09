import type { Database } from "better-sqlite3";
import type { ChatMessage } from "../ai/provider.js";
import { SESSION_MAX_MESSAGES, SESSION_TTL_MS } from "../config/constants.js";

interface SessionRow {
  user_id: string;
  messages_json: string;
  last_interaction_at: string;
  expires_at: string;
}

export class SessionStore {
  constructor(private readonly db: Database) {}

  getHistory(userId: string, now: Date = new Date()): ChatMessage[] {
    const row = this.db.prepare("SELECT * FROM sessions WHERE user_id = ?").get(userId) as
      | SessionRow
      | undefined;
    if (!row) return [];
    if (new Date(row.expires_at).getTime() <= now.getTime()) {
      this.clear(userId);
      return [];
    }
    return JSON.parse(row.messages_json) as ChatMessage[];
  }

  getLastInteractionAt(userId: string): Date | null {
    const row = this.db
      .prepare("SELECT last_interaction_at FROM sessions WHERE user_id = ?")
      .get(userId) as Pick<SessionRow, "last_interaction_at"> | undefined;
    return row ? new Date(row.last_interaction_at) : null;
  }

  appendExchange(userId: string, userMessage: string, assistantMessage: string, now: Date = new Date()): void {
    const history = this.getHistory(userId, now);
    history.push({ role: "user", content: userMessage });
    history.push({ role: "assistant", content: assistantMessage });
    const trimmed = history.slice(-SESSION_MAX_MESSAGES);
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

    this.db
      .prepare(
        `INSERT INTO sessions (user_id, messages_json, last_interaction_at, expires_at)
         VALUES (@userId, @messagesJson, @now, @expiresAt)
         ON CONFLICT(user_id) DO UPDATE SET
           messages_json = excluded.messages_json,
           last_interaction_at = excluded.last_interaction_at,
           expires_at = excluded.expires_at`,
      )
      .run({
        userId,
        messagesJson: JSON.stringify(trimmed),
        now: now.toISOString(),
        expiresAt,
      });
  }

  clear(userId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  pruneExpired(now: Date = new Date()): number {
    const result = this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString());
    return result.changes;
  }

  listKnownUserIds(): string[] {
    const rows = this.db.prepare("SELECT DISTINCT user_id FROM sessions").all() as { user_id: string }[];
    return rows.map((row) => row.user_id);
  }

  close(): void {
    // DBのクローズはstorage/db.tsの呼び出し元が一元管理する。インターフェースの一貫性のため用意。
  }
}
