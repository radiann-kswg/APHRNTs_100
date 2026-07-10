import { describe, expect, it } from "vitest";
import type { AIProvider } from "../../src/ai/provider.js";
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

function staticProvider(text: string): AIProvider {
  return {
    name: "anthropic",
    generateReply: async () => ({ text, toolInvocations: [] }),
  };
}

describe("pipeline rate limit exemption", () => {
  it("keeps replying through an ongoing conversation even with a several-minute pause between turns", async () => {
    const db = openDatabase(":memory:");
    const sessionStore = new SessionStore(db);
    const checkinStore = new CheckinStore(db);
    const thoughtRecordStore = new ThoughtRecordStore(db);
    const gratitudeStore = new GratitudeStore(db);
    const activationStore = new BehavioralActivationStore(db);
    const medicationStore = new MedicationStore(db);
    const rateLimitStore = new RateLimitStore(db);
    const safetyIncidentStore = new SafetyIncidentStore(db);
    const rateLimiter = new RateLimiter(rateLimitStore, 30 * 60 * 1000, 100);

    let now = new Date("2026-01-01T10:00:00Z");
    const handleMessage = createMessagePipeline({
      aiProvider: staticProvider("了解した"),
      systemPrompt: "test",
      sessionStore,
      rateLimiter,
      safetyIncidentStore,
      toolHandlerDeps: { checkinStore, thoughtRecordStore, gratitudeStore, activationStore, medicationStore },
      now: () => now,
    });

    const first = await handleMessage("user1", "こんにちは", "misskey");
    expect(first.suppressed).toBe(false);

    // 1分後の会話継続は除外扱いになる
    now = new Date(now.getTime() + 60 * 1000);
    const second = await handleMessage("user1", "続きだけど", "misskey");
    expect(second.suppressed).toBe(false);

    // さらに10分後（考えて長めの返信をする間の自然な間隔）でも、
    // クールダウン期間内である限り会話継続として扱われ、黙って無視されない
    now = new Date(now.getTime() + 10 * 60 * 1000);
    const third = await handleMessage("user1", "また来た", "misskey");
    expect(third.suppressed).toBe(false);
  });
});
