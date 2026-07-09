export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";

// セッション（会話履歴）の保持ポリシー。参考repoのSessionStore（30分TTL）を踏襲。
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const SESSION_MAX_MESSAGES = 24;

// 直近のやり取りがあるユーザーは、レートリミットの対象外として扱う猶予時間。
export const ACTIVE_CONVERSATION_WINDOW_MS = 5 * 60 * 1000;

export const CHARACTER_NAME = "100(モモ)";
