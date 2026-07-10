import { createAIProvider } from "./ai/index.js";
import { createChatHandler } from "./bot/handlers/chat.js";
import { createMentionHandler } from "./bot/handlers/mention.js";
import { loadPersonaContent } from "./bot/character/loader.js";
import { buildSystemPrompt } from "./bot/character/prompt-builder.js";
import { createMessagePipeline, type Channel } from "./bot/pipeline.js";
import { createBridgeRuntime } from "./bridge/runtime.js";
import { RateLimiter } from "./bot/ratelimit/index.js";
import { loadEnv } from "./config/env.js";
import { MisskeyClient } from "./misskey/client.js";
import { createDailyReflectionTask, createWeeklySummaryTask } from "./scheduler/index.js";
import { TaskScheduler } from "./scheduler/task-scheduler.js";
import { createTrendNudgeTask } from "./scheduler/trend-nudge-task.js";
import { BehavioralActivationStore } from "./storage/behavioral-activation-store.js";
import { BotStateStore } from "./storage/bot-state-store.js";
import { CheckinStore } from "./storage/checkin-store.js";
import { openDatabase } from "./storage/db.js";
import { GratitudeStore } from "./storage/gratitude-store.js";
import { MedicationStore } from "./storage/medication-store.js";
import { RateLimitStore } from "./storage/rate-limit-store.js";
import { SafetyIncidentStore } from "./storage/safety-incident-store.js";
import { SessionStore } from "./storage/session-store.js";
import { ThoughtRecordStore } from "./storage/thought-record-store.js";
import { createHeartbeatWriter } from "./utils/heartbeat.js";
import { createLogger } from "./utils/logger.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const startedAt = new Date().toISOString();
  const db = openDatabase(env.DB_PATH);

  const sessionStore = new SessionStore(db);
  const checkinStore = new CheckinStore(db);
  const thoughtRecordStore = new ThoughtRecordStore(db);
  const gratitudeStore = new GratitudeStore(db);
  const activationStore = new BehavioralActivationStore(db);
  const medicationStore = new MedicationStore(db);
  const rateLimitStore = new RateLimitStore(db);
  const safetyIncidentStore = new SafetyIncidentStore(db);
  const botStateStore = new BotStateStore(db);

  const rateLimiter = new RateLimiter(
    rateLimitStore,
    env.RATE_LIMIT_REPLY_COOLDOWN_MS,
    env.RATE_LIMIT_GLOBAL_PER_HOUR,
  );

  // Claude連携ブリッジ: logs/（Claude Desktop等のセッション記録）⇄ SQLite（Botの記録）
  const bridge = env.CLAUDE_SYNC_ENABLED
    ? createBridgeRuntime({
        db,
        logsDir: env.CLAUDE_LOGS_DIR,
        digestPath: env.BOT_DIGEST_PATH,
        digestDays: env.BOT_DIGEST_DAYS,
        ownerUserId: env.BOT_OWNER_USER_ID,
      })
    : null;
  if (bridge) {
    const syncResult = bridge.syncOnStartup();
    logger.info(
      `Claude連携ブリッジ: ${env.CLAUDE_LOGS_DIR}/ から${syncResult.import.imported}件のセッション記録を取り込み、ダイジェストを ${syncResult.digestPath} へ書き出した。`,
    );
  }

  const persona = loadPersonaContent();
  const systemPrompt = bridge
    ? (userId: string, channel: Channel) =>
        buildSystemPrompt(persona, { claudeNotesSection: bridge.notesSectionFor(userId), channel })
    : (_userId: string, channel: Channel) => buildSystemPrompt(persona, { channel });
  const aiProvider = createAIProvider(env);

  let handleMessage = createMessagePipeline({
    aiProvider,
    systemPrompt,
    sessionStore,
    rateLimiter,
    safetyIncidentStore,
    toolHandlerDeps: { checkinStore, thoughtRecordStore, gratitudeStore, activationStore, medicationStore },
    now: () => new Date(),
  });
  if (bridge) {
    handleMessage = bridge.wrapHandler(handleMessage, (error) => {
      logger.warn("Claude連携ブリッジの同期に失敗した（応答処理は継続する）", error);
    });
  }

  if (!env.MISSKEY_HOST || !env.MISSKEY_TOKEN) {
    logger.warn(
      "MISSKEY_HOST / MISSKEY_TOKENが未設定のため、Misskeyへの接続はスキップする。オフライン確認は `npm run dev:cli` を使うこと。",
    );
    db.close();
    return;
  }

  const misskeyClient = new MisskeyClient({ host: env.MISSKEY_HOST, token: env.MISSKEY_TOKEN });
  const onMention = createMentionHandler(handleMessage, misskeyClient);
  const onChatMessage = createChatHandler(handleMessage, misskeyClient);
  let wsConnected = false;
  let lastConnectedAt: string | null = null;

  misskeyClient.connect(
    (note) => {
      onMention(note).catch((error: unknown) => {
        logger.error("mention処理でエラーが発生した", error);
      });
    },
    (message) => {
      onChatMessage(message).catch((error: unknown) => {
        logger.error("一対一チャット処理でエラーが発生した", error);
      });
    },
  );
  wsConnected = true;
  lastConnectedAt = new Date().toISOString();
  logger.info("Misskeyへの接続を開始した。");

  const heartbeat = createHeartbeatWriter(env.HEARTBEAT_PATH, env.HEARTBEAT_INTERVAL_MS, () => ({
    wsConnected,
    lastConnectedAt,
    startedAt,
  }));
  heartbeat.start();

  const scheduler = new TaskScheduler([
    createWeeklySummaryTask({
      botStateStore,
      sessionStore,
      checkinStore,
      activationStore,
      gratitudeStore,
      thoughtRecordStore,
      misskeyClient,
      dayOfWeek: env.WEEKLY_SUMMARY_DAY_OF_WEEK,
      hour: env.WEEKLY_SUMMARY_HOUR,
    }),
    createDailyReflectionTask({
      botStateStore,
      sessionStore,
      misskeyClient,
      hour: env.DAILY_REFLECTION_HOUR,
    }),
    createTrendNudgeTask({
      botStateStore,
      sessionStore,
      checkinStore,
      medicationStore,
      misskeyClient,
      hour: env.TREND_NUDGE_HOUR,
    }),
  ]);
  scheduler.start();

  function shutdown(): void {
    logger.info("シャットダウン処理を開始する。");
    scheduler.stop();
    heartbeat.stop();
    misskeyClient.disconnect();
    db.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
