import Anthropic from "@anthropic-ai/sdk";
import {
  AI_REQUEST_TIMEOUT_MS,
  ANTHROPIC_MAX_TOKENS,
  DEFAULT_ANTHROPIC_MODEL,
} from "../config/constants.js";
import type { Logger } from "../utils/logger.js";
import type { AIProvider, GenerateReplyParams, GenerateReplyResult, ToolInvocation } from "./provider.js";

const MAX_TOOL_TURNS = 5;

/** 空応答の原因追跡用に、応答の形だけをログできる形へ要約する（本文は含めない） */
function describeResponse(response: Anthropic.Message): string {
  const blockTypes = response.content.map((block) => block.type).join(",") || "none";
  const outputTokens = response.usage?.output_tokens ?? "unknown";
  return `stop_reason=${response.stop_reason ?? "null"}, blocks=[${blockTypes}], outputTokens=${outputTokens}`;
}

export function createAnthropicProvider(
  apiKey: string,
  model?: string,
  clientOverride?: Anthropic,
  logger?: Logger,
): AIProvider {
  const client = clientOverride ?? new Anthropic({ apiKey });
  const resolvedModel = model && model.length > 0 ? model : DEFAULT_ANTHROPIC_MODEL;

  return {
    name: "anthropic",
    async generateReply({ systemPrompt, messages, tools, executeTool }: GenerateReplyParams): Promise<GenerateReplyResult> {
      const anthropicTools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      }));

      const conversation: Anthropic.MessageParam[] = messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));

      const toolInvocations: ToolInvocation[] = [];
      let finalText = "";
      let lastResponseSummary = "（応答なし）";

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const response = await client.messages.create(
          {
            model: resolvedModel,
            max_tokens: ANTHROPIC_MAX_TOKENS,
            system: systemPrompt,
            messages: conversation,
            tools: anthropicTools.length > 0 ? anthropicTools : undefined,
          },
          { timeout: AI_REQUEST_TIMEOUT_MS },
        );
        lastResponseSummary = describeResponse(response);

        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === "text",
        );
        finalText = textBlocks.map((block) => block.text).join("\n").trim();

        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
        );

        // 出力トークン上限での打ち切りは、tool_useの入力が途中で切れて実行できないまま
        // 本文も空になる（＝無言）ため、原因が分かる形で必ず記録する。
        if (response.stop_reason === "max_tokens") {
          logger?.warn(
            `[anthropic] 出力トークン上限で応答が打ち切られた（turn=${turn + 1}, ${lastResponseSummary}）`,
          );
        }

        if (toolUseBlocks.length === 0 || response.stop_reason !== "tool_use") {
          break;
        }

        conversation.push({ role: "assistant", content: response.content });

        const toolResultContent: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
          const input = (block.input ?? {}) as Record<string, unknown>;
          const result = await executeTool(block.name, input);
          toolInvocations.push({ name: block.name, input, result });
          toolResultContent.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
        conversation.push({ role: "user", content: toolResultContent });
      }

      // 締めのテキストが空のままループを抜けた場合（ツールターン上限で打ち切られた、
      // 出力トークン上限でtool_useが途中で切れた、または最終応答が空テキストのみだった場合）、
      // そのまま返すと呼び出し側で「無言の正常終了」となり返信が送られない（実際に一対一
      // チャットで返信が来ない不具合の原因になった）。ツール呼び出しを禁じた追加リクエストを
      // 1回だけ行い、締めの一言を必ず生成する。
      //
      // ツール未実行（toolInvocations=0）のケースも対象に含める。出力トークン上限で
      // tool_useの入力生成が途中で切れると、ツールが1件も実行されないまま本文も空になり、
      // 以前の実装ではここを素通りして定型のフォールバック文しか返せなかったため。
      if (finalText.length === 0) {
        logger?.warn(
          `[anthropic] 応答本文が空のため、ツール無効で再生成する（${lastResponseSummary}, toolInvocations=${toolInvocations.length}）`,
        );
        const wrapUp = await client.messages.create(
          {
            model: resolvedModel,
            max_tokens: ANTHROPIC_MAX_TOKENS,
            system: systemPrompt,
            messages: conversation,
            // 履歴にtool_use/tool_resultブロックが含まれるためtools自体は渡す必要があるが、
            // これ以上のツール呼び出しはさせず、テキスト生成に専念させる
            tools: anthropicTools.length > 0 ? anthropicTools : undefined,
            tool_choice: anthropicTools.length > 0 ? { type: "none" } : undefined,
          },
          { timeout: AI_REQUEST_TIMEOUT_MS },
        );
        finalText = wrapUp.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim();

        if (finalText.length === 0) {
          // ここまで来たらpipeline側の定型フォールバックに委ねるしかないが、
          // 「なぜ空だったか」だけは必ず残す（本番でstop_reasonが分からず切り分けに難儀したため）。
          logger?.warn(`[anthropic] 再生成でも本文が得られなかった（${describeResponse(wrapUp)}）`);
        }
      }

      return { text: finalText, toolInvocations };
    },
  };
}
