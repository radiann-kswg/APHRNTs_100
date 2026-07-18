import { describe, expect, it } from "vitest";
import type { MisskeyClient } from "../../../src/misskey/client.js";
import { createDailyReflectionTask } from "../../../src/scheduler/index.js";
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
