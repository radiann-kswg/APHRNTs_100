import type { AIProvider, ChatMessage } from "../ai/provider.js";
import type { SafetyIncidentStore } from "../storage/safety-incident-store.js";
import type { SessionStore } from "../storage/session-store.js";
import type { UserPreferenceStore } from "../storage/user-preference-store.js";
import { buildCrisisListeningModePrompt } from "./character/safety-policy.js";
import { RateLimiter } from "./ratelimit/index.js";
import {
  buildCrisisListeningFallbackResponse,
  buildCrisisResponse,
  checkForCrisis,
} from "./safety/crisis-detector.js";
import { ALL_TOOLS } from "./tools/definitions.js";
import { createToolExecutor, type ToolHandlerDeps } from "./tools/handlers.js";
import { containsLeakedToolCallMarkup, salvageLeakedToolCalls } from "./tools/xml-call-salvage.js";

export type Channel = "misskey" | "misskey-chat" | "cli";

/** pipelineが使うロガーの最小インターフェース（src/utils/logger.ts の Logger と互換）。 */
export interface PipelineLogger {
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
}

export interface PipelineDeps {
  aiProvider: AIProvider;
  /**
   * システムプロンプト。関数を渡すとメッセージ処理のたびに評価されるため、
   * Claude連携ブリッジで取り込んだ最新のセッション記録を都度反映できる。
   * 引数として発言ユーザーのIDとチャンネル、現在時刻を受け取るため、ユーザーごと・
   * チャンネルごとに内容を変えられる（例: BOT_OWNER_USER_ID 設定時、オーナー以外には
   * logs/の記録を注入しない。misskey-chatでは一対一チャットへの移行提案が不要、等）。
   * 現在時刻はシステムプロンプトへの日付コンテキスト注入（相対的な日付表現の解決）に使う。
   */
  systemPrompt: string | ((userId: string, channel: Channel, now: Date) => string);
  sessionStore: SessionStore;
  rateLimiter: RateLimiter;
  safetyIncidentStore: SafetyIncidentStore;
  /**
   * 省略可。ユーザーごとの「相談窓口案内」設定を参照する。未指定なら全ユーザー既定（有効）扱い。
   * 無効のユーザーで危機キーワードが検知された場合、定型の窓口案内で短絡せず、
   * 傾聴優先モードの指示を付けてLLMに応答させる（レートリミットは免除）。
   */
  userPreferenceStore?: UserPreferenceStore;
  toolHandlerDeps: ToolHandlerDeps;
  now: () => Date;
  /**
   * 省略可。指定すると、レートリミットによる抑制と空応答フォールバックの発生を記録する。
   * 「無言の正常終了」が起きたときに原因をログから追えるようにするためのもの。
   */
  logger?: PipelineLogger;
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

    // 1. 危機検知（最優先・決定論的）。インシデントは設定によらず必ず記録する。
    //    相談窓口案内が有効（既定）なら、LLMを介さず定型の窓口案内で短絡する。
    //    無効に設定したユーザーは、傾聴・相談を優先する指示を付けてLLMに応答させる。
    const crisisCheck = checkForCrisis(text);
    const hotlineGuidanceEnabled = deps.userPreferenceStore?.isCrisisHotlineEnabled(userId) ?? true;
    if (crisisCheck.triggered) {
      deps.safetyIncidentStore.record(userId, crisisCheck.matchedTerms, channel, now);
      if (hotlineGuidanceEnabled) {
        const replyText = buildCrisisResponse();
        deps.sessionStore.appendExchange(userId, text, replyText, now);
        return { replyText, suppressed: false };
      }
      deps.logger?.info(
        `危機キーワードを検知したが、相談窓口案内が無効のユーザーのため傾聴優先モードで応答する（channel=${channel}）`,
      );
    }
    const listeningMode = crisisCheck.triggered && !hotlineGuidanceEnabled;

    // 2. レートリミット判定（直近のやり取りがあれば緩和。傾聴優先モードの危機応答は免除）
    const lastInteractionAt = deps.sessionStore.getLastInteractionAt(userId);
    const decision = listeningMode
      ? { allowed: true, exempt: true }
      : deps.rateLimiter.check(userId, lastInteractionAt, now);
    if (!decision.allowed) {
      // 抑制は仕様どおりの挙動だが、外から見ると「返信が来ない」ため必ずログに残す
      deps.logger?.info(
        `レートリミットにより応答を抑制した（reason=${decision.reason ?? "unknown"}, channel=${channel}）`,
      );
      return { replyText: "", suppressed: true };
    }

