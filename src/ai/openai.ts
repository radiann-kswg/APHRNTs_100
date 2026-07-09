import OpenAI from "openai";
import { DEFAULT_OPENAI_MODEL } from "../config/constants.js";
import type { AIProvider, GenerateReplyParams, GenerateReplyResult, ToolInvocation } from "./provider.js";

const MAX_TOOL_TURNS = 5;

export function createOpenAIProvider(apiKey: string, model?: string): AIProvider {
  const client = new OpenAI({ apiKey });
  const resolvedModel = model && model.length > 0 ? model : DEFAULT_OPENAI_MODEL;

  return {
    name: "openai",
    async generateReply({ systemPrompt, messages, tools, executeTool }: GenerateReplyParams): Promise<GenerateReplyResult> {
      const openaiTools = tools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));

      const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...messages.map(
          (message): OpenAI.Chat.ChatCompletionMessageParam => ({
            role: message.role,
            content: message.content,
          }),
        ),
      ];

      const toolInvocations: ToolInvocation[] = [];
      let finalText = "";

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const response = await client.chat.completions.create({
          model: resolvedModel,
          messages: conversation,
          tools: openaiTools.length > 0 ? openaiTools : undefined,
        });

        const message = response.choices[0]?.message;
        if (!message) break;
        finalText = message.content ?? "";

        const toolCalls = message.tool_calls ?? [];
        if (toolCalls.length === 0) {
          break;
        }

        conversation.push(message);

        for (const call of toolCalls) {
          if (call.type !== "function") continue;
          const input = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
          const result = await executeTool(call.function.name, input);
          toolInvocations.push({ name: call.function.name, input, result });
          conversation.push({
            role: "tool",
            tool_call_id: call.id,
            content: result,
          });
        }
      }

      return { text: finalText, toolInvocations };
    },
  };
}
