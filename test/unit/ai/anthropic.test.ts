import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicProvider } from "../../../src/ai/anthropic.js";
import type { ToolDefinition } from "../../../src/ai/provider.js";
import { ANTHROPIC_MAX_TOKENS } from "../../../src/config/constants.js";
import type { Logger } from "../../../src/utils/logger.js";

/** warnに出た文言だけを集めるロガー（診断ログの内容を検証するため） */
function createRecordingLogger(warnings: string[]): Logger {
  return {
    error: () => {},
    warn: (message: string, ...args: unknown[]) => {
      warnings.push([message, ...args.map(String)].join(" "));
    },
    info: () => {},
    debug: () => {},
  };
}

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

  it("ツール未実行で空応答の場合もツール無効で再生成する", async () => {
    const { client, calls } = fakeAnthropicClient([
      { content: [], stop_reason: "end_turn" },
      { content: [{ type: "text", text: "おう、聞いてるぞ。" }], stop_reason: "end_turn" },
    ]);
    const provider = createAnthropicProvider("test-key", undefined, client);

    const result = await provider.generateReply({
      systemPrompt: "test",
      messages: [{ role: "user", content: "やあ" }],
      tools: TOOLS,
      executeTool: async () => "unused",
    });

    expect(result.text).toBe("おう、聞いてるぞ。");
    expect(result.toolInvocations).toHaveLength(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.params["tool_choice"]).toEqual({ type: "none" });
  });

  it("出力トークン上限でtool_useが切れた場合、再生成して本文を返しつつ警告を残す", async () => {
    const { client, calls } = fakeAnthropicClient([
      // 1回目: tool_useの入力生成中に上限へ達し、本文もツール実行結果も無い（本番で観測した形）
      { content: [{ type: "tool_use", id: "tu_1", name: "save_checkin", input: {} }], stop_reason: "max_tokens" },
      // 2回目: ツール無効の再生成
      { content: [{ type: "text", text: "すまん、続きを話すぞ。" }], stop_reason: "end_turn" },
    ]);
    const warnings: string[] = [];
    const logger = createRecordingLogger(warnings);
    const provider = createAnthropicProvider("test-key", undefined, client, logger);

    const result = await provider.generateReply({
      systemPrompt: "test",
      messages: [{ role: "user", content: "今日の記録を頼む（長文）" }],
      tools: TOOLS,
      executeTool: async () => "unused",
    });

    expect(result.text).toBe("すまん、続きを話すぞ。");
    expect(result.toolInvocations).toHaveLength(0);
    expect(calls).toHaveLength(2);
    expect(warnings.some((line) => line.includes("出力トークン上限"))).toBe(true);
    expect(warnings.some((line) => line.includes("stop_reason=max_tokens"))).toBe(true);
  });

  it("再生成でも本文が空なら、原因が分かる診断ログを残して空のまま返す", async () => {
    const { client } = fakeAnthropicClient([
      { content: [], stop_reason: "end_turn" },
      { content: [], stop_reason: "end_turn" },
    ]);
    const warnings: string[] = [];
    const logger = createRecordingLogger(warnings);
    const provider = createAnthropicProvider("test-key", undefined, client, logger);

    const result = await provider.generateReply({
      systemPrompt: "test",
      messages: [{ role: "user", content: "やあ" }],
      tools: TOOLS,
      executeTool: async () => "unused",
    });

    expect(result.text).toBe("");
    expect(warnings.some((line) => line.includes("再生成でも本文が得られなかった"))).toBe(true);
  });

  it("max_tokensには定数ANTHROPIC_MAX_TOKENSを使う", async () => {
    const { client, calls } = fakeAnthropicClient([
      { content: [{ type: "text", text: "おう。" }], stop_reason: "end_turn" },
    ]);
    const provider = createAnthropicProvider("test-key", undefined, client);

    await provider.generateReply({
      systemPrompt: "test",
      messages: [{ role: "user", content: "やあ" }],
      tools: TOOLS,
      executeTool: async () => "unused",
    });

    expect(calls[0]?.params["max_tokens"]).toBe(ANTHROPIC_MAX_TOKENS);
  });
});
