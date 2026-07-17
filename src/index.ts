import { createAIProvider } from "./ai/index.js";
import { createChatHandler } from "./bot/handlers/chat.js";
import { createMentionHandler } from "./bot/handlers/mention.js";
import { loadPersonaContent } from "./bot/character/loader.js";
import { buildSystemPrompt } from "./bot/character/prompt-builder.js";
import { createMessagePipeline, type Channel } from "./bot/pipeline.js";
import { createReplayRunner } from "./bot/replay.js";
import { createBridgeRuntime } from "./bridge/runtime.js";
import { RateLimiter } from "./bot/ratelimit/index.js";
import { loadEnv } from "./config/env.js";
import { MisskeyClient } from "./misskey/client.js";
import { createDailyReflectionTask, createWeeklySummaryTask } from "./scheduler/index.js";
import { createMedicationReminderTask } from "./scheduler/med-reminder-task.js";
import { TaskScheduler } from "./scheduler/task-scheduler.js";
import { createTrendNudgeTask } from "./scheduler/trend-nudge-task.js";
import { BehavioralActivationStore } from "./storage/behavioral-activation-store.js";
import { BotStateStore } from "./storage/bot-state-store.js";
import { CheckinStore } from "./storage/checkin-store.js";
import { openDatabase } from "./storage/db.js";
import { GratitudeStore } from "./storage/gratitude-store.js";
import { MedicationStore } from "./storage/medication-store.js";
import { MoodEventStore } from "./storage/mood-event-store.js";
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
  const moodEventStore = new MoodEventStore(db);
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
    ? (userId: string, channel: Channel, now: Date) =>
        buildSystemPrompt(persona, { claudeNotesSection: bridge.notesSectionFor(userId), channel, now })
    : (_userId: string, channel: Channel, now: Date) => buildSystemPrompt(persona, { channel, now });
  const aiProvider = createAIProvider(env);

  let handleMessage = createMessagePipeline({
    aiProvider,
    systemPrompt,
    sessionStore,
    rateLimiter,
    safetyIncidentStore,
    toolHandlerDeps: { checkinStore, thoughtRecordStore, gratitudeStore, activationStore, medicationStore, moodEventStore },
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

  // WS切断中に届いたメッセージの取りこぼし回収（replay）。再接続・起動時にREST APIで遡って処理する
  const replay = createReplayRunner({
    source: misskeyClient,
    stateStore: botStateStore,
    ownerUserId: env.BOT_OWNER_USER_ID,
    onMention,
    onChatMessage,
  });
  // 接続確立の直後はチャンネル購読が安定していないことがあるため、少し置いてからreplayする
  const REPLAY_DELAY_MS = 3000;
  let replayTimer: NodeJS.Timeout | null = null;
  function scheduleReplay(): void {
    if (replayTimer) clearTimeout(replayTimer);
    replayTimer = setTimeout(() => {
      replayTimer = null;
      replay
        .runReplay()
        .then((result) => {
          if (result.mentions > 0 || result.chats > 0) {
            logger.info(
              `切断中に届いていたメッセージを回収した（メンション${result.mentions}件・チャット${result.chats}件）。`,
            );
          }
        })
        .catch((error: unknown) => {
          logger.warn("取りこぼし回収（replay）に失敗した。次回の再接続時に再試行する", error);
        });
    }, REPLAY_DELAY_MS);
  }

  let wsConnected = false;
  let lastConnectedAt: string | null = null;
  let lastDisconnectedAt: string | null = null;
  let reconnectCount = 0;
  // 直近1時間の切断時刻（churn検知用）。heartbeat経由でwatchdogに渡す
  const HOUR_MS = 60 * 60 * 1000;
  const disconnectTimesMs: number[] = [];
  function countDisconnectsLastHour(nowMs: number): number {
    while (disconnectTimesMs.length > 0 && nowMs - (disconnectTimesMs[0] ?? 0) > HOUR_MS) {
      disconnectTimesMs.shift();
    }
    return disconnectTimesMs.length;
  }

  misskeyClient.connect(
    (note) => {
      onMention(note)
        .then(() => {
          replay.markMentionProcessed(note.id);
        })
        .catch((error: unknown) => {
          logger.error("mention処理でエラーが発生した", error);
        });
    },
    (message) => {
      onChatMessage(message)
        .then(() => {
          replay.markChatProcessed(message.id);
        })
        .catch((error: unknown) => {
          logger.error("一対一チャット処理でエラーが発生した", error);
        });
    },
    (connected) => {
      wsConnected = connected;
      if (connected) {
        if (lastDisconnectedAt !== null) {
          reconnectCount += 1;
        }
        lastConnectedAt = new Date().toISOString();
        // 初回接続時はベースライン記録のみ・再接続時は切断中ぶんの回収（詳細はsrc/bot/replay.ts）
        scheduleReplay();
      } else {
        lastDisconnectedAt = new Date().toISOString();
        disconnectTimesMs.push(Date.now());
      }
    },
  );
  logger.info("Misskeyへの接続を開始した。");

  const heartbeat = createHeartbeatWriter(env.HEARTBEAT_PATH, env.HEARTBEAT_INTERVAL_MS, () => ({
    wsConnected,
    lastConnectedAt,
    lastDisconnectedAt,
    startedAt,
    reconnectCount,
    disconnectsLastHour: countDisconnectsLastHour(Date.now()),
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
      medicationStore,
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
    createMedicationReminderTask({
      botStateStore,
      sessionStore,
      medicationStore,
      misskeyClient,
      hour: env.MED_REMINDER_HOUR,
      ownerUserId: env.BOT_OWNER_USER_ID || undefined,
    }),
  ]);
  scheduler.start();

  function shutdown(): void {
    logger.info("シャットダウン処理を開始する。");
    if (replayTimer) clearTimeout(replayTimer);
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
