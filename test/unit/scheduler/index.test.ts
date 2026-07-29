import { describe, expect, it } from "vitest";
import type { MisskeyClient } from "../../../src/misskey/client.js";
import { createDailyMorningReminderTask, createDailyReflectionTask } from "../../../src/scheduler/index.js";
import { BotStateStore } from "../../../src/storage/bot-state-store.js";
import { openDatabase } from "../../../src/storage/db.js";
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

describe("createDailyReflectionTask", () => {
  it("does nothing outside the configured hour", async () => {
    const db = openDatabase(":memory:");
    const sessionStore = new SessionStore(db);
    sessionStore.appendExchange("user1", "hi", "yo", new Date("2026-01-05T00:00:00+09:00"));
    const { client, messages } = createFakeMisskeyClient();
    const task = createDailyReflectionTask({
      botStateStore: new BotStateStore(db),
      sessionStore,
      misskeyClient: client,
      hour: 20,
    });

    await task.run(new Date("2026-01-05T09:00:00+09:00"));

    expect(messages).toHaveLength(0);
  });

  it("sends a reminder to every known user at the configured hour via 1:1 chat", async () => {
    const db = openDatabase(":memory:");
    const sessionStore = new SessionStore(db);
    const now = new Date("2026-01-05T20:00:00+09:00");
    sessionStore.appendExchange("user1", "hi", "yo", now);
    sessionStore.appendExchange("user2", "hi", "yo", now);
    const { client, messages } = createFakeMisskeyClient();
    const task = createDailyReflectionTask({
      botStateStore: new BotStateStore(db),
      sessionStore,
      misskeyClient: client,
      hour: 20,
    });

    await task.run(now);

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.toUserId).sort()).toEqual(["user1", "user2"]);
  });

  it("does not refire within 20 hours of the last run", async () => {
    const db = openDatabase(":memory:");
    const sessionStore = new SessionStore(db);
    const now = new Date("2026-01-05T20:00:00+09:00");
    sessionStore.appendExchange("user1", "hi", "yo", now);
    const { client, messages } = createFakeMisskeyClient();
    const task = createDailyReflectionTask({
      botStateStore: new BotStateStore(db),
      sessionStore,
      misskeyClient: client,
      hour: 20,
    });

    await task.run(now);
    await task.run(new Date(now.getTime() + 60 * 60 * 1000));

    expect(messages).toHaveLength(1);
  });
});

describe("createDailyMorningReminderTask", () => {
  it("sends a morning-flavoured reminder at the configured hour", async () => {
    const db = openDatabase(":memory:");
    const sessionStore = new SessionStore(db);
    const now = new Date("2026-01-05T08:00:00+09:00");
    sessionStore.appendExchange("user1", "hi", "yo", now);
    const { client, messages } = createFakeMisskeyClient();
    const task = createDailyMorningReminderTask({
      botStateStore: new BotStateStore(db),
      sessionStore,
      misskeyClient: client,
      hour: 8,
    });

    await task.run(new Date("2026-01-05T20:00:00+09:00"));
    expect(messages).toHaveLength(0);

    await task.run(now);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toContain("おはよう");
  });

  it("fires alongside the evening reflection on the same day", async () => {
    const db = openDatabase(":memory:");
    const sessionStore = new SessionStore(db);
    const botStateStore = new BotStateStore(db);
    const morning = new Date("2026-01-05T08:00:00+09:00");
    const evening = new Date("2026-01-05T20:00:00+09:00");
    sessionStore.appendExchange("user1", "hi", "yo", morning);
    const { client, messages } = createFakeMisskeyClient();
    const morningTask = createDailyMorningReminderTask({
      botStateStore,
      sessionStore,
      misskeyClient: client,
      hour: 8,
    });
    const eveningTask = createDailyReflectionTask({
      botStateStore,
      sessionStore,
      misskeyClient: client,
      hour: 20,
    });

    // last-runキーが独立しているので、20時間クールダウンに阻まれず両方発火する。
    await morningTask.run(morning);
    await eveningTask.run(evening);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.text).toContain("おはよう");
    expect(messages[1]?.text).toContain("振り返り");
  });

  it("does not refire within 20 hours of the last run", async () => {
    const db = openDatabase(":memory:");
    const sessionStore = new SessionStore(db);
    const now = new Date("2026-01-05T08:00:00+09:00");
    sessionStore.appendExchange("user1", "hi", "yo", now);
    const { client, messages } = createFakeMisskeyClient();
    const task = createDailyMorningReminderTask({
      botStateStore: new BotStateStore(db),
      sessionStore,
      misskeyClient: client,
      hour: 8,
    });

    await task.run(now);
    await task.run(new Date(now.getTime() + 30 * 60 * 1000));

    expect(messages).toHaveLength(1);
  });
});
