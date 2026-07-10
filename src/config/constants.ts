export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";

// AIプロバイダーへの1リクエストあたりのタイムアウト。上流APIがハングした際に
// プロセスは生きたまま無応答になり続けるのを防ぐため、有限時間で失敗させる。
export const AI_REQUEST_TIMEOUT_MS = 30_000;

// セッション（会話履歴）の保持ポリシー。参考repoのSessionStore（30分TTL）を踏襲。
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const SESSION_MAX_MESSAGES = 24;

export const CHARACTER_NAME = "100(モモ)";

// Claude連携ブリッジ（logs/ ⇄ SQLite）の既定値
// Bot→Claude: ダイジェスト（logs/bot-digest.md）に含める日数
export const CLAUDE_BRIDGE_DIGEST_DAYS = 14;
// Claude→Bot: システムプロンプトへ注入するセッション記録の日数
export const CLAUDE_BRIDGE_NOTES_DAYS = 7;
// 1日分の記録をプロンプトへ注入する際の最大文字数（超過分は省略）
export const CLAUDE_BRIDGE_NOTE_MAX_CHARS = 2000;
