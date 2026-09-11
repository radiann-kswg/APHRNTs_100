import { describe, expect, it } from "vitest";
import { createToolExecutor } from "../../../../src/bot/tools/handlers.js";
import { ALL_TOOLS, SET_CRISIS_HOTLINE_PREFERENCE_TOOL } from "../../../../src/bot/tools/definitions.js";
import { BehavioralActivationStore } from "../../../../src/storage/behavioral-activation-store.js";
import { CheckinStore } from "../../../../src/storage/checkin-store.js";
import { openDatabase } from "../../../../src/storage/db.js";
import { GratitudeStore } from "../../../../src/storage/gratitude-store.js";
import { MedicationStore } from "../../../../src/storage/medication-store.js";
import { MoodEventStore } from "../../../../src/storage/mood-event-store.js";
import { ThoughtRecordStore } from "../../../../src/storage/thought-record-store.js";
import { UserPreferenceStore } from "../../../../src/storage/user-preference-store.js";

function baseDeps(db: ReturnType<typeof openDatabase>) {
  return {
    checkinStore: new CheckinStore(db),
    thoughtRecordStore: new ThoughtRecordStore(db),
    gratitudeStore: new GratitudeStore(db),
    activationStore: new BehavioralActivationStore(db),
    medicationStore: new MedicationStore(db),
    moodEventStore: new MoodEventStore(db),
  };
}

describe("set_crisis_hotline_preference tool", () => {
  it("is registered in ALL_TOOLS", () => {
    expect(ALL_TOOLS).toContain(SET_CRISIS_HOTLINE_PREFERENCE_TOOL);
  });

  it("disables and re-enables the per-user hotline preference", async () => {
    const db = openDatabase(":memory:");
    const userPreferenceStore = new UserPreferenceStore(db);
    const executeTool = createToolExecutor("user1", { ...baseDeps(db), userPreferenceStore });

    const offReply = await executeTool("set_crisis_hotline_preference", { enabled: false });
    expect(offReply).toContain("無効");
    expect(userPreferenceStore.isCrisisHotlineEnabled("user1")).toBe(false);

    const onReply = await executeTool("set_crisis_hotline_preference", { enabled: true });
    expect(onReply).toContain("有効");
    expect(userPreferenceStore.isCrisisHotlineEnabled("user1")).toBe(true);
  });

  it("rejects a call without a boolean and does not touch the store", async () => {
    const db = openDatabase(":memory:");
    const userPreferenceStore = new UserPreferenceStore(db);
    const executeTool = createToolExecutor("user1", { ...baseDeps(db), userPreferenceStore });

    const reply = await executeTool("set_crisis_hotline_preference", { enabled: "no" });
    expect(reply).toContain("読み取れなかった");
    expect(userPreferenceStore.isCrisisHotlineEnabled("user1")).toBe(true);
  });

  it("reports unsupported when no preference store is wired", async () => {
    const db = openDatabase(":memory:");
    const executeTool = createToolExecutor("user1", baseDeps(db));
    const reply = await executeTool("set_crisis_hotline_preference", { enabled: false });
    expect(reply).toContain("保存できない");
  });
});
