import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicProvider } from "../../../src/ai/anthropic.js";
import type { ToolDefinition } from "../../../src/ai/provider.js";

const TOOLS: ToolDefinition[] = [
  {
    name: "save_checkin",
    description: "チェックインを保存する",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
  },
];

interface CreateCall {
  params: Record<string, unknown>;
}

/**
 * Anthropicクライアントのmessages.createをスクリプト応答で差し替えるフェイク。
 * 呼び出しパラメータを記録し、responsesを順番に返す。
 */
function fakeAnthropicClient(responses: Array<Record<string, unknown>>): {
  client: Anthropic;
  calls: CreateCall[];
} {
  const calls: CreateCall[] = [];
  let index = 0;
  const client = {
    messages: {
      create: (params: Record<string, unknown>) => {
        calls.push({ params });
        const response = responses[index];
        if (!response) throw new Error(`スクリプトされた応答が足りない（呼び出し${index + 1}回目）`);
        index += 1;
        return Promise.resolve(response);
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

function toolUseResponse(id: string, name: string): Record<string, unknown> {
  return {
    content: [{ type: "tool_use", id, name, input: {} }],
    stop_reason: "tool_use",
  };
}

describe("createAnthropicProvider", () => {
  it("最終応答が空テキストの場合、ツール無効の追加リクエストで締めの一言を生成する", async () => {
    const { client, calls } = fakeAnthropicClient([
      // 1回目: ツール呼び出しのみ（テキストなし）
      toolUseResponse("tu_1", "save_checkin"),
      // 2回目: end_turnだがテキストが空（無言の正常終了になり得るケース）
      { content: [], stop_reason: "end_turn" },
      // 3回目: 締めの追加リクエストへの応答
      { content: [{ type: "text", text: "記録したぞ、センパイ。" }], stop_reason: "end_turn" },
    ]);
    const provider = createAnthropicProvider("test-key", undefined, client);

    const result = await provider.generateReply({
      systemPrompt: "test",
      messages: [{ role: "user", content: "気分4、頓服飲んだ" }],
      tools: TOOLS,
      executeTool: async () => "saved",
    });

    expect(result.text).toBe("記録したぞ、センパイ。");
    expect(result.toolInvocations).toHaveLength(1);
    expect(calls).toHaveLength(3);
    // 締めのリクエストはツール呼び出しを禁止していること
    expect(calls[2]?.params["tool_choice"]).toEqual({ type: "none" });
  });

  it("ツールターン上限まで打ち切られた場合も締めの一言を生成する", async () => {
    const { client, calls } = fakeAnthropicClient([
      toolUseResponse("tu_1", "save_checkin"),
      toolUseResponse("tu_2", "save_checkin"),
      toolUseResponse("tu_3", "save_checkin"),
      toolUseResponse("tu_4", "save_checkin"),
      toolUseResponse("tu_5", "save_checkin"),
      // 上限到達後の締めリクエストへの応答
      { content: [{ type: "text", text: "全部記録した。" }], stop_reason: "end_turn" },
    ]);
    const provider = createAnthropicProvider("test-key", undefined, client);

    const result = await provider.generateReply({
      systemPrompt: "test",
      messages: [{ role: "user", content: "今日の記録を全部頼む" }],
      tools: TOOLS,
      executeTool: async () => "saved",
    });

    expect(result.text).toBe("全部記録した。");
    expect(result.toolInvocations).toHaveLength(5);
    expect(calls).toHaveLength(6);
  });

  it("通常応答（テキストあり）では追加リクエストを行わない", async () => {
    const { client, calls } = fakeAnthropicClient([
      { content: [{ type: "text", text: "おう、センパイ。" }], stop_reason: "end_turn" },
    ]);
    const provider = createAnthropicProvider("test-key", undefined, client);

    const result = await provider.generateReply({
      systemPrompt: "test",
      messages: [{ role: "user", content: "やあ" }],
      tools: TOOLS,
      executeTool: async () => "unused",
    });

    expect(result.text).toBe("おう、センパイ。");
    expect(calls).toHaveLength(1);
  });

  it("ツール未実行で空応答の場合は追加リクエストせず空のまま返す（pipeline側のフォールバックに委ねる）", async () => {
    const { client, calls } = fakeAnthropicClient([{ content: [], stop_reason: "end_turn" }]);
    const provider = createAnthropicProvider("test-key", undefined, client);

    const result = await provider.generateReply({
      systemPrompt: "test",
      messages: [{ role: "user", content: "やあ" }],
      tools: TOOLS,
      executeTool: async () => "unused",
    });

    expect(result.text).toBe("");
    expect(calls).toHaveLength(1);
  });
});
