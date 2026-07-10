import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { MisskeyClient } from "../../../src/misskey/client.js";
import {
  buildTrendNudgeMessage,
  createTrendNudgeTask,
  detectTrend,
  type TrendSignal,
} from "../../../src/scheduler/trend-nudge-task.js";
import { BotStateStore } from "../../../src/storage/bot-state-store.js";
import { CheckinStore } from "../../../src/storage/checkin-store.js";
import { openDatabase } from "../../../src/storage/db.js";
import { MedicationStore } from "../../../src/storage/medication-store.js";
import { SessionStore } from "../../../src/storage/session-store.js";

function createFakeMisskeyClient(): { client: MisskeyClient; messages: { toUserId: string; text: string }[] } {
  const messages: { toUserId: string; text: string }[] = [];
  const client = {
    sendChatMessage: async (toUserId: string, text: string) => {
      messages.push({ toUserId, text });
    },
  } as unknown as MisskeyClient;
  return { client, messages };
}

describe("detectTrend", () => {
  it("does not trigger when there is no data at all", () => {
    const now = new Date("2026-01-15T00:00:00Z");
    const signal = detectTrend([], [], now);
    expect(signal.triggered).toBe(false);
    expect(signal.recentAvgMood).toBeNull();
    expect(signal.priorAvgMood).toBeNull();
    expect(signal.missedMedicationDays).toBe(0);
  });

  it("does not trigger on mood decline alone, without a medication gap", () => {
    const now = new Date("2026-01-15T00:00:00Z");
    const db = openDatabase(":memory:");
    const checkinStore = new CheckinStore(db);
    checkinStore.upsert({ userId: "u1", date: "2026-01-02", mood: 8 });
    checkinStore.upsert({ userId: "u1", date: "2026-01-03", mood: 8 });
    checkinStore.upsert({ userId: "u1", date: "2026-01-04", mood: 8 });
    checkinStore.upsert({ userId: "u1", date: "2026-01-09", mood: 4 });
    checkinStore.upsert({ userId: "u1", date: "2026-01-10", mood: 4 });
    checkinStore.upsert({ userId: "u1", date: "2026-01-11", mood: 4 });

    const signal = detectTrend(checkinStore.listSince("u1", "2026-01-01"), [], now);
    expect(signal.priorAvgMood).toBe(8);
    expect(signal.recentAvgMood).toBe(4);
    expect(signal.triggered).toBe(false);
  });

  it("does not trigger on a medication gap alone, without a mood decline", () => {
    const now = new Date("2026-01-15T00:00:00Z");
    const db = openDatabase(":memory:");
    const medicationStore = new MedicationStore(db);
    medicationStore.upsert({ userId: "u1", date: "2026-01-09", morningTaken: false });
    medicationStore.upsert({ userId: "u1", date: "2026-01-10", nightTaken: false });
    medicationStore.upsert({ userId: "u1", date: "2026-01-11", middayTaken: false });

    const signal = detectTrend([], medicationStore.listSince("u1", "2026-01-01"), now);
    expect(signal.missedMedicationDays).toBe(3);
    expect(signal.triggered).toBe(false);
  });

  it("triggers only when both a sustained mood decline and a medication gap are present together", () => {
    const now = new Date("2026-01-15T00:00:00Z");
    const db = openDatabase(":memory:");
    const checkinStore = new CheckinStore(db);
    const medicationStore = new MedicationStore(db);

    checkinStore.upsert({ userId: "u1", date: "2026-01-02", mood: 8 });
    checkinStore.upsert({ userId: "u1", date: "2026-01-03", mood: 8 });
    checkinStore.upsert({ userId: "u1", date: "2026-01-04", mood: 8 });
    checkinStore.upsert({ userId: "u1", date: "2026-01-09", mood: 4 });
    checkinStore.upsert({ userId: "u1", date: "2026-01-10", mood: 4 });
    checkinStore.upsert({ userId: "u1", date: "2026-01-11", mood: 4 });

    medicationStore.upsert({ userId: "u1", date: "2026-01-09", morningTaken: false });
    medicationStore.upsert({ userId: "u1", date: "2026-01-10", nightTaken: false });
    medicationStore.upsert({ userId: "u1", date: "2026-01-11", middayTaken: false });

    const signal = detectTrend(
      checkinStore.listSince("u1", "2026-01-01"),
      medicationStore.listSince("u1", "2026-01-01"),
      now,
    );
    expect(signal.triggered).toBe(true);
  });

  it("ignores a mood trend when there are too few samples in either half", () => {
    const now = new Date("2026-01-15T00:00:00Z");
    const db = openDatabase(":memory:");
    const checkinStore = new CheckinStore(db);
    const medicationStore = new MedicationStore(db);

    // 前半は1件のみ（サンプル不足）
    checkinStore.upsert({ userId: "u1", date: "2026-01-02", mood: 8 });
    checkinStore.upsert({ userId: "u1", date: "2026-01-09", mood: 4 });
    checkinStore.upsert({ userId: "u1", date: "2026-01-10", mood: 4 });
    checkinStore.upsert({ userId: "u1", date: "2026-01-11", mood: 4 });

    medicationStore.upsert({ userId: "u1", date: "2026-01-09", morningTaken: false });
    medicationStore.upsert({ userId: "u1", date: "2026-01-10", nightTaken: false });
    medicationStore.upsert({ userId: "u1", date: "2026-01-11", middayTaken: false });

    const signal = detectTrend(
      checkinStore.listSince("u1", "2026-01-01"),
      medicationStore.listSince("u1", "2026-01-01"),
      now,
    );
    expect(signal.priorAvgMood).toBeNull();
    expect(signal.triggered).toBe(false);
  });
});

