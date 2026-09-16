import type { Database } from "better-sqlite3";

export interface UserPreferences {
  /** 危機検知時に相談窓口（ホットライン）案内を最優先するか。既定 true */
  crisisHotlineEnabled: boolean;
  /** Misskeyの本人投稿から傾向を集計するか。既定 false（オプトイン） */
  postAnalysisEnabled: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  crisisHotlineEnabled: true,
  postAnalysisEnabled: false,
};

/**
 * ユーザーごとのBot動作設定（user_preferences テーブル）。
 * 行が存在しないユーザーには DEFAULT_USER_PREFERENCES を返す。
 */
export class UserPreferenceStore {
  constructor(private readonly db: Database) {}

  get(userId: string): UserPreferences {
    const row = this.db
      .prepare("SELECT crisis_hotline_enabled, post_analysis_enabled FROM user_preferences WHERE user_id = ?")
      .get(userId) as { crisis_hotline_enabled: number; post_analysis_enabled: number } | undefined;
    if (!row) {
      return { ...DEFAULT_USER_PREFERENCES };
    }
    return {
      crisisHotlineEnabled: row.crisis_hotline_enabled !== 0,
      postAnalysisEnabled: row.post_analysis_enabled !== 0,
    };
  }

  isCrisisHotlineEnabled(userId: string): boolean {
    return this.get(userId).crisisHotlineEnabled;
  }

  isPostAnalysisEnabled(userId: string): boolean {
    return this.get(userId).postAnalysisEnabled;
  }

  /** 投稿からの傾向集計のオン/オフ。OFFにしたときの蓄積データの削除は呼び出し側で行う（P2）。 */
  setPostAnalysisEnabled(userId: string, enabled: boolean, now: Date = new Date()): UserPreferences {
    this.db
      .prepare(
        `INSERT INTO user_preferences (user_id, crisis_hotline_enabled, post_analysis_enabled, updated_at)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           post_analysis_enabled = excluded.post_analysis_enabled,
           updated_at = excluded.updated_at`,
      )
      .run(userId, enabled ? 1 : 0, now.toISOString());
    return this.get(userId);
  }

  setCrisisHotlineEnabled(userId: string, enabled: boolean, now: Date = new Date()): UserPreferences {
    this.db
      .prepare(
        `INSERT INTO user_preferences (user_id, crisis_hotline_enabled, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           crisis_hotline_enabled = excluded.crisis_hotline_enabled,
           updated_at = excluded.updated_at`,
      )
      .run(userId, enabled ? 1 : 0, now.toISOString());
    return this.get(userId);
  }
}
