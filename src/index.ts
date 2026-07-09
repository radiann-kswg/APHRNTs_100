import { createAIProvider } from "./ai/index.js";
import { createMentionHandler } from "./bot/handlers/mention.js";
import { loadPersonaContent } from "./bot/character/loader.js";
import { buildSystemPrompt } from "./bot/character/prompt-builder.js";
import { createMessagePipeline } from "./bot/pipeline.js";
import { RateLimiter } from "./bot/ratelimit/index.js";
import { loadEnv } from "./config/env.js";
import { MisskeyClient } from "./misskey/client.js";
import { createWeeklySummaryTask } from "./scheduler/index.js";
import { TaskScheduler } from "./scheduler/task-scheduler.js";
import { BehavioralActivationStore } from "./storage/behavioral-activation-store.js";
import { BotStateStore } from "./storage/bot-state-store.js";
import { CheckinStore } from "./storage/checkin-store.js";
import { openDatabase } from "./storage/db.js";
import { GratitudeStore } from "./storage/gratitude-store.js";
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
  const rateLimitStore = new RateLimitStore(db);
  const safetyIncidentStore = new SafetyIncidentStore(db);
  const botStateStore = new BotStateStore(db);

  const rateLimiter = new RateLimiter(
    rateLimitStore,
    env.RATE_LIMIT_REPLY_COOLDOWN_MS,
    env.RATE_LIMIT_GLOBAL_PER_HOUR,
  );

  const persona = loadPersonaContent();
  const systemPrompt = buildSystemPrompt(persona);
  const aiProvider = createAIProvider(env);

  const handleMessage = createMessagePipeline({
    aiProvider,
    systemPrompt,
    sessionStore,
    rateLimiter,
    safetyIncidentStore,
    toolHandlerDeps: { checkinStore, thoughtRecordStore, gratitudeStore, activationStore },
    now: () => new Date(),
  });

  if (!env.MISSKEY_HOST || !env.MISSKEY_TOKEN) {
    logger.warn(
      "MISSKEY_HOST / MISSKEY_TOKENが未設定のため、Misskeyへの接続はスキップする。オフライン確認は `npm run dev:cli` を使うこと。",
    );
    db.close();
    return;
  }

  const misskeyClient = new MisskeyClient({ host: env.MISSKEY_HOST, token: env.MISSKEY_TOKEN });
  const onMention = createMentionHandler(handleMessage, misskeyClient);
  let wsConnected = false;
  let lastConnectedAt: string | null = null;

  misskeyClient.connect((note) => {
    onMention(note).catch((error: unknown) => {
      logger.error("mention処理でエラーが発生した", error);
    });
  });
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
