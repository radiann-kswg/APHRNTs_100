import { describe, expect, it, vi } from "vitest";
import type { AIProvider } from "../../src/ai/provider.js";
import { createMessagePipeline } from "../../src/bot/pipeline.js";
import { RateLimiter } from "../../src/bot/ratelimit/index.js";
import { BehavioralActivationStore } from "../../src/storage/behavioral-activation-store.js";
import { CheckinStore } from "../../src/storage/checkin-store.js";
import { openDatabase } from "../../src/storage/db.js";
import { GratitudeStore } from "../../src/storage/gratitude-store.js";
import { RateLimitStore } from "../../src/storage/rate-limit-store.js";
import { SafetyIncidentStore } from "../../src/storage/safety-incident-store.js";
import { SessionStore } from "../../src/storage/session-store.js";
import { ThoughtRecordStore } from "../../src/storage/thought-record-store.js";

describe("pipeline crisis short-circuit", () => {
  it("returns the deterministic crisis response without calling the AI provider or consuming the rate limit", async () => {
    const db = openDatabase(":memory:");
    const sessionStore = new SessionStore(db);
    const checkinStore = new CheckinStore(db);
    const thoughtRecordStore = new ThoughtRecordStore(db);
    const gratitudeStore = new GratitudeStore(db);
    const activationStore = new BehavioralActivationStore(db);
    const rateLimitStore = new RateLimitStore(db);
    const safetyIncidentStore = new SafetyIncidentStore(db);
    const rateLimiter = new RateLimiter(rateLimitStore, 30 * 60 * 1000, 1);

    const generateReply = vi.fn();
    const aiProvider: AIProvider = { name: "anthropic", generateReply };

    const handleMessage = createMessagePipeline({
      aiProvider,
      systemPrompt: "test",
      sessionStore,
      rateLimiter,
      safetyIncidentStore,
      toolHandlerDeps: { checkinStore, thoughtRecordStore, gratitudeStore, activationStore },
      now: () => new Date("2026-01-01T10:00:00Z"),
    });

    const result = await handleMessage("user1", "もう死にたい", "misskey");

    expect(result.suppressed).toBe(false);
    expect(result.replyText).toContain("0120-279-338");
    expect(generateReply).not.toHaveBeenCalled();

    // レートリミットは消費されていないため、直後の通常メッセージも許可される
    const nextDecision = rateLimiter.check("user1", null, new Date("2026-01-01T10:00:01Z"));
    expect(nextDecision.allowed).toBe(true);

    const incidentRow = db.prepare("SELECT * FROM safety_incidents WHERE user_id = ?").get("user1") as
      | { channel: string }
      | undefined;
    expect(incidentRow?.channel).toBe("misskey");
  });
});
