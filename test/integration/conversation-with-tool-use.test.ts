import { describe, expect, it } from "vitest";
import type { AIProvider, GenerateReplyParams, GenerateReplyResult } from "../../src/ai/provider.js";
import { createMessagePipeline } from "../../src/bot/pipeline.js";
import { RateLimiter } from "../../src/bot/ratelimit/index.js";
import { BehavioralActivationStore } from "../../src/storage/behavioral-activation-store.js";
import { CheckinStore } from "../../src/storage/checkin-store.js";
import { openDatabase } from "../../src/storage/db.js";
import { GratitudeStore } from "../../src/storage/gratitude-store.js";
import { MedicationStore } from "../../src/storage/medication-store.js";
import { RateLimitStore } from "../../src/storage/rate-limit-store.js";
import { SafetyIncidentStore } from "../../src/storage/safety-incident-store.js";
import { SessionStore } from "../../src/storage/session-store.js";
import { ThoughtRecordStore } from "../../src/storage/thought-record-store.js";

function scriptedProvider(script: (params: GenerateReplyParams) => Promise<GenerateReplyResult>): AIProvider {
  return { name: "anthropic", generateReply: script };
}

describe("pipeline with tool use", () => {
  it("persists a checkin when the model calls save_checkin mid-conversation", async () => {
    const db = openDatabase(":memory:");
    const sessionStore = new SessionStore(db);
    const checkinStore = new CheckinStore(db);
    const thoughtRecordStore = new ThoughtRecordStore(db);
    const gratitudeStore = new GratitudeStore(db);
    const activationStore = new BehavioralActivationStore(db);
    const medicationStore = new MedicationStore(db);
    const rateLimitStore = new RateLimitStore(db);
    const safetyIncidentStore = new SafetyIncidentStore(db);
    const rateLimiter = new RateLimiter(rateLimitStore, 0, 100);

    const aiProvider = scriptedProvider(async ({ executeTool }) => {
      const toolResult = await executeTool("save_checkin", { date: "2026-01-01", mood: 8 });
      return {
        text: `保存したぞ: ${toolResult}`,
        toolInvocations: [{ name: "save_checkin", input: { date: "2026-01-01", mood: 8 }, result: toolResult }],
      };
    });

    const handleMessage = createMessagePipeline({
      aiProvider,
      systemPrompt: "test",
      sessionStore,
      rateLimiter,
      safetyIncidentStore,
      toolHandlerDeps: { checkinStore, thoughtRecordStore, gratitudeStore, activationStore, medicationStore },
      now: () => new Date("2026-01-01T10:00:00Z"),
    });

    const result = await handleMessage("user1", "今日の気分は8で記録して", "cli");

    expect(result.suppressed).toBe(false);
    expect(result.replyText).toContain("保存したぞ");

    const rows = checkinStore.listSince("user1", "2026-01-01");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mood).toBe(8);

    const history = sessionStore.getHistory("user1", new Date("2026-01-01T10:00:00Z"));
    expect(history).toHaveLength(2);
    expect(history[1]).toEqual({ role: "assistant", content: result.replyText });
  });
});
