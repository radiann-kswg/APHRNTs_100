import { describe, expect, it, vi } from "vitest";
import type { AIProvider, GenerateReplyResult } from "../../src/ai/provider.js";
import { createMessagePipeline } from "../../src/bot/pipeline.js";
import { RateLimiter } from "../../src/bot/ratelimit/index.js";
import { SAFETY_HOTLINES } from "../../src/bot/character/safety-policy.js";
import { BehavioralActivationStore } from "../../src/storage/behavioral-activation-store.js";
import { CheckinStore } from "../../src/storage/checkin-store.js";
import { openDatabase } from "../../src/storage/db.js";
import { GratitudeStore } from "../../src/storage/gratitude-store.js";
import { MedicationStore } from "../../src/storage/medication-store.js";
import { MoodEventStore } from "../../src/storage/mood-event-store.js";
import { RateLimitStore } from "../../src/storage/rate-limit-store.js";
import { SafetyIncidentStore } from "../../src/storage/safety-incident-store.js";
import { SessionStore } from "../../src/storage/session-store.js";
import { ThoughtRecordStore } from "../../src/storage/thought-record-store.js";
import { UserPreferenceStore } from "../../src/storage/user-preference-store.js";

function setup(generateReply: AIProvider["generateReply"]) {
  const db = openDatabase(":memory:");
  const sessionStore = new SessionStore(db);
  const rateLimitStore = new RateLimitStore(db);
  const safetyIncidentStore = new SafetyIncidentStore(db);
  const userPreferenceStore = new UserPreferenceStore(db);
  const rateLimiter = new RateLimiter(rateLimitStore, 30 * 60 * 1000, 1);
  const toolHandlerDeps = {
    checkinStore: new CheckinStore(db),
    thoughtRecordStore: new ThoughtRecordStore(db),
    gratitudeStore: new GratitudeStore(db),
    activationStore: new BehavioralActivationStore(db),
    medicationStore: new MedicationStore(db),
    moodEventStore: new MoodEventStore(db),
    userPreferenceStore,
  };
  const handleMessage = createMessagePipeline({
    aiProvider: { name: "anthropic", generateReply },
    systemPrompt: "BASE_PROMPT",
    sessionStore,
    rateLimiter,
    safetyIncidentStore,
    userPreferenceStore,
    toolHandlerDeps,
    now: () => new Date("2026-09-11T10:00:00Z"),
  });
  return { db, handleMessage, userPreferenceStore, rateLimiter, rateLimitStore };
}

const llmReply: GenerateReplyResult = { text: "センパイ、まずは話を聞かせてくれ。", toolInvocations: [] };

describe("crisis handling with per-user hotline preference", () => {
  it("keeps the deterministic hotline short-circuit for users with the default (enabled) preference", async () => {
    const generateReply = vi.fn().mockResolvedValue(llmReply);
    const { handleMessage } = setup(generateReply);

    const result = await handleMessage("user1", "もう死にたい", "misskey-chat");

    expect(result.replyText).toContain(SAFETY_HOTLINES.yorisoi);
    expect(result.replyText).toContain("オフにして");
    expect(generateReply).not.toHaveBeenCalled();
  });

  it("routes to the LLM in listening mode when the user disabled hotline guidance", async () => {
    const generateReply = vi.fn().mockResolvedValue(llmReply);
    const { db, handleMessage, userPreferenceStore } = setup(generateReply);
    userPreferenceStore.setCrisisHotlineEnabled("user1", false);

    const result = await handleMessage("user1", "もう死にたい", "misskey-chat");

    expect(result.suppressed).toBe(false);
    expect(result.replyText).toBe(llmReply.text);
    expect(result.replyText).not.toContain(SAFETY_HOTLINES.yorisoi);
    expect(generateReply).toHaveBeenCalledTimes(1);

    const systemPrompt = generateReply.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt.startsWith("BASE_PROMPT")).toBe(true);
    expect(systemPrompt).toContain("危機対応モード（傾聴・相談優先）");
    expect(systemPrompt).toContain("死にたい");

    // インシデントは設定によらず必ず記録される
    const incidentRow = db.prepare("SELECT matched_terms FROM safety_incidents WHERE user_id = ?").get("user1") as
      | { matched_terms: string }
      | undefined;
    expect(incidentRow?.matched_terms).toBe(JSON.stringify(["死にたい"]));
  });

  it("does not let the rate limit suppress a listening-mode crisis reply", async () => {
    const generateReply = vi.fn().mockResolvedValue(llmReply);
    const { handleMessage, userPreferenceStore, rateLimitStore } = setup(generateReply);
    userPreferenceStore.setCrisisHotlineEnabled("user1", false);
    // 直前に返信済み（クールダウン中）にしておく
    rateLimitStore.recordReply("user1", new Date("2026-09-11T09:59:00Z"));

    const result = await handleMessage("user1", "消えたい", "misskey");

    expect(result.suppressed).toBe(false);
    expect(generateReply).toHaveBeenCalledTimes(1);
  });

  it("does not inject listening mode into ordinary (non-crisis) messages for a disabled user", async () => {
    const generateReply = vi.fn().mockResolvedValue(llmReply);
    const { handleMessage, userPreferenceStore } = setup(generateReply);
    userPreferenceStore.setCrisisHotlineEnabled("user1", false);

    await handleMessage("user1", "今日はちょっと疲れた", "misskey-chat");

    const systemPrompt = generateReply.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toBe("BASE_PROMPT");
  });
});
