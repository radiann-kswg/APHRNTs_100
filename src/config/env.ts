import "dotenv/config";
import { z } from "zod";
import {
  CLAUDE_BRIDGE_DIGEST_DAYS,
  DEFAULT_MISSKEY_PING_INTERVAL_MS,
  DEFAULT_REPLAY_INTERVAL_MS,
} from "./constants.js";

const envSchema = z.object({
  MISSKEY_HOST: z.string().optional().default(""),
  MISSKEY_TOKEN: z.string().optional().default(""),
  // Misskeyストリームのkeepalive（アイドル切断防止）用ping送信間隔（ミリ秒）。
  // サーバ/LBのWSアイドルタイムアウトより十分短くする（既定30秒）。
  MISSKEY_PING_INTERVAL_MS: z.coerce.number().int().positive().default(DEFAULT_MISSKEY_PING_INTERVAL_MS),
  // 取りこぼし回収（replay）を接続イベントと切り離して定期実行する間隔（ミリ秒・既定60秒）。
  // 接続が安定していてもメンション/一対一チャットの取りこぼしをこの間隔でREST APIから拾い直す。
  REPLAY_INTERVAL_MS: z.coerce.number().int().positive().default(DEFAULT_REPLAY_INTERVAL_MS),

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
  DAILY_REFLECTION_HOUR: z.coerce.number().int().min(0).max(23).default(20),
  // 傾向検知（気分低下＋服薬ギャップ）による優しい声かけを1日1回チェックする時刻
  TREND_NUDGE_HOUR: z.coerce.number().int().min(0).max(23).default(21),
  // 夜の服薬リマインドを送る時刻（その日の夜🌙が服用済みならスキップ）
  MED_REMINDER_HOUR: z.coerce.number().int().min(0).max(23).default(18),

  // Claude連携ブリッジ（logs/ ⇄ SQLite）
  CLAUDE_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  CLAUDE_LOGS_DIR: z.string().default("logs"),
  BOT_DIGEST_PATH: z.string().default("logs/bot-digest.md"),
  // ダイジェスト（logs/bot-digest.md）に含める日数。月次振り返りなど一時的に長い期間が必要な場合は、
  // この値を変えずに `npm run sync:export -- --days=31` を使うこともできる。
  BOT_DIGEST_DAYS: z.coerce.number().int().positive().default(CLAUDE_BRIDGE_DIGEST_DAYS),
  // Bot管理者（リポジトリ所有者）のMisskeyユーザーID。
  // 設定すると連携ブリッジ（ダイジェスト出力・logs/のプロンプト注入）がこのユーザーの会話に限定され、
  // 複数ユーザー運用時に他ユーザーの記録・管理者の個人ログが混ざらない。
  // 空の場合は単一ユーザー運用とみなし、全記録を対象にする。
  BOT_OWNER_USER_ID: z.string().optional().default(""),

  // 本番Bot（GCE VM）との相互同期（npm run sync:pull-remote / sync:push-remote / sync:remote）のための設定。
  // 既定値は deploy/README.md に記載の本番VM構成に合わせてある。VMを再構築した場合のみ変更すること。
  GCE_PROJECT: z.string().default("numbertales-misskey-surver"),
  GCE_ZONE: z.string().default("asia-northeast1-a"),
  GCE_INSTANCE: z.string().default("aphrnts-100-bot"),
  // VM上のbot-digest.mdの絶対パス。push側はここからVMのlogsディレクトリ（/opt/aphrnts-100/logs）と
  // リポジトリルート（/opt/aphrnts-100）を導出するため、設定はこの1項目に集約している。
  REMOTE_BOT_DIGEST_PATH: z.string().default("/opt/aphrnts-100/logs/bot-digest.md"),
  // VM上でBotを実行しているユーザー（deploy/README.md参照）。push時のファイル所有者・
  // VM上での sync:import / sync:export の実行者として使う。
  REMOTE_BOT_USER: z.string().default("aphrnts-bot"),
  // gcloud CLIの実行ファイルパス（省略可・PATH上のgcloudやWindowsの既定インストール先から自動解決を試みる）
  GCLOUD_PATH: z.string().optional().default(""),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
