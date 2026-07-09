import type { AIProvider, ChatMessage } from "../ai/provider.js";
import type { SafetyIncidentStore } from "../storage/safety-incident-store.js";
import type { SessionStore } from "../storage/session-store.js";
import { RateLimiter } from "./ratelimit/index.js";
import { buildCrisisResponse, checkForCrisis } from "./safety/crisis-detector.js";
import { ALL_TOOLS } from "./tools/definitions.js";
import { createToolExecutor, type ToolHandlerDeps } from "./tools/handlers.js";

export type Channel = "misskey" | "cli";

export interface PipelineDeps {
  aiProvider: AIProvider;
  /**
   * システムプロンプト。関数を渡すとメッセージ処理のたびに評価されるため、
   * Claude連携ブリッジで取り込んだ最新のセッション記録を都度反映できる。
   */
  systemPrompt: string | (() => string);
  sessionStore: SessionStore;
  rateLimiter: RateLimiter;
  safetyIncidentStore: SafetyIncidentStore;
  toolHandlerDeps: ToolHandlerDeps;
  now: () => Date;
}

export interface HandleMessageResult {
  replyText: string;
  /** trueの場合、レートリミットにより応答を送信すべきではない（黙って何もしない） */
  suppressed: boolean;
}

export type MessageHandler = (userId: string, text: string, channel: Channel) => Promise<HandleMessageResult>;

export function createMessagePipeline(deps: PipelineDeps): MessageHandler {
  return async function handleMessage(userId, text, channel) {
    const now = deps.now();

    // 1. 危機検知（最優先・決定論的・LLMを介さない）
    const crisisCheck = checkForCrisis(text);
    if (crisisCheck.triggered) {
      deps.safetyIncidentStore.record(userId, crisisCheck.matchedTerms, channel, now);
      const replyText = buildCrisisResponse();
      deps.sessionStore.appendExchange(userId, text, replyText, now);
      return { replyText, suppressed: false };
    }

    // 2. レートリミット判定（直近のやり取りがあれば緩和）
    const lastInteractionAt = deps.sessionStore.getLastInteractionAt(userId);
    const decision = deps.rateLimiter.check(userId, lastInteractionAt, now);
    if (!decision.allowed) {
      return { replyText: "", suppressed: true };
    }

    // 3. 直近の会話履歴 + 今回の発言をAIProviderへ渡す
    const history = deps.sessionStore.getHistory(userId, now);
    const messages: ChatMessage[] = [...history, { role: "user", content: text }];

    const executeTool = createToolExecutor(userId, deps.toolHandlerDeps, () => now);
    const systemPrompt = typeof deps.systemPrompt === "function" ? deps.systemPrompt() : deps.systemPrompt;
    const result = await deps.aiProvider.generateReply({
      systemPrompt,
      messages,
      tools: ALL_TOOLS,
      executeTool,
    });

    deps.sessionStore.appendExchange(userId, text, result.text, now);
    deps.rateLimiter.recordReply(userId, decision.exempt, now);

    return { replyText: result.text, suppressed: false };
  };
}