    // 3. 直近の会話履歴 + 今回の発言をAIProviderへ渡す
    const history = deps.sessionStore.getHistory(userId, now);
    const messages: ChatMessage[] = [...history, { role: "user", content: text }];

    const executeTool = createToolExecutor(userId, deps.toolHandlerDeps, () => now);
    const baseSystemPrompt =
      typeof deps.systemPrompt === "function" ? deps.systemPrompt(userId, channel, now) : deps.systemPrompt;
    const systemPrompt = listeningMode
      ? `${baseSystemPrompt}\n\n---\n\n${buildCrisisListeningModePrompt(crisisCheck.matchedTerms)}`
      : baseSystemPrompt;
    let replyText: string;
    let toolInvocationCount = 0;
    try {
      const result = await deps.aiProvider.generateReply({
        systemPrompt,
        messages,
        tools: ALL_TOOLS,
        executeTool,
      });

      // 4. XML漏出ツール呼び出しの回収: LLMがツール呼び出しを正規のAPI形式ではなく
      //    XMLテキストとして本文に書いてしまうことがある（実際に一対一チャットで生XMLが
      //    そのまま投稿され、保存も実行されない不具合が起きた）。本文からパースして
      //    本来どおり実行し、XMLは本文から除去する。
      replyText = result.text;
      toolInvocationCount = result.toolInvocations.length;
      if (containsLeakedToolCallMarkup(replyText)) {
        const salvage = salvageLeakedToolCalls(replyText, ALL_TOOLS);
        deps.logger?.warn(
          `応答本文にXML形式のツール呼び出しが漏出したため回収した（calls=${salvage.calls.length}, channel=${channel}）`,
        );
        for (const call of salvage.calls) {
          await executeTool(call.name, call.input);
          toolInvocationCount++;
        }
        replyText = salvage.text;
      }
    } catch (error) {
      // 5a. 危機応答（傾聴優先モード）の安全網: ここで例外を上へ投げると、呼び出し側は
      //     エラーログを残してメッセージを未処理に戻すだけで、センパイには何も届かない
      //     （replayで再試行されるまで「死にたい」に無言のまま）。危機時に無言は許されない
      //     ため、LLMに依存しない定型の傾聴文で必ず応答する。
      //     通常メッセージは従来どおり例外を伝播させ、呼び出し側のreplay再試行に委ねる。
      if (!listeningMode) {
        throw error;
      }
      deps.logger?.warn(
        `傾聴優先モードの危機応答でAIProviderが失敗したため定型の傾聴文で応答する（channel=${channel}）`,
        error,
      );
      replyText = buildCrisisListeningFallbackResponse();
    }

    // 5b. 空応答の安全網: AIProviderが空テキストを返すと、呼び出し側（chat/mentionハンドラ）は
    //     送信をスキップし、メッセージは処理済み扱いになって再試行もされない（＝返信が永遠に
    //     来ない）。ここで定型文にフォールバックし、無言の正常終了を根絶する。
    //     傾聴優先モードの危機応答では、汎用の「もう一度話しかけてくれ」ではなく傾聴文を使う。
    if (replyText.length === 0) {
      deps.logger?.warn(
        `AIProviderが空の応答を返したためフォールバック文を使う（channel=${channel}, listeningMode=${listeningMode}, toolInvocations=${toolInvocationCount}）`,
      );
      if (listeningMode) {
        replyText = buildCrisisListeningFallbackResponse();
      } else {
        replyText =
          toolInvocationCount > 0
            ? "記録は済ませたぞ、センパイ。……すまない、返事の文章がうまく出てこなかった。内容は確かに受け取ってるから、安心してくれ。"
            : "すまない、センパイ。返事の生成にしくじったみたいだ。もう一度話しかけてくれると助かる。";
      }
    }

    deps.sessionStore.appendExchange(userId, text, replyText, now);
    deps.rateLimiter.recordReply(userId, decision.exempt, now);

    return { replyText, suppressed: false };
  };
}
