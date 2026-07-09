import { describe, expect, it } from "vitest";
import type { MisskeyClient } from "../../../src/misskey/client.js";
import { createDailyReflectionTask } from "../../../src/scheduler/index.js";
import { BotStateStore } from "../../../src/storage/bot-state-store.js";
import { openDatabase } from "../../../src/storage/db.js";
import { SessionStore } from "../../../src/storage/session-store.js";

function createFakeMisskeyClient(): { client: MisskeyClient; posts: { text: string; visibleUserIds?: string[] }[] } {
  const posts: { text: string; visibleUserIds?: string[] }[] = [];
  const client = {
    postNote: async (text: string, visibleUserIds?: string[]) => {
      posts.push({ text, visibleUserIds });
    },
  } as unknown as MisskeyClient;
  return { client, posts };
}

describe("createDailyReflectionTask", () => {
  it("does nothing outside the configured hour", async () => {
    const db = openDatabase(":memory:");
    const sessionStore = new SessionStore(db);
    sessionStore.appendExchange("user1", "hi", "yo", new Date("2026-01-05T00:00:00"));
    const { client, posts } = createFakeMisskeyClient();
    const task = createDailyReflectionTask({
      botStateStore: new BotStateStore(db),
      sessionStore,
      misskeyClient: client,
      hour: 20,
    });

    await task.run(new Date("2026-01-05T09:00:00"));

    expect(posts).toHaveLength(0);
  });

  it("posts a reminder to every known user at the configured hour", async () => {
    const db = openDatabase(":memory:");
    const sessionStore = new SessionStore(db);
    const now = new Date("2026-01-05T20:00:00");
    sessionStore.appendExchange("user1", "hi", "yo", now);
    sessionStore.appendExchange("user2", "hi", "yo", now);
    const { client, posts } = createFakeMisskeyClient();
    const task = createDailyReflectionTask({
      botStateStore: new BotStateStore(db),
      sessionStore,
      misskeyClient: client,
      hour: 20,
    });

    await task.run(now);

    expect(posts).toHaveLength(2);
    expect(posts.map((post) => post.visibleUserIds?.[0]).sort()).toEqual(["user1", "user2"]);
  });

  it("does not refire within 20 hours of the last run", async () => {
    const db = openDatabase(":memory:");
    const sessionStore = new SessionStore(db);
    const now = new Date("2026-01-05T20:00:00");
    sessionStore.appendExchange("user1", "hi", "yo", now);
    const { client, posts } = createFakeMisskeyClient();
    const task = createDailyReflectionTask({
      botStateStore: new BotStateStore(db),
      sessionStore,
      misskeyClient: client,
      hour: 20,
    });

    await task.run(now);
    await task.run(new Date(now.getTime() + 60 * 60 * 1000));

    expect(posts).toHaveLength(1);
  });
});
