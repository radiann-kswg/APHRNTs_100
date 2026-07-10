import Anthropic from "@anthropic-ai/sdk";
import { AI_REQUEST_TIMEOUT_MS, DEFAULT_ANTHROPIC_MODEL } from "../config/constants.js";
import type { AIProvider, GenerateReplyParams, GenerateReplyResult, ToolInvocation } from "./provider.js";

const MAX_TOOL_TURNS = 5;
const MAX_TOKENS = 1024;

export function createAnthropicProvider(apiKey: string, model?: string): AIProvider {
  const client = new Anthropic({ apiKey });
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

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const response = await client.messages.create(
          {
            model: resolvedModel,
            max_tokens: MAX_TOKENS,
            system: systemPrompt,
            messages: conversation,
            tools: anthropicTools.length > 0 ? anthropicTools : undefined,
          },
          { timeout: AI_REQUEST_TIMEOUT_MS },
        );

        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === "text",
        );
        finalText = textBlocks.map((block) => block.text).join("\n").trim();

        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
        );

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

      return { text: finalText, toolInvocations };
    },
  };
}
