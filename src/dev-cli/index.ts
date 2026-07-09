import readline from "node:readline/promises";
import { createAIProvider } from "../ai/index.js";
import { loadPersonaContent } from "../bot/character/loader.js";
import { buildSystemPrompt } from "../bot/character/prompt-builder.js";
import { createMessagePipeline } from "../bot/pipeline.js";
import { RateLimiter } from "../bot/ratelimit/index.js";
import { createBridgeRuntime } from "../bridge/runtime.js";
import { loadEnv } from "../config/env.js";
import { openDatabase } from "../storage/db.js";
import { BehavioralActivationStore } from "../storage/behavioral-activation-store.js";
import { CheckinStore } from "../storage/checkin-store.js";
import { GratitudeStore } from "../storage/gratitude-store.js";
import { RateLimitStore } from "../storage/rate-limit-store.js";
import { SafetyIncidentStore } from "../storage/safety-incident-store.js";
import { SessionStore } from "../storage/session-store.js";
import { ThoughtRecordStore } from "../storage/thought-record-store.js";
import { buildWeeklyTrend } from "../scheduler/weekly-summary-task.js";

const DEV_CLI_USER_ID = "dev-cli-local-user";

async function main(): Promise<void> {
  const env = loadEnv();
  const db = openDatabase(env.DB_PATH);

  const sessionStore = new SessionStore(db);
  const checkinStore = new CheckinStore(db);
  const thoughtRecordStore = new ThoughtRecordStore(db);
  const gratitudeStore = new GratitudeStore(db);
  const activationStore = new BehavioralActivationStore(db);
  const rateLimitStore = new RateLimitStore(db);
  const safetyIncidentStore = new SafetyIncidentStore(db);
  const rateLimiter = new RateLimiter(
    rateLimitStore,
    env.RATE_LIMIT_REPLY_COOLDOWN_MS,
    env.RATE_LIMIT_GLOBAL_PER_HOUR,
  );

  // dev-cliはローカルの単独利用なので、BOT_OWNER_USER_ID が設定されていても
  // dev-cli上の会話（DEV_CLI_USER_ID）をオーナー扱いにして連携を確認できるようにする
  const bridge = env.CLAUDE_SYNC_ENABLED
    ? createBridgeRuntime({
        db,
        logsDir: env.CLAUDE_LOGS_DIR,
        digestPath: env.BOT_DIGEST_PATH,
        ownerUserId: env.BOT_OWNER_USER_ID ? DEV_CLI_USER_ID : "",
      })
    : null;
  if (bridge) {
    const syncResult = bridge.syncOnStartup();
    console.log(
      `(Claude連携ブリッジ: ${env.CLAUDE_LOGS_DIR}/ から${syncResult.import.imported}件取り込み、ダイジェストを ${syncResult.digestPath} へ書き出した)`,
    );
  }

  const persona = loadPersonaContent();
  const systemPrompt = bridge
    ? (userId: string) => buildSystemPrompt(persona, { claudeNotesSection: bridge.notesSectionFor(userId) })
    : buildSystemPrompt(persona);
  const aiProvider = createAIProvider(env);

  let handleMessage = createMessagePipeline({
    aiProvider,
    systemPrompt,
    sessionStore,
    rateLimiter,
    safetyIncidentStore,
    toolHandlerDeps: { checkinStore, thoughtRecordStore, gratitudeStore, activationStore },
    now: () => new Date(),
  });
  if (bridge) {
    handleMessage = bridge.wrapHandler(handleMessage, (error) => {
      console.warn("(Claude連携ブリッジの同期に失敗した)", error);
    });
  }

  console.log(
    `100(モモ)のdev-cliを起動した（AIプロバイダー: ${aiProvider.name}）。/exit で終了、/reset で会話をリセット、/summary で週次振り返り、/sync でClaude連携ブリッジの同期を実行する。`,
  );

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let input: string;
      try {
        input = await rl.question("センパイ> ");
      } catch {
        // 標準入力がパイプ経由でEOFに達した場合など、readlineが閉じた後の呼び出しは
        // ここで静かにループを終了させる（対話的なターミナル利用では通常発生しない）。
        break;
      }
      const trimmed = input.trim();

      if (trimmed === "/exit") {
        break;
      }
      if (trimmed === "/reset") {
        sessionStore.clear(DEV_CLI_USER_ID);
        console.log("(会話をリセットした)");
        continue;
      }
      if (trimmed === "/sync") {
        if (!bridge) {
          console.log("(CLAUDE_SYNC_ENABLED=false のため連携ブリッジは無効になっている)");
        } else {
          const syncResult = bridge.syncOnStartup();
          console.log(
            `(logs/から${syncResult.import.imported}件取り込み、ダイジェストを ${syncResult.digestPath} へ書き出した)`,
          );
        }
        continue;
      }
      if (trimmed === "/summary") {
        const trend = buildWeeklyTrend(DEV_CLI_USER_ID, {
          checkinStore,
          activationStore,
          gratitudeStore,
          thoughtRecordStore,
        });
        console.log(`100(モモ)> ${trend}`);
        continue;
      }
      if (trimmed.length === 0) {
        continue;
      }

      try {
        const result = await handleMessage(DEV_CLI_USER_ID, trimmed, "cli");
        if (result.suppressed) {
          console.log("(レートリミットにより応答なし)");
        } else {
          console.log(`100(モモ)> ${result.replyText}`);
        }
      } catch (error) {
        console.error("エラーが発生した:", error);
      }
    }
  } finally {
    rl.close();
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