describe("buildTrendNudgeMessage", () => {
  it("uses non-diagnostic, opt-out framing and never mentions crisis hotlines", () => {
    const signal: TrendSignal = { triggered: true, recentAvgMood: 4, priorAvgMood: 8, missedMedicationDays: 3 };
    const message = buildTrendNudgeMessage(signal);
    expect(message).toContain("見える気がする");
    expect(message).toContain("今のところで大丈夫そうならそれでいい");
    expect(message).not.toContain("診断");
    expect(message).not.toContain("うつ病");
    expect(message).not.toContain("症状");
    expect(message).not.toContain("0120-279-338");
  });
});

describe("createTrendNudgeTask", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  function seedTriggeringData(checkinStore: CheckinStore, medicationStore: MedicationStore, userId: string): void {
    checkinStore.upsert({ userId, date: "2026-01-02", mood: 8 });
    checkinStore.upsert({ userId, date: "2026-01-03", mood: 8 });
    checkinStore.upsert({ userId, date: "2026-01-04", mood: 8 });
    checkinStore.upsert({ userId, date: "2026-01-09", mood: 4 });
    checkinStore.upsert({ userId, date: "2026-01-10", mood: 4 });
    checkinStore.upsert({ userId, date: "2026-01-11", mood: 4 });
    medicationStore.upsert({ userId, date: "2026-01-09", morningTaken: false });
    medicationStore.upsert({ userId, date: "2026-01-10", nightTaken: false });
    medicationStore.upsert({ userId, date: "2026-01-11", middayTaken: false });
  }

  it("does nothing outside the configured hour", async () => {
    const sessionStore = new SessionStore(db);
    const checkinStore = new CheckinStore(db);
    const medicationStore = new MedicationStore(db);
    sessionStore.appendExchange("u1", "hi", "yo", new Date("2026-01-15T09:00:00"));
    seedTriggeringData(checkinStore, medicationStore, "u1");
    const { client, messages } = createFakeMisskeyClient();

    const task = createTrendNudgeTask({
      botStateStore: new BotStateStore(db),
      sessionStore,
      checkinStore,
      medicationStore,
      misskeyClient: client,
      hour: 20,
    });

    await task.run(new Date("2026-01-15T09:00:00"));
    expect(messages).toHaveLength(0);
  });

  it("sends a 1:1 chat nudge via sendChatMessage when the trend is triggered", async () => {
    const sessionStore = new SessionStore(db);
    const checkinStore = new CheckinStore(db);
    const medicationStore = new MedicationStore(db);
    const now = new Date("2026-01-15T20:00:00");
    sessionStore.appendExchange("u1", "hi", "yo", now);
    seedTriggeringData(checkinStore, medicationStore, "u1");
    const { client, messages } = createFakeMisskeyClient();

    const task = createTrendNudgeTask({
      botStateStore: new BotStateStore(db),
      sessionStore,
      checkinStore,
      medicationStore,
      misskeyClient: client,
      hour: 20,
    });

    await task.run(now);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.toUserId).toBe("u1");
    expect(messages[0]?.text).toContain("見える気がする");
  });

  it("does not resend to the same user within a 7-day cooldown, even if triggered again the next day", async () => {
    const sessionStore = new SessionStore(db);
    const checkinStore = new CheckinStore(db);
    const medicationStore = new MedicationStore(db);
    const botStateStore = new BotStateStore(db);
    const day1 = new Date("2026-01-15T20:00:00");
    sessionStore.appendExchange("u1", "hi", "yo", day1);
    seedTriggeringData(checkinStore, medicationStore, "u1");
    const { client, messages } = createFakeMisskeyClient();

    const task = createTrendNudgeTask({
      botStateStore,
      sessionStore,
      checkinStore,
      medicationStore,
      misskeyClient: client,
      hour: 20,
    });

    await task.run(day1);
    expect(messages).toHaveLength(1);

    const day2 = new Date(day1.getTime() + 24 * 60 * 60 * 1000);
    await task.run(day2);
    expect(messages).toHaveLength(1);
  });

  it("does not send when no user's trend is triggered", async () => {
    const sessionStore = new SessionStore(db);
    const checkinStore = new CheckinStore(db);
    const medicationStore = new MedicationStore(db);
    const now = new Date("2026-01-15T20:00:00");
    sessionStore.appendExchange("u1", "hi", "yo", now);
    const { client, messages } = createFakeMisskeyClient();

    const task = createTrendNudgeTask({
      botStateStore: new BotStateStore(db),
      sessionStore,
      checkinStore,
      medicationStore,
      misskeyClient: client,
      hour: 20,
    });

    await task.run(now);
    expect(messages).toHaveLength(0);
  });
});
