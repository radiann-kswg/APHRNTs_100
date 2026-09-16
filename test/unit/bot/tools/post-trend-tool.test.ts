import { describe, expect, it } from "vitest";
import {
  ALL_TOOLS,
  GET_POST_TREND_TOOL,
  SET_POST_ANALYSIS_PREFERENCE_TOOL,
} from "../../../../src/bot/tools/definitions.js";
import { createToolExecutor } from "../../../../src/bot/tools/handlers.js";
import { BehavioralActivationStore } from "../../../../src/storage/behavioral-activation-store.js";
import { BotStateStore } from "../../../../src/storage/bot-state-store.js";
import { CheckinStore } from "../../../../src/storage/checkin-store.js";
import { openDatabase } from "../../../../src/storage/db.js";
import { GratitudeStore } from "../../../../src/storage/gratitude-store.js";
import { MedicationStore } from "../../../../src/storage/medication-store.js";
import { MoodEventStore } from "../../../../src/storage/mood-event-store.js";
import { PostMetricStore, postAnalysisCursorKey } from "../../../../src/storage/post-metric-store.js";
import { ThoughtRecordStore } from "../../../../src/storage/thought-record-store.js";
import { UserPreferenceStore } from "../../../../src/storage/user-preference-store.js";

const NOW = new Date("2026-09-16T12:00:00Z");

function setup() {
  const db = openDatabase(":memory:");
  const userPreferenceStore = new UserPreferenceStore(db);
  const postMetricStore = new PostMetricStore(db);
  const botStateStore = new BotStateStore(db);
  const executeTool = createToolExecutor(
    "user1",
    {
      checkinStore: new CheckinStore(db),
      thoughtRecordStore: new ThoughtRecordStore(db),
      gratitudeStore: new GratitudeStore(db),
      activationStore: new BehavioralActivationStore(db),
      medicationStore: new MedicationStore(db),
      moodEventStore: new MoodEventStore(db),
      userPreferenceStore,
      postMetricStore,
      botStateStore,
    },
    () => NOW,
  );
  return { db, userPreferenceStore, postMetricStore, botStateStore, executeTool };
}

function addDay(store: PostMetricStore, date: string, postCount: number): void {
  store.addDaily("user1", {
    date,
    postCount,
    replyCount: 0,
    nightPostCount: 1,
    firstPostAt: `${date}T00:00:00.000Z`,
    lastPostAt: `${date}T10:00:00.000Z`,
    totalChars: postCount * 20,
    cwCount: 0,
    attachmentPostCount: 0,
    maxBurstPerHour: 1,
  });
}

describe("post trend tools", () => {
  it("are registered in ALL_TOOLS", () => {
    expect(ALL_TOOLS).toContain(GET_POST_TREND_TOOL);
    expect(ALL_TOOLS).toContain(SET_POST_ANALYSIS_PREFERENCE_TOOL);
  });

  it("tells the model to use get_post_trend only when asked", () => {
    expect(GET_POST_TREND_TOOL.description).toContain("聞かれたときだけ");
    expect(GET_POST_TREND_TOOL.description).toContain("話題を切り出してはならない");
  });

  it("returns the opt-in notice instead of numbers while the preference is off", async () => {
    const { postMetricStore, executeTool } = setup();
    addDay(postMetricStore, "2026-09-16", 4);

    const reply = await executeTool("get_post_trend", {});
    expect(reply).toContain("オフになってる");
    expect(reply).not.toContain("合計4件");
  });

  it("returns the trend once the user opted in", async () => {
    const { postMetricStore, executeTool } = setup();
    await executeTool("set_post_analysis_preference", { enabled: true });
    addDay(postMetricStore, "2026-09-15", 3);
    addDay(postMetricStore, "2026-09-16", 4);

    const reply = await executeTool("get_post_trend", { days: 7 });
    expect(reply).toContain("直近7日（2026-09-10〜2026-09-16, JST）");
    expect(reply).toContain("合計7件");
  });

  it("clamps the requested window to 30 days", async () => {
    const { executeTool } = setup();
    await executeTool("set_post_analysis_preference", { enabled: true });
    const reply = await executeTool("get_post_trend", { days: 999 });
    expect(reply).toContain("直近30日（2026-08-18〜2026-09-16, JST）");
  });

  it("deletes the stored metrics and the cursor when switched off", async () => {
    const { postMetricStore, botStateStore, userPreferenceStore, executeTool } = setup();
    await executeTool("set_post_analysis_preference", { enabled: true });
    addDay(postMetricStore, "2026-09-15", 3);
    addDay(postMetricStore, "2026-09-16", 4);
    botStateStore.set(postAnalysisCursorKey("user1"), "note-123");

    const reply = await executeTool("set_post_analysis_preference", { enabled: false });

    expect(reply).toContain("無効");
    expect(reply).toContain("2日分");
    expect(userPreferenceStore.isPostAnalysisEnabled("user1")).toBe(false);
    expect(postMetricStore.listSince("user1", "2000-01-01")).toEqual([]);
    expect(botStateStore.get(postAnalysisCursorKey("user1"))).toBeNull();
  });

  it("leaves the crisis hotline preference untouched when toggling post analysis", async () => {
    const { userPreferenceStore, executeTool } = setup();
    await executeTool("set_crisis_hotline_preference", { enabled: false });
    await executeTool("set_post_analysis_preference", { enabled: true });

    expect(userPreferenceStore.isCrisisHotlineEnabled("user1")).toBe(false);
    expect(userPreferenceStore.isPostAnalysisEnabled("user1")).toBe(true);
  });
});

describe("post trend tools for a non-owner user", () => {
  it("never claims the feature was enabled for a user whose posts are not collected", async () => {
    const db = openDatabase(":memory:");
    const userPreferenceStore = new UserPreferenceStore(db);
    const postMetricStore = new PostMetricStore(db);
    const executeTool = createToolExecutor(
      "stranger",
      {
        checkinStore: new CheckinStore(db),
        thoughtRecordStore: new ThoughtRecordStore(db),
        gratitudeStore: new GratitudeStore(db),
        activationStore: new BehavioralActivationStore(db),
        medicationStore: new MedicationStore(db),
        moodEventStore: new MoodEventStore(db),
        userPreferenceStore,
        postMetricStore,
        botStateStore: new BotStateStore(db),
        postAnalysisOwnerUserId: "user1",
      },
      () => NOW,
    );

    expect(await executeTool("set_post_analysis_preference", { enabled: true })).toContain("扱えない");
    expect(await executeTool("get_post_trend", {})).toContain("扱えない");
    expect(userPreferenceStore.isPostAnalysisEnabled("stranger")).toBe(false);
  });
});
