import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  MISSKEY_HOST: z.string().optional().default(""),
  MISSKEY_TOKEN: z.string().optional().default(""),

  AI_PROVIDER: z.enum(["anthropic", "openai", "gemini"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().optional().default(""),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().optional().default(""),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().optional().default(""),

  DB_PATH: z.string().default(".cache/session.db"),
  HEARTBEAT_PATH: z.string().default(".cache/heartbeat.json"),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30000),

  NODE_ENV: z.enum(["development", "production"]).default("development"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),

  RATE_LIMIT_REPLY_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(1800000),
  RATE_LIMIT_GLOBAL_PER_HOUR: z.coerce.number().int().nonnegative().default(30),

  WEEKLY_SUMMARY_DAY_OF_WEEK: z.coerce.number().int().min(0).max(6).default(0),
  WEEKLY_SUMMARY_HOUR: z.coerce.number().int().min(0).max(23).default(20),

  // Claude連携ブリッジ（logs/ ⇄ SQLite）
  CLAUDE_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  CLAUDE_LOGS_DIR: z.string().default("logs"),
  BOT_DIGEST_PATH: z.string().default("logs/bot-digest.md"),
  // Bot管理者（リポジトリ所有者）のMisskeyユーザーID。
  // 設定すると連携ブリッジ（ダイジェスト出力・logs/のプロンプト注入）がこのユーザーの会話に限定され、
  // 複数ユーザー運用時に他ユーザーの記録・管理者の個人ログが混ざらない。
  // 空の場合は単一ユーザー運用とみなし、全記録を対象にする。
  BOT_OWNER_USER_ID: z.string().optional().default(""),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
