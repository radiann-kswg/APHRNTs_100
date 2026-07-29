import { describe, expect, it } from "vitest";
import type { AIProvider, GenerateReplyResult } from "../../../src/ai/provider.js";
import { createMessagePipeline, type PipelineLogger } from "../../../src/bot/pipeline.js";
import { RateLimiter } from "../../../src/bot/ratelimit/index.js";
import { BehavioralActivationStore } from "../../../src/storage/behavioral-activation-store.js";
import { CheckinStore } from "../../../src/storage/checkin-store.js";
import { openDatabase } from "../../../src/storage/db.js";
import { GratitudeStore } from "../../../src/storage/gratitude-store.js";
import { MedicationStore } from "../../../src/storage/medication-store.js";
import { MoodEventStore } from "../../../src/storage/mood-event-store.js";
import { RateLimitStore } from "../../../src/storage/rate-limit-store.js";
import { SafetyIncidentStore } from "../../../src/storage/safety-incident-store.js";
import { SessionStore } from "../../../src/storage/session-store.js";
import { ThoughtRecordStore } from "../../../src/storage/thought-record-store.js";

function fixedProvider(result: GenerateReplyResult): AIProvider {
  return { name: "anthropic", generateReply: () => Promise.resolve(result) };
}

function collectingLogger(): { logger: PipelineLogger; warns: string[]; infos: string[] } {
  const warns: string[] = [];
  const infos: string[] = [];
  return {
    logger: {
      warn: (message) => warns.push(message),
      info: (message) => infos.push(message),
    },
    warns,
    infos,
  };
}

function buildPipeline(aiProvider: AIProvider, logger?: PipelineLogger, cooldownMs = 0) {
  const db = openDatabase(":memory:");
  const sessionStore = new SessionStore(db);
  const rateLimitStore = new RateLimitStore(db);
  return {
    sessionStore,
    rateLimitStore,
    handleMessage: createMessagePipeline({
      aiProvider,
      systemPrompt: "test",
      sessionStore,
      rateLimiter: new RateLimiter(rateLimitStore, cooldownMs, 100),
      safetyIncidentStore: new SafetyIncidentStore(db),
      toolHandlerDeps: {
        checkinStore: new CheckinStore(db),
        thoughtRecordStore: new ThoughtRecordStore(db),
        gratitudeStore: new GratitudeStore(db),
        activationStore: new BehavioralActivationStore(db),
        medicationStore: new MedicationStore(db),
        moodEventStore: new MoodEventStore(db),
      },
      now: () => new Date("2026-01-01T10:00:00Z"),
      logger,
    }),
  };
}

describe("pipeline 空応答フォールバック", () => {
  it("ツール実行ありの空応答は記録完了のフォールバック文を返す（無言にならない）", async () => {
    const { logger, warns } = collectingLogger();
    const { handleMessage, sessionStore } = buildPipeline(
      fixedProvider({
        text: "",
        toolInvocations: [{ name: "save_checkin", input: {}, result: "saved" }],
      }),
      logger,
    );

    const result = await handleMessage("user1", "気分4、頓服飲んだ", "misskey-chat");

    expect(result.suppressed).toBe(false);
    expect(result.replyText.length).toBeGreaterThan(0);
    expect(result.replyText).toContain("記録は済ませた");
    expect(warns).toHaveLength(1);
    // フォールバック文が会話履歴にも残ること（次のターンの文脈が壊れない）
    const history = sessionStore.getHistory("user1", new Date("2026-01-01T10:00:00Z"));
    expect(history[1]).toEqual({ role: "assistant", content: result.replyText });
  });

  it("ツール実行なしの空応答は再送を促すフォールバック文を返す", async () => {
    const { logger, warns } = collectingLogger();
    const { handleMessage } = buildPipeline(fixedProvider({ text: "", toolInvocations: [] }), logger);

    const result = await handleMessage("user1", "やあ", "misskey-chat");

    expect(result.suppressed).toBe(false);
    expect(result.replyText).toContain("もう一度");
    expect(warns).toHaveLength(1);
  });

  it("通常応答ではフォールバックせず警告も出さない", async () => {
    const { logger, warns } = collectingLogger();
    const { handleMessage } = buildPipeline(
      fixedProvider({ text: "おう、センパイ。", toolInvocations: [] }),
      logger,
    );

    const result = await handleMessage("user1", "やあ", "misskey-chat");

    expect(result.replyText).toBe("おう、センパイ。");
    expect(warns).toHaveLength(0);
  });

  it("レートリミット抑制時は理由をinfoログに残す", async () => {
    const { logger, infos } = collectingLogger();
    // cooldownを長くし、直前の返信を記録して抑制状態を作る
    const { handleMessage, rateLimitStore } = buildPipeline(
      fixedProvider({ text: "おう。", toolInvocations: [] }),
      logger,
      30 * 60 * 1000,
    );
    rateLimitStore.recordReply("user1", new Date("2026-01-01T09:50:00Z"));

    const result = await handleMessage("user1", "やあ", "misskey-chat");

    expect(result.suppressed).toBe(true);
    expect(infos).toHaveLength(1);
    expect(infos[0]).toContain("cooldown");
  });
});
