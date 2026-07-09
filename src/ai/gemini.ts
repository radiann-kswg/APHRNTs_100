import { GoogleGenerativeAI, type Content, type FunctionDeclaration } from "@google/generative-ai";
import { DEFAULT_GEMINI_MODEL } from "../config/constants.js";
import type { AIProvider, GenerateReplyParams, GenerateReplyResult, ToolInvocation } from "./provider.js";

const MAX_TOOL_TURNS = 5;

export function createGeminiProvider(apiKey: string, model?: string): AIProvider {
  const client = new GoogleGenerativeAI(apiKey);
  const resolvedModel = model && model.length > 0 ? model : DEFAULT_GEMINI_MODEL;

  return {
    name: "gemini",
    async generateReply({ systemPrompt, messages, tools, executeTool }: GenerateReplyParams): Promise<GenerateReplyResult> {
      const functionDeclarations: FunctionDeclaration[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parameters: tool.inputSchema as any,
      }));

      const generativeModel = client.getGenerativeModel({
        model: resolvedModel,
        systemInstruction: systemPrompt,
        tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
      });

      const history: Content[] = messages.slice(0, -1).map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));
      const lastMessage = messages[messages.length - 1];

      const chat = generativeModel.startChat({ history });
      let result = await chat.sendMessage(lastMessage?.content ?? "");

      const toolInvocations: ToolInvocation[] = [];
      let finalText = "";

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const calls = result.response.functionCalls() ?? [];
        finalText = result.response.text();

        if (calls.length === 0) break;

        const responses = [];
        for (const call of calls) {
          const input = (call.args ?? {}) as Record<string, unknown>;
          const toolResult = await executeTool(call.name, input);
          toolInvocations.push({ name: call.name, input, result: toolResult });
          responses.push({
            functionResponse: { name: call.name, response: { result: toolResult } },
          });
        }

        result = await chat.sendMessage(responses);
      }

      return { text: finalText, toolInvocations };
    },
  };
}
